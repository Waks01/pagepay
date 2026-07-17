"""Admin ad analytics endpoints.

Provides per-user daily ad stats, daily ad totals, and per-ad-unit
breakdowns, SSV callback logs, eCPM trending, top earners, suspicious
users, and fill rate analytics. All endpoints require admin auth.
"""

import logging
from datetime import date, datetime, timedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, and_, or_, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import AdEvent, User, AdSsvLog, AdFillRateEvent
from app.schemas import (
    UserDailyAdStat, AdDailyTotals, AdUnitDailyStat, 
    AdSsvLogItem, EcpmTrendItem, TopEarnerItem, SuspiciousUserItem,
    FillRateFunnelItem, UnitPerformanceItem
)
from app.services.admin_auth import require_permission

logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/ads", tags=["admin-ads"])


@router.get("/daily-user-stats", response_model=list[UserDailyAdStat])
async def daily_user_ad_stats(
    start_date: str | None = Query(None),
    end_date: str | None = Query(None),
    current_admin = Depends(require_permission("dashboard.view")),
    db: AsyncSession = Depends(get_db),
):
    """Get per-user daily ad watch stats.

    Returns one row per (user, date) with:
    - number of ads watched
    - total points earned
    """
    end = datetime.utcnow()
    start = end - timedelta(days=30)

    if start_date:
        start = datetime.fromisoformat(start_date)
    if end_date:
        end = datetime.fromisoformat(end_date)

    # Query: group by user_id + date(created_at)
    stmt = (
        select(
            AdEvent.user_id,
            func.date(AdEvent.created_at).label("event_date"),
            func.count(AdEvent.id).label("ads_watched"),
            func.sum(AdEvent.user_points_credited).label("points_earned"),
        )
        .where(AdEvent.created_at >= start)
        .where(AdEvent.created_at <= end)
        .where(AdEvent.credit_status == "credited")
        .group_by(AdEvent.user_id, func.date(AdEvent.created_at))
        .order_by(func.date(AdEvent.created_at).desc(), AdEvent.user_id)
    )

    results = await db.execute(stmt)
    rows = results.all()

    return [
        UserDailyAdStat(
            user_id=row.user_id,
            date=str(row.event_date),
            ads_watched=row.ads_watched or 0,
            points_earned=row.points_earned or 0,
        )
        for row in rows
    ]


@router.get("/daily-totals", response_model=list[AdDailyTotals])
async def daily_ad_totals(
    start_date: str | None = Query(None),
    end_date: str | None = Query(None),
    current_admin = Depends(require_permission("dashboard.view")),
    db: AsyncSession = Depends(get_db),
):
    """Get daily ad totals across all users.

    Returns one row per day with:
    - total ads watched
    - total points credited
    - unique users who watched ads
    - revenue estimates
    """
    end = datetime.utcnow()
    start = end - timedelta(days=30)

    if start_date:
        start = datetime.fromisoformat(start_date)
    if end_date:
        end = datetime.fromisoformat(end_date)

    # Base query for all credited events in range
    base_stmt = (
        select(AdEvent)
        .where(AdEvent.created_at >= start)
        .where(AdEvent.created_at <= end)
        .where(AdEvent.credit_status == "credited")
    )

    # Daily aggregation
    daily_stmt = (
        select(
            func.date(AdEvent.created_at).label("event_date"),
            func.count(AdEvent.id).label("total_ads"),
            func.sum(AdEvent.user_points_credited).label("total_points"),
            func.count(func.distinct(AdEvent.user_id)).label("total_users"),
        )
        .where(AdEvent.created_at >= start)
        .where(AdEvent.created_at <= end)
        .where(AdEvent.credit_status == "credited")
        .group_by(func.date(AdEvent.created_at))
        .order_by(func.date(AdEvent.created_at).desc())
    )

    daily_results = await db.execute(daily_stmt)
    daily_rows = daily_results.all()

    # Get revenue for each day
    revenue_by_day: dict[str, float] = {}
    kobo_by_day: dict[str, int] = {}

    events = await db.execute(base_stmt)
    for event in events.scalars().all():
        day = event.created_at.date().isoformat()
        if event.revenue_usd and event.fx_rate_used:
            usd = float(event.revenue_usd) / 1_000_000
            fx = float(event.fx_rate_used) / 1_000_000
            revenue_by_day[day] = revenue_by_day.get(day, 0.0) + usd
            kobo_by_day[day] = kobo_by_day.get(day, 0) + int(usd * fx * 100)

    return [
        AdDailyTotals(
            date=str(row.event_date),
            total_ads=row.total_ads or 0,
            total_points_credited=row.total_points or 0,
            total_users=row.total_users or 0,
            total_revenue_usd=revenue_by_day.get(str(row.event_date), 0.0),
            total_revenue_ngn_kobo=kobo_by_day.get(str(row.event_date), 0),
        )
        for row in daily_rows
    ]


