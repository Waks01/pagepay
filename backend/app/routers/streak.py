"""Streak counter endpoint.

GET /users/me/streak — returns current streak, longest streak, and bonus multiplier.
"""

import logging
from datetime import date, datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User, UserStreak, ReadingSession
from app.routers.auth import get_current_user
from app.schemas import StreakResponse

logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/users", tags=["streak"])


def _bonus_for_streak(days: int) -> tuple[float, str]:
    if days >= 30:
        return 1.5, "30-day legend (+50%)"
    if days >= 7:
        return 1.2, "7-day streak (+20%)"
    return 1.0, "No bonus"


async def _update_streak(user_id: int, db: AsyncSession) -> UserStreak:
    """Recalculate the user's streak from their verified reading sessions."""
    streak_row = await db.execute(
        select(UserStreak).where(UserStreak.user_id == user_id)
    )
    streak = streak_row.scalar_one_or_none()

    session_dates = await db.execute(
        select(func.date(ReadingSession.start_time))
        .where(ReadingSession.user_id == user_id)
        .where(ReadingSession.verified == True)  # noqa: E712
        .distinct()
        .order_by(func.date(ReadingSession.start_time).desc())
    )
    dates = [str(r[0]) for r in session_dates.all()]

    if not dates:
        if streak is None:
            streak = UserStreak(user_id=user_id, current_streak=0, longest_streak=0)
            db.add(streak)
        else:
            streak.current_streak = 0
        await db.commit()
        await db.refresh(streak)
        return streak

    today = date.today()
    yesterday = today - timedelta(days=1)

    streak_days = 1
    longest = 1
    prev = date.fromisoformat(dates[0])

    if prev != today and prev != yesterday:
        streak_days = 0

    for d in dates[1:]:
        curr = date.fromisoformat(d)
        if (prev - curr).days == 1:
            streak_days += 1
            longest = max(longest, streak_days)
        elif (prev - curr).days > 1:
            streak_days = 1
        prev = curr

    if streak is None:
        streak = UserStreak(user_id=user_id)
        db.add(streak)

    streak.current_streak = streak_days if (date.fromisoformat(dates[0]) in (today, yesterday)) else 0
    streak.longest_streak = max(streak.longest_streak, longest)
    streak.last_activity_date = dates[0]
    await db.commit()
    await db.refresh(streak)
    return streak


@router.get("/me/streak", response_model=StreakResponse)
async def get_streak(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the current user's reading streak and bonus multiplier."""
    streak = await _update_streak(current_user.id, db)
    multiplier, label = _bonus_for_streak(streak.current_streak)
    return StreakResponse(
        current_streak=streak.current_streak,
        longest_streak=streak.longest_streak,
        last_activity_date=streak.last_activity_date,
        bonus_multiplier=multiplier,
        bonus_label=label,
    )
