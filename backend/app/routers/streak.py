"""Streak counter endpoint.

GET /users/me/streak — returns current streak, longest streak, and bonus multiplier.
"""

import logging
from datetime import date, datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User, UserStreak, ReadingSession
from app.routers.auth import get_current_user
from app.schemas import StreakResponse

logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/users", tags=["streak"])


def _get_timezone_offset_minutes(request: Request) -> int:
    """Read client timezone offset from request header.

    The Expo client sends ``X-Timezone-Offset`` on every request via
    ``apiFetch``. The value is minutes ahead of UTC (negative if the
    device is behind UTC, e.g. US timezones). Defaults to 0 (UTC) if
    the header is missing so the API never crashes on old clients.
    """
    raw = request.headers.get("X-Timezone-Offset", "0")
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 0


def _user_local_date(utc_now: datetime, offset_minutes: int) -> date:
    """Convert a UTC datetime to the user's local calendar date."""
    return (utc_now + timedelta(minutes=offset_minutes)).date()


def _bonus_for_streak(days: int) -> tuple[float, str]:
    if days >= 30:
        return 1.5, "30-day legend (+50%)"
    if days >= 7:
        return 1.2, "7-day streak (+20%)"
    return 1.0, "No bonus"


def _get_client_local_date(request: Request) -> date:
    """Read the client's local date from the request header.

    The Expo client sends ``X-Client-Date`` on every request via
    ``apiFetch``. The value is an ISO date string ``YYYY-MM-DD`` in
    the user's local calendar date. Defaults to today's date from the
    client's reported local date if the header is missing.
    """
    client_date = request.headers.get("X-Client-Date")
    if client_date:
        try:
            return date.fromisoformat(client_date)
        except (TypeError, ValueError):
            pass
    utc_now = datetime.now(timezone.utc)
    offset = _get_timezone_offset_minutes(request)
    return _user_local_date(utc_now, offset)


async def _update_login_streak(user_id: int, db: AsyncSession, request: Request | None = None) -> UserStreak:
    """Update user's LOGIN streak based on app usage.

    This function tracks user engagement (how often they open the app) and is
    independent of daily reward claiming. Called whenever a user makes any API call.

    LOGIN STREAK LOGIC:
    - If user opens app on consecutive days → increment login streak
    - If user misses a day → reset login streak to 1
    - Multiple opens on same day → no change
    """
    logger.error(f"[_update_login_streak] start user={user_id}")
    streak_row = await db.execute(
        select(UserStreak).where(UserStreak.user_id == user_id)
    )
    streak = streak_row.scalar_one_or_none()

    today = _get_client_local_date(request) if request is not None else date.today()
    today_str = today.isoformat()
    yesterday = today - timedelta(days=1)
    yesterday_str = yesterday.isoformat()

    if streak is None:
        logger.error(f"[_update_login_streak] creating_new_streak user={user_id} today={today_str}")
        # First time user - create streak record
        streak = UserStreak(
            user_id=user_id,
            # Login tracking
            last_login_date=today_str,
            consecutive_login_days=1,
            longest_login_streak=1,
            total_logins=1,
            # Legacy fields (map to login tracking)
            current_streak=1,
            longest_streak=1,
            last_activity_date=today_str,
            # Reward tracking starts at 0
            reward_streak=0,
            longest_reward_streak=0,
            last_reward_claim_date=None,
            last_claim_date=None,
            reward_streak_expires_at=None
        )
        db.add(streak)
        try:
            await db.commit()
            await db.refresh(streak)
        except Exception as e:
            logger.error(f"[_update_login_streak] CREATE FAILED user={user_id}: {e}", exc_info=True)
            raise
        logger.error(f"[_update_login_streak] created new_streak_id={streak.id}")
        return streak

    last_login = streak.last_login_date
    logger.error(f"[_update_login_streak] existing streak last_login={last_login} today={today_str} yesterday={yesterday_str}")
    
    if last_login == today_str:
        # User already logged in today - no change needed
        logger.error("[_update_login_streak] already_logged_in_today")
        return streak
    elif last_login == yesterday_str:
        # User logged in yesterday - continue login streak
        streak.consecutive_login_days += 1
        streak.longest_login_streak = max(streak.longest_login_streak, streak.consecutive_login_days)
        streak.total_logins += 1
        logger.error(f"[_update_login_streak] continue_streak consecutive={streak.consecutive_login_days}")
    elif last_login and date.fromisoformat(last_login) < yesterday:
        # User missed a day - reset login streak
        streak.consecutive_login_days = 1
        streak.total_logins += 1
        logger.error("[_update_login_streak] reset_streak_missed_day")
    else:
        # Edge case or first login - start fresh
        streak.consecutive_login_days = 1
        streak.total_logins += 1
        logger.error("[_update_login_streak] edge_case_fresh_start")
        
    # Update login tracking
    streak.last_login_date = today_str
    
    # Update legacy fields to match login tracking
    streak.current_streak = streak.consecutive_login_days
    streak.longest_streak = streak.longest_login_streak
    streak.last_activity_date = today_str
    
    try:
        await db.commit()
        await db.refresh(streak)
    except Exception as e:
        logger.error(f"[_update_login_streak] COMMIT FAILED user={user_id}: {e}", exc_info=True)
        raise
    logger.error(f"[_update_login_streak] done user={user_id} consecutive={streak.consecutive_login_days}")
    return streak


