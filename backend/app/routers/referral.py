"""Referral program endpoints.

POST /referral/generate  — create/return the user's referral code
GET  /referral/stats     — clicks, signups, pending/claimed rewards
POST /referral/validate  — referee completed first session → award points
"""

import logging
from datetime import date, datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User, Referral, ReadingSession
from app.routers.auth import get_current_user
from app.schemas import ReferralGenerateResponse, ReferralStats, ReferralValidateResponse
from app.config import settings

logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/referral", tags=["referral"])

# All four knobs read from settings (env-overridable). See config.py:
#   REFERRAL_REFERRER_REWARD  →  settings.referral_referrer_reward
#   REFERRAL_REFEREE_REWARD   →  settings.referral_referee_reward
#   REFERRAL_DAILY_CAP        →  settings.referral_daily_cap
#   REFERRAL_APP_BASE_URL     →  settings.referral_app_base_url
REFERRER_REWARD = settings.referral_referrer_reward
REFEREE_REWARD = settings.referral_referee_reward
DAILY_CAP = settings.referral_daily_cap
APP_BASE_URL = settings.referral_app_base_url


def _get_timezone_offset_minutes(request: Request) -> int:
    """Read client timezone offset from request header."""
    raw = request.headers.get("X-Timezone-Offset", "0")
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 0


def _user_local_date_from_utc(utc_now: datetime, offset_minutes: int) -> date:
    """Compute the user's local calendar date from a UTC datetime and offset."""
    return (utc_now + timedelta(minutes=offset_minutes)).date()