@router.get("/unit-daily-stats", response_model=list[AdUnitDailyStat])
async def unit_daily_stats(
    start_date: str | None = Query(None),
    end_date: str | None = Query(None),
    current_admin = Depends(require_permission("dashboard.view")),
    db: AsyncSession = Depends(get_db),
):
    """Get per-ad-unit daily stats.

    Returns one row per (ad_unit, date) with:
    - number of ads served
    - total points credited
    """
    end = datetime.utcnow()
    start = end - timedelta(days=30)

    if start_date:
        start = datetime.fromisoformat(start_date)
    if end_date:
        end = datetime.fromisoformat(end_date)

    stmt = (
        select(
            AdEvent.ad_unit,
            func.date(AdEvent.created_at).label("event_date"),
            func.count(AdEvent.id).label("ads_count"),
            func.sum(AdEvent.user_points_credited).label("points_credited"),
        )
        .where(AdEvent.created_at >= start)
        .where(AdEvent.created_at <= end)
        .where(AdEvent.credit_status == "credited")
        .group_by(AdEvent.ad_unit, func.date(AdEvent.created_at))
        .order_by(func.date(AdEvent.created_at).desc(), AdEvent.ad_unit)
    )

    results = await db.execute(stmt)
    rows = results.all()

    return [
        AdUnitDailyStat(
            date=str(row.event_date),
            ad_unit=row.ad_unit,
            ads_count=row.ads_count or 0,
            points_credited=row.points_credited or 0,
        )
        for row in rows
    ]


# ── New Admin Analytics Endpoints ────────────────────────────────────


@router.get("/ssv-logs")
async def get_ssv_logs(
    status: str | None = Query(None, description="Filter by status: success, signature_failed, expired, etc."),
    user_id: int | None = Query(None, description="Filter by user ID"),
    hours: int = Query(24, description="Look back this many hours"),
    limit: int = Query(100, description="Max results to return"),
    current_admin = Depends(require_permission("dashboard.view")),
    db: AsyncSession = Depends(get_db),
):
    """Get recent AdMob SSV callback logs for monitoring and debugging.
    
    Returns all SSV callback attempts (success and failures) with filters
    for status, user, and time range. Used in admin dashboard to monitor
    SSV callback health and debug signature failures.
    """
    cutoff = datetime.utcnow() - timedelta(hours=hours)
    
    stmt = select(AdSsvLog).where(AdSsvLog.created_at >= cutoff)
    
    if status:
        stmt = stmt.where(AdSsvLog.status == status)
    if user_id:
        stmt = stmt.where(AdSsvLog.user_id == user_id)
    
    stmt = stmt.order_by(desc(AdSsvLog.created_at)).limit(limit)
    
    results = await db.execute(stmt)
    logs = results.scalars().all()
    
    return [
        {
            "id": log.id,
            "user_id": log.user_id,
            "token": log.token,
            "transaction_id": log.transaction_id,
            "ad_unit": log.ad_unit,
            "status": log.status,
            "rejection_reason": log.rejection_reason,
            "points_credited": log.points_credited,
            "created_at": log.created_at.isoformat(),
        }
        for log in logs
    ]