async def _update_reward_streak(user_id: int, db: AsyncSession, request: Request | None = None) -> UserStreak:
    """Update user's REWARD streak based on daily reward claiming.

    This function handles the reward streak logic independently of login activity.
    Should be called when checking daily reward status or claiming rewards.

    REWARD STREAK LOGIC:
    - Streak only increments when user actually CLAIMS a reward
    - If 24+ hours pass without claiming → streak resets to 0
    - If user then claims → streak becomes 1
    - Consecutive days of claiming → streak increments
    """
    # First ensure login tracking is up to date
    logger.error(f"[_update_reward_streak] start user={user_id}")
    streak = await _update_login_streak(user_id, db, request)
    logger.error(f"[_update_reward_streak] after_login_streak reward_streak={streak.reward_streak} expires={streak.reward_streak_expires_at}")

    utc_now = datetime.now(timezone.utc)

    # Check if reward streak has expired (24+ hours since last claim)
    if streak.reward_streak_expires_at and utc_now > streak.reward_streak_expires_at:
        logger.error(f"[_update_reward_streak] EXPIRED user={user_id} expires={streak.reward_streak_expires_at} now={utc_now}")
        # Streak expired - reset to 0
        streak.reward_streak = 0
        streak.reward_streak_expires_at = None
        streak.last_reward_claim_date = None
        streak.last_claim_date = None

        await db.commit()
        await db.refresh(streak)
        logger.error(f"[_update_reward_streak] after_reset reward_streak={streak.reward_streak}")

    logger.error(f"[_update_reward_streak] done user={user_id}")
    return streak