@router.post("/generate", response_model=ReferralGenerateResponse)
async def generate_referral_code(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the user's referral code and share link. Creates one if missing."""
    if current_user.referral_code:
        return ReferralGenerateResponse(
            code=current_user.referral_code,
            link=f"{APP_BASE_URL}/{current_user.referral_code}",
        )

    import secrets, string
    alphabet = string.ascii_uppercase + string.digits
    for _ in range(10):
        candidate = ''.join(secrets.choice(alphabet) for _ in range(6))
        existing = await db.execute(select(User).where(User.referral_code == candidate))
        if not existing.scalar_one_or_none():
            current_user.referral_code = candidate
            await db.commit()
            await db.refresh(current_user)
            return ReferralGenerateResponse(
                code=candidate,
                link=f"{APP_BASE_URL}/{candidate}",
            )

    raise HTTPException(status_code=500, detail="Failed to generate unique referral code")


@router.get("/stats", response_model=ReferralStats)
async def get_referral_stats(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return referral stats for the current user."""
    code = current_user.referral_code
    if not code:
        return ReferralStats(code="", clicks=0, signups=0, pending_rewards=0, claimed_rewards=0)

    signups_rows = await db.execute(
        select(Referral).where(Referral.code == code, Referral.referrer_id == current_user.id)
    )
    referrals = signups_rows.scalars().all()

    signups = len(referrals)
    pending_rewards = sum(1 for r in referrals if r.referee_completed_first_session and not r.reward_granted)
    claimed_rewards = sum(1 for r in referrals if r.reward_granted)

    return ReferralStats(
        code=code,
        clicks=0,
        signups=signups,
        pending_rewards=pending_rewards,
        claimed_rewards=claimed_rewards,
    )


@router.post("/validate", response_model=ReferralValidateResponse)
async def validate_referral(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Called when the referee completes their first verified reading session.

    Awards 500 pts to referrer and 200 pts to referee. Enforces:
    - Max 10 referrals/day per referrer
    - No self-referral
    - Only awards once per referral pair
    """
    referee = current_user
    code = referee.referred_by

    if not code:
        return ReferralValidateResponse(rewarded=False, referrer_points=0, referee_points=0, message="No referral code")

    referrer_row = await db.execute(select(User).where(User.referral_code == code))
    referrer = referrer_row.scalar_one_or_none()
    if not referrer:
        return ReferralValidateResponse(rewarded=False, referrer_points=0, referee_points=0, message="Invalid referral code")

    if referrer.id == referee.id:
        return ReferralValidateResponse(rewarded=False, referrer_points=0, referee_points=0, message="Self-referral blocked")

    existing = await db.execute(
        select(Referral).where(Referral.code == code, Referral.referee_id == referee.id)
    )
    referral = existing.scalar_one_or_none()
    if referral and referral.reward_granted:
        return ReferralValidateResponse(rewarded=False, referrer_points=0, referee_points=0, message="Already rewarded")

    # Get today's date from client header (user's local date)
    client_date = request.headers.get("X-Client-Date")
    if client_date:
        try:
            user_local_today = date.fromisoformat(client_date)
        except (TypeError, ValueError):
            utc_now = datetime.now(timezone.utc)
            offset = _get_timezone_offset_minutes(request)
            user_local_today = _user_local_date_from_utc(utc_now, offset)
    else:
        utc_now = datetime.now(timezone.utc)
        offset = _get_timezone_offset_minutes(request)
        user_local_today = _user_local_date_from_utc(utc_now, offset)

    if referrer.referrals_today_reset_at:
        user_local_reset_date = _user_local_date_from_utc(
            referrer.referrals_today_reset_at,
            _get_timezone_offset_minutes(request),
        )
    else:
        user_local_reset_date = None

    if user_local_reset_date is None or user_local_reset_date < user_local_today:
        referrer.referrals_today_count = 0
        referrer.referrals_today_reset_at = datetime.utcnow()

    if referrer.referrals_today_count >= DAILY_CAP:
        return ReferralValidateResponse(rewarded=False, referrer_points=0, referee_points=0, message="Daily referral cap reached")

    if referral is None:
        referral = Referral(
            referrer_id=referrer.id,
            referee_id=referee.id,
            code=code,
            referee_completed_first_session=True,
        )
        db.add(referral)
    else:
        referral.referee_completed_first_session = True

    referrer.points_balance = (referrer.points_balance or 0) + REFERRER_REWARD
    referee.points_balance = (referee.points_balance or 0) + REFEREE_REWARD
    referrer.referrals_today_count = (referrer.referrals_today_count or 0) + 1
    referral.reward_granted = True

    await db.commit()

    # Run fraud checks on referral activity
    try:
        from app.services.fraud_detection import run_fraud_checks_on_referral
        await run_fraud_checks_on_referral(db=db, referrer_id=referrer.id)
    except Exception as e:
        # Don't fail referral if fraud check fails
        logger.warning(f"Fraud check failed for referrer {referrer.id}: {e}")

    return ReferralValidateResponse(
        rewarded=True,
        referrer_points=REFERRER_REWARD,
        referee_points=REFEREE_REWARD,
        message=f"Referral validated! +{REFERRER_REWARD} pts for referrer, +{REFEREE_REWARD} pts for referee.",
    )

    # Send push notifications for referral bonus (fire-and-forget)
    try:
        from app.services.fcm import send_push_notification_background
        from app.services.notifications import create_notification_background
        import asyncio
        asyncio.create_task(send_push_notification_background(
            user_id=referrer.id,
            title="Referral Bonus! 🎉",
            body=f"Someone joined using your code! You earned +{REFERRER_REWARD} points.",
            data={"type": "referral_bonus", "points": str(REFERRER_REWARD)},
            category="referral_bonuses",
        ))
        asyncio.create_task(create_notification_background(
            user_id=referrer.id,
            title="Referral Bonus! 🎉",
            body=f"Someone joined using your code! You earned +{REFERRER_REWARD} points.",
            category="referral_bonuses",
            data={"type": "referral_bonus", "points": REFERRER_REWARD},
        ))
        asyncio.create_task(send_push_notification_background(
            user_id=referee.id,
            title="Welcome Bonus! 🎉",
            body=f"You joined with a referral code! +{REFEREE_REWARD} points for you.",
            data={"type": "referral_bonus", "points": str(REFEREE_REWARD)},
            category="referral_bonuses",
        ))
        asyncio.create_task(create_notification_background(
            user_id=referee.id,
            title="Welcome Bonus! 🎉",
            body=f"You joined with a referral code! +{REFEREE_REWARD} points for you.",
            category="referral_bonuses",
            data={"type": "referral_bonus", "points": REFEREE_REWARD},
        ))
    except Exception:
        pass