@router.get("/ecpm-trending")
async def get_ecpm_trending(
    days: int = Query(30, description="Number of days to include"),
    current_admin = Depends(require_permission("dashboard.view")),
    db: AsyncSession = Depends(get_db),
):
    """Get daily eCPM trending over the specified period.
    
    eCPM = (total_points_credited / ads_watched) × (naira_per_point)
    Where: 10 points = ₦1, so naira_per_point = 0.1
    
    Returns daily average eCPM for rewarded ads.
    """
    cutoff = datetime.utcnow() - timedelta(days=days)
    
    stmt = (
        select(
            func.date(AdEvent.created_at).label("date"),
            func.count(AdEvent.id).label("ads_watched"),
            func.sum(AdEvent.user_points_credited).label("total_points"),
        )
        .where(AdEvent.created_at >= cutoff)
        .where(AdEvent.credit_status == "credited")
        .where(AdEvent.ad_type == "rewarded")
        .group_by(func.date(AdEvent.created_at))
        .order_by(func.date(AdEvent.created_at).desc())
    )
    
    results = await db.execute(stmt)
    rows = results.all()
    
    POINTS_PER_NAIRA = 10
    
    return [
        {
            "date": str(row.date),
            "ads_watched": row.ads_watched or 0,
            "total_points": row.total_points or 0,
            # eCPM = (total_points / ads) × (1 naira / 10 points) × 1000 (per mille)
            "ecpm_ngn": round((row.total_points / row.ads_watched / POINTS_PER_NAIRA * 1000), 2) 
                        if row.ads_watched > 0 else 0,
        }
        for row in rows
    ]


@router.get("/top-earners")
async def get_top_earners(
    days: int = Query(7, description="Look back this many days"),
    limit: int = Query(20, description="Number of top earners to return"),
    current_admin = Depends(require_permission("dashboard.view")),
    db: AsyncSession = Depends(get_db),
):
    """Get top earning users from ad rewards over the specified period.
    
    Returns users ranked by total ad rewards (points credited).
    """
    cutoff = datetime.utcnow() - timedelta(days=days)
    
    stmt = (
        select(
            AdEvent.user_id,
            User.email,
            func.count(AdEvent.id).label("ads_watched"),
            func.sum(AdEvent.user_points_credited).label("total_points"),
        )
        .join(User, User.id == AdEvent.user_id)
        .where(AdEvent.created_at >= cutoff)
        .where(AdEvent.credit_status == "credited")
        .group_by(AdEvent.user_id, User.email)
        .order_by(desc(func.sum(AdEvent.user_points_credited)))
        .limit(limit)
    )
    
    results = await db.execute(stmt)
    rows = results.all()
    
    return [
        {
            "user_id": row.user_id,
            "email": row.email,
            "ads_watched": row.ads_watched or 0,
            "total_points": row.total_points or 0,
            "total_ngn": round((row.total_points or 0) / 10, 2),
        }
        for row in rows
    ]


@router.get("/unit-performance")
async def get_unit_performance(
    days: int = Query(7, description="Look back this many days"),
    current_admin = Depends(require_permission("dashboard.view")),
    db: AsyncSession = Depends(get_db),
):
    """Get performance breakdown by ad unit (rewarded_android vs rewarded_ios).
    
    Returns aggregated stats per ad unit: total ads, points credited, unique users.
    """
    cutoff = datetime.utcnow() - timedelta(days=days)
    
    stmt = (
        select(
            AdEvent.ad_unit,
            func.count(AdEvent.id).label("ads_watched"),
            func.sum(AdEvent.user_points_credited).label("total_points"),
            func.count(func.distinct(AdEvent.user_id)).label("unique_users"),
        )
        .where(AdEvent.created_at >= cutoff)
        .where(AdEvent.credit_status == "credited")
        .group_by(AdEvent.ad_unit)
        .order_by(desc(func.count(AdEvent.id)))
    )
    
    results = await db.execute(stmt)
    rows = results.all()
    
    return [
        {
            "ad_unit": row.ad_unit,
            "ads_watched": row.ads_watched or 0,
            "total_points": row.total_points or 0,
            "unique_users": row.unique_users or 0,
            "avg_points_per_ad": round((row.total_points or 0) / (row.ads_watched or 1), 2),
        }
        for row in rows
    ]


