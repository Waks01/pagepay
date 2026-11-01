"""Admin analytics endpoints.

All endpoints require admin authentication.
"""

import logging
from datetime import date, datetime, timedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User, ReadingSession, ContentCatalog, AdminUser
from app.services.admin_auth import require_permission

logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/dau")
async def get_daily_active_users(
    days: int = 7,
    current_admin: AdminUser = Depends(require_permission("dashboard.view")),
    db: AsyncSession = Depends(get_db),
):
    cutoff = datetime.utcnow() - timedelta(days=days)
    rows = await db.execute(
        select(
            func.date(ReadingSession.start_time).label("day"),
            func.count(func.distinct(ReadingSession.user_id)).label("count"),
        )
        .where(ReadingSession.start_time >= cutoff)
        .group_by(func.date(ReadingSession.start_time))
        .order_by(func.date(ReadingSession.start_time).desc())
    )
    return [
        {"date": str(r.day), "count": int(r.count)}
        for r in rows.all()
    ]


@router.get("/retention")
async def get_retention(
    current_admin: AdminUser = Depends(require_permission("dashboard.view")),
    db: AsyncSession = Depends(get_db),
):
    """Day 1 and Day 7 cohort retention.

    Counts users who signed up on a given day and returned for a
    reading session on day 1 and day 7.
    """
    cutoff_7 = datetime.utcnow() - timedelta(days=7)
    cutoff_1 = datetime.utcnow() - timedelta(days=1)

    signup_rows = await db.execute(
        select(User.id, User.created_at)
        .where(User.created_at >= cutoff_7)
    )
    users = {r.id: r.created_at for r in signup_rows.all()}

    session_rows = await db.execute(
        select(ReadingSession.user_id, func.date(ReadingSession.start_time)).where(
            ReadingSession.start_time >= cutoff_7
        )
    )
    sessions: dict[int, set[str]] = {}
    for uid, day in session_rows.all():
        sessions.setdefault(uid, set()).add(str(day))

    cohorts: dict[str, dict] = {}
    for uid, created in users.items():
        key = created.date().isoformat()
        cohorts.setdefault(key, {"day_1": 0, "day_7": 0, "users": []})
        cohorts[key]["users"].append(uid)
        user_days = sessions.get(uid, set())
        signup_day = created.date()
        if any(d == (signup_day + timedelta(days=1)).isoformat() for d in user_days):
            cohorts[key]["day_1"] += 1
        if any(d == (signup_day + timedelta(days=7)).isoformat() for d in user_days):
            cohorts[key]["day_7"] += 1

    return [
        {
            "signup_date": k,
            "day_1": v["day_1"],
            "day_7": v["day_7"],
        }
        for k, v in sorted(cohorts.items())
    ]


@router.get("/content-performance")
async def get_content_performance(
    limit: int = 20,
    current_admin: AdminUser = Depends(require_permission("dashboard.view")),
    db: AsyncSession = Depends(get_db),
):
    """Top content by reading session count."""
    rows = await db.execute(
        select(
            ContentCatalog.id,
            ContentCatalog.title,
            func.count(ReadingSession.id).label("reading_sessions"),
        )
        .join(ReadingSession, ReadingSession.content_id == ContentCatalog.id)
        .group_by(ContentCatalog.id, ContentCatalog.title)
        .order_by(desc(func.count(ReadingSession.id)))
        .limit(limit)
    )
    return [
        {"content_id": r.id, "title": r.title, "reading_sessions": int(r.reading_sessions)}
        for r in rows.all()
    ]