async def _claim_daily_reward_increment_streak(user_id: int, db: AsyncSession, request: Request | None = None) -> UserStreak:
    """Increment reward streak when user successfully claims a daily reward.

    This should ONLY be called when a reward is actually claimed, not just viewed.

    CLAIMING LOGIC:
    - If streak is 0 or expired → becomes 1
    - If user claimed yesterday → increment streak
    - If user already claimed today → no change
    - Set expiration to 24 hours from now
    """
    logger.error(f"[_claim_daily_reward_increment_streak] start user={user_id}")
    streak = await _update_reward_streak(user_id, db, request)

    utc_now = datetime.now(timezone.utc)
    today = _get_client_local_date(request) if request is not None else date.today()
    today_str = today.isoformat()
    yesterday = today - timedelta(days=1)
    yesterday_str = yesterday.isoformat()

    # Set expiration to 24 hours from now
    expiration_time = utc_now + timedelta(hours=24)

    last_claim = streak.last_reward_claim_date
    logger.error(f"[_claim_daily_reward_increment_streak] last_claim={last_claim} today_str={today_str} yesterday_str={yesterday_str} reward_streak={streak.reward_streak}")

    if last_claim == today_str:
        # Already claimed today - no streak change, but refresh expiration
        streak.reward_streak_expires_at = expiration_time
        logger.error("[_claim_daily_reward_increment_streak] already_claimed_today_branch")
    elif last_claim == yesterday_str and streak.reward_streak > 0:
        # Claimed yesterday - continue streak
        streak.reward_streak += 1
        streak.longest_reward_streak = max(streak.longest_reward_streak, streak.reward_streak)
        streak.reward_streak_expires_at = expiration_time
        streak.last_reward_claim_date = today_str
        streak.last_claim_date = today_str
        logger.error(f"[_claim_daily_reward_increment_streak] continue_streak new={streak.reward_streak}")
    else:
        # First claim or broken streak - start/restart at 1
        streak.reward_streak = 1
        streak.longest_reward_streak = max(streak.longest_reward_streak, 1)
        streak.reward_streak_expires_at = expiration_time
        streak.last_reward_claim_date = today_str
        streak.last_claim_date = today_str
        logger.error("[_claim_daily_reward_increment_streak] first_claim_branch")

    try:
        await db.commit()
        await db.refresh(streak)
    except Exception as e:
        logger.error(f"[_claim_daily_reward_increment_streak] COMMIT FAILED user={user_id}: {e}", exc_info=True)
        raise
    logger.error(f"[_claim_daily_reward_increment_streak] done user={user_id} reward_streak={streak.reward_streak}")
    return streak


async def _update_streak(user_id: int, db: AsyncSession, request: Request | None = None) -> UserStreak:
    """Recalculate the user's streak from their verified reading sessions.

    Uses the client's local calendar date when available so that streak
    boundaries follow the user's clock instead of server UTC midnight.
    
    DEPRECATED: This function is kept for backward compatibility but login streaks
    should use _update_login_streak instead.
    """
    # First update login streak (this handles the daily login tracking)
    streak = await _update_login_streak(user_id, db, request)
    
    # Then calculate reading session streak for bonus purposes
    session_dates = await db.execute(
        select(func.date(ReadingSession.start_time))
        .where(ReadingSession.user_id == user_id)
        .where(ReadingSession.verified == True)  # noqa: E712
        .distinct()
        .order_by(func.date(ReadingSession.start_time).desc())
    )
    dates = [str(r[0]) for r in session_dates.all()]

    utc_now = datetime.now(timezone.utc)
    today = _get_client_local_date(request)
    yesterday = today - timedelta(days=1)

    if not dates:
        # No reading sessions, but login streak is already handled above
        return streak

    # Calculate reading session streak (for bonus multipliers)
    streak_days = 0
    longest_reading = 0
    
    if dates:
        streak_days = 1
        longest_reading = 1
        prev = date.fromisoformat(dates[0])

        # Reset reading streak if last reading session was before yesterday
        if prev < yesterday:
            streak_days = 0

        for d in dates[1:]:
            curr = date.fromisoformat(d)
            if (prev - curr).days == 1:
                streak_days += 1
                longest_reading = max(longest_reading, streak_days)
            elif (prev - curr).days > 1:
                streak_days = 1
            prev = curr

        # Only count reading streak if last session was today or yesterday
        if date.fromisoformat(dates[0]) not in (today, yesterday):
            streak_days = 0

    # Use login streak for display, but reading streak can influence bonuses
    # For now, we'll use login streak as the primary streak
    return streak


@router.get("/me/streak", response_model=StreakResponse)
async def get_streak(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the current user's reading streak and bonus multiplier."""
    streak = await _update_streak(current_user.id, db, request=request)
    multiplier, label = _bonus_for_streak(streak.current_streak)
    return StreakResponse(
        current_streak=streak.current_streak,
        longest_streak=streak.longest_streak,
        last_activity_date=streak.last_activity_date,
        bonus_multiplier=multiplier,
        bonus_label=label,
    )