@router.get("/suspicious-users")
async def get_suspicious_users(
    min_ads: int = Query(250, description="Flag users with more than this many ads in the time period"),
    hours: int = Query(24, description="Look back this many hours"),
    current_admin = Depends(require_permission("dashboard.view")),
    db: AsyncSession = Depends(get_db),
):
    """Manual query to find users with suspicious ad watch patterns.
    
    Flags users who watched more than min_ads in the specified time period.
    Default threshold: 250 ads/24h (power user cap is 200).
    
    Admin can adjust min_ads and hours to investigate different patterns.
    """
    cutoff = datetime.utcnow() - timedelta(hours=hours)
    
    stmt = (
        select(
            AdEvent.user_id,
            User.email,
            User.status,
            func.count(AdEvent.id).label("ads_watched"),
            func.sum(AdEvent.user_points_credited).label("total_points"),
            func.min(AdEvent.created_at).label("first_ad"),
            func.max(AdEvent.created_at).label("last_ad"),
        )
        .join(User, User.id == AdEvent.user_id)
        .where(AdEvent.created_at >= cutoff)
        .where(AdEvent.credit_status == "credited")
        .group_by(AdEvent.user_id, User.email, User.status)
        .having(func.count(AdEvent.id) >= min_ads)
        .order_by(desc(func.count(AdEvent.id)))
    )
    
    results = await db.execute(stmt)
    rows = results.all()
    
    return [
        {
            "user_id": row.user_id,
            "email": row.email,
            "status": row.status,
            "ads_watched": row.ads_watched or 0,
            "total_points": row.total_points or 0,
            "first_ad": row.first_ad.isoformat(),
            "last_ad": row.last_ad.isoformat(),
            "hours_active": round((row.last_ad - row.first_ad).total_seconds() / 3600, 2),
            "ads_per_hour": round((row.ads_watched or 0) / max(((row.last_ad - row.first_ad).total_seconds() / 3600), 1), 2),
            "risk_level": "red" if row.ads_watched >= 301 else ("orange" if row.ads_watched >= 201 else "yellow"),
        }
        for row in rows
    ]


@router.get("/fill-rate-funnel")
async def get_fill_rate_funnel(
    days: int = Query(7, description="Look back this many days"),
    ad_unit: str | None = Query(None, description="Filter by specific ad unit"),
    current_admin = Depends(require_permission("dashboard.view")),
    db: AsyncSession = Depends(get_db),
):
    """Get ad fill rate funnel: requested → loaded → shown → completed.
    
    Calculates the percentage of ad requests that complete each stage.
    Useful for identifying SDK issues, low fill rates, or user drop-off.
    """
    cutoff = datetime.utcnow() - timedelta(days=days)
    
    base_stmt = select(AdFillRateEvent).where(AdFillRateEvent.created_at >= cutoff)
    if ad_unit:
        base_stmt = base_stmt.where(AdFillRateEvent.ad_unit == ad_unit)
    
    # Count events by stage
    stage_stmt = (
        select(
            AdFillRateEvent.stage,
            func.count(func.distinct(AdFillRateEvent.ad_request_id)).label("count"),
        )
        .where(AdFillRateEvent.created_at >= cutoff)
    )
    
    if ad_unit:
        stage_stmt = stage_stmt.where(AdFillRateEvent.ad_unit == ad_unit)
    
    stage_stmt = stage_stmt.group_by(AdFillRateEvent.stage)
    
    results = await db.execute(stage_stmt)
    rows = results.all()
    
    stage_counts = {row.stage: row.count for row in rows}
    
    requested = stage_counts.get("requested", 0)
    loaded = stage_counts.get("loaded", 0)
    shown = stage_counts.get("shown", 0)
    completed = stage_counts.get("completed", 0)
    failed = stage_counts.get("failed", 0)
    
    return {
        "requested": requested,
        "loaded": loaded,
        "shown": shown,
        "completed": completed,
        "failed": failed,
        "load_rate": round((loaded / requested * 100), 2) if requested > 0 else 0,
        "show_rate": round((shown / loaded * 100), 2) if loaded > 0 else 0,
        "completion_rate": round((completed / shown * 100), 2) if shown > 0 else 0,
        "overall_completion_rate": round((completed / requested * 100), 2) if requested > 0 else 0,
    }
