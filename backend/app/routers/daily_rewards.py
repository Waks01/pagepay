"""Daily Rewards API endpoints.

Handles the daily claim system where users can claim rewards based on their login streak.
Supports daily rewards (days 1-7), weekly bonuses, and monthly rewards.
"""

import hashlib
import logging
from datetime import date, datetime, timedelta, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select, and_, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User, UserStreak, DailyReward, UserRewardClaim, StreakFreezeLog, AdEvent
from app.routers.auth import get_current_user
from app.routers.streak import _update_reward_streak, _claim_daily_reward_increment_streak, _get_timezone_offset_minutes, _user_local_date
from app.schemas import DailyRewardInfo, DailyRewardStatus, DailyRewardClaim, DailyRewardHistory, StreakFreezeByAdRequest, StreakFreezeByAdResponse, StreakFreezeByPointsRequest, StreakFreezeByPointsResponse

logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/rewards", tags=["daily_rewards"])


def hash_device_id(device_id: str) -> str:
    """SHA-256 hash a raw device id for safe storage."""
    return hashlib.sha256(device_id.encode()).hexdigest()


async def _get_or_create_default_rewards(db: AsyncSession) -> List[DailyReward]:
    """Ensure default daily rewards exist in the database."""
    # Check if rewards already exist
    existing = await db.execute(select(DailyReward).where(DailyReward.is_active == True))
    rewards = existing.fetchall()
    
    if rewards:
        return [r[0] for r in rewards]
    
    # Create default reward structure
    default_rewards = [
        # Daily rewards (Days 1-7)
        DailyReward(day_number=1, reward_type="points", reward_value=100, title="Welcome Back!", description="Great to see you again", icon_emoji="🎯"),
        DailyReward(day_number=2, reward_type="points", reward_value=150, title="Getting Started", description="Building momentum", icon_emoji="⚡"),
        DailyReward(day_number=3, reward_type="points", reward_value=200, title="On a Roll", description="Keep it going", icon_emoji="🚀"),
        DailyReward(day_number=4, reward_type="points", reward_value=300, title="Consistency Pays", description="Four days strong", icon_emoji="💪"),
        DailyReward(day_number=5, reward_type="points", reward_value=400, title="Dedication", description="Five days in a row", icon_emoji="🔥"),
        DailyReward(day_number=6, reward_type="points", reward_value=500, title="Almost There", description="One more for the week", icon_emoji="⭐"),
        DailyReward(day_number=7, reward_type="points", reward_value=750, title="Week Complete!", description="Seven day streak bonus", icon_emoji="🏆"),
        
        # Weekly bonuses (Days 8-14, 15-21, etc.)
        DailyReward(day_number=14, reward_type="multiplier", reward_value=120, title="Two Week Warrior", description="20% bonus multiplier", icon_emoji="🛡️"),
        DailyReward(day_number=21, reward_type="points", reward_value=1500, title="Three Week Legend", description="Major milestone bonus", icon_emoji="👑"),
        DailyReward(day_number=30, reward_type="multiplier", reward_value=150, title="Monthly Master", description="50% bonus multiplier", icon_emoji="💎"),
    ]
    
    for reward in default_rewards:
        db.add(reward)
    
    await db.commit()
    
    # Fetch the newly created rewards
    result = await db.execute(select(DailyReward).where(DailyReward.is_active == True))
    return [r[0] for r in result.fetchall()]


async def _get_claimable_reward(user_streak: UserStreak, rewards: List[DailyReward], today_str: str) -> Optional[DailyReward]:
    """Determine what reward the user can claim today based on their REWARD STREAK.
    
    Uses reward_streak (claim-based) instead of current_streak (login-based).
    The reward day is based on consecutive days of claiming, not consecutive logins.
    
    IMPORTANT: This uses reward_streak which only increments when user CLAIMS a reward,
    not when they just open the app. Login streaks are tracked separately.
    """
    if user_streak.last_reward_claim_date == today_str:
        return None  # Already claimed today
        
    # Use reward streak instead of login streak
    # reward_streak tracks actual claims, not logins
    reward_day = user_streak.reward_streak + 1  # Next reward day to claim
    
    # Find the appropriate reward for the reward day
    # For days beyond 7, we use special milestone rewards or cycle back
    if reward_day <= 7:
        # Days 1-7: direct mapping
        for reward in rewards:
            if reward.day_number == reward_day:
                return reward
    else:
        # Beyond day 7: check for milestone rewards or cycle through days 1-7
        # Check if we're at a milestone day (14, 21, 30)
        if reward_day in [14, 21, 30]:
            for reward in rewards:
                if reward.day_number == reward_day:
                    return reward
        
        # Otherwise, cycle through days 1-7
        cycle_day = ((reward_day - 1) % 7) + 1  # Maps 8->1, 9->2, etc.
        for reward in rewards:
            if reward.day_number == cycle_day:
                return reward
    
    return None


@router.get("/daily/status")
async def get_daily_reward_status(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the user's current daily reward status - what they can claim today.
    
    IMPORTANT: This endpoint updates login streaks but NOT reward streaks.
    Reward streaks only increment when the user actually claims via /daily/claim.
    """
    # Get the current streak state (updates login tracking, checks reward expiration)
    streak_before = await db.execute(
        select(UserStreak).where(UserStreak.user_id == current_user.id)
    )
    streak_before_obj = streak_before.scalar_one_or_none()
    reward_streak_before = streak_before_obj.reward_streak if streak_before_obj else 0
    
    streak = await _update_reward_streak(current_user.id, db, request)
    
    # Verify reward_streak only changes due to expiration, not due to login
    if reward_streak_before > 0 and streak.reward_streak == 0:
        logger.info(
            "Reward streak expired: user=%d was=%d now=0",
            current_user.id, reward_streak_before
        )
    elif reward_streak_before != streak.reward_streak:
        logger.warning(
            "UNEXPECTED reward_streak change in /daily/status: user=%d before=%d after=%d",
            current_user.id, reward_streak_before, streak.reward_streak
        )
    
    rewards = await _get_or_create_default_rewards(db)

    client_date = request.headers.get("X-Client-Date")
    if client_date:
        try:
            today = date.fromisoformat(client_date)
        except (TypeError, ValueError):
            utc_now = datetime.now(timezone.utc)
            offset = _get_timezone_offset_minutes(request)
            today = _user_local_date(utc_now, offset)
    else:
        utc_now = datetime.now(timezone.utc)
        offset = _get_timezone_offset_minutes(request)
        today = _user_local_date(utc_now, offset)
    today_str = today.isoformat()

    claimable_reward = await _get_claimable_reward(streak, rewards, today_str)
    
    history_query = await db.execute(
        select(UserRewardClaim)
        .where(UserRewardClaim.user_id == current_user.id)
        .order_by(desc(UserRewardClaim.claimed_at))
        .limit(7)
    )
    recent_claims = history_query.fetchall()
    
    # IMPORTANT: Return reward_streak (claim-based), NOT current_streak (login-based)
    # reward_streak only increments when user actually claims a reward
    # current_streak increments every time user opens the app
    return DailyRewardStatus(
        current_streak=streak.reward_streak,  # This is the REWARD claim streak, not login streak
        longest_streak=streak.longest_reward_streak,
        can_claim_today=claimable_reward is not None,
        todays_reward=DailyRewardInfo(
            id=claimable_reward.id,
            day_number=claimable_reward.day_number,
            reward_type=claimable_reward.reward_type,
            reward_value=claimable_reward.reward_value,
            title=claimable_reward.title,
            description=claimable_reward.description,
            icon_emoji=claimable_reward.icon_emoji
        ) if claimable_reward else None,
        last_claim_date=streak.last_reward_claim_date,
        next_milestone_day=next((r.day_number for r in sorted(rewards, key=lambda x: x.day_number) 
                               if r.day_number > streak.reward_streak), None),
        recent_claims=[
            {
                "date": claim[0].claim_date,
                "points_earned": claim[0].points_earned,
                "streak_day": claim[0].streak_day
            } for claim in recent_claims
        ]
    )


@router.post("/daily/claim", response_model=DailyRewardClaim)
async def claim_daily_reward(
    request: Request,
    payload: DailyRewardClaimRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Claim today's daily reward if available."""
    # Device id hash guard for streak anti-abuse
    if payload.device_id:
        device_hash = hash_device_id(payload.device_id)
        if current_user.device_id_hash is None:
            current_user.device_id_hash = device_hash
        elif current_user.device_id_hash != device_hash:
            raise HTTPException(
                status_code=403,
                detail="Streak is bound to a different device.",
            )
    streak = await _update_reward_streak(current_user.id, db, request)
    rewards = await _get_or_create_default_rewards(db)

    client_date = request.headers.get("X-Client-Date")
    if client_date:
        try:
            today = date.fromisoformat(client_date)
        except (TypeError, ValueError):
            utc_now = datetime.now(timezone.utc)
            offset = _get_timezone_offset_minutes(request)
            today = _user_local_date(utc_now, offset)
    else:
        utc_now = datetime.now(timezone.utc)
        offset = _get_timezone_offset_minutes(request)
        today = _user_local_date(utc_now, offset)
    today_str = today.isoformat()

    if streak.last_reward_claim_date == today_str:
        raise HTTPException(status_code=400, detail="Already claimed reward for today")
    
    claimable_reward = await _get_claimable_reward(streak, rewards, today_str)
    
    if not claimable_reward:
        raise HTTPException(status_code=400, detail="No reward available to claim")
    
    points_to_award = claimable_reward.reward_value
    if claimable_reward.reward_type == "multiplier":
        points_to_award = 500
    
    # Apply premium multiplier to daily rewards (Phase 2)
    from app.services.subscription import get_points_multiplier
    base_points = points_to_award
    multiplier = get_points_multiplier(current_user, "daily")
    points_to_award = int(base_points * multiplier)
    
    claim = UserRewardClaim(
        user_id=current_user.id,
        reward_id=claimable_reward.id,
        claim_date=today_str,
        streak_day=streak.reward_streak + 1,
        points_earned=points_to_award
    )
    db.add(claim)
    
    if settings.wallet_split_enabled:
        current_user.service_credit_balance += points_to_award
    else:
        current_user.points_balance += points_to_award
    
    logger.info(
        "Daily reward claimed: user=%d tier=%s base=%d multiplier=%.1fx final=%d streak=%d",
        current_user.id, current_user.tier.value, base_points, multiplier,
        points_to_award, streak.reward_streak + 1
    )
    
    updated_streak = await _claim_daily_reward_increment_streak(current_user.id, db, request)
    
    await db.commit()
    await db.refresh(claim)
    
    # Send in-app notification: Daily reward claimed (Phase 6)
    from app.services.notifications import create_notification
    await create_notification(
        db=db,
        user_id=current_user.id,
        title=f"🎁 Daily Reward Claimed!",
        body=f"You earned {points_to_award} points! Keep your streak going - {updated_streak.reward_streak} days! {f'(Premium 2x boost applied)' if multiplier > 1 else ''}",
        category="daily_reward",
        data={
            "type": "daily_reward_claimed",
            "points_earned": points_to_award,
            "streak_day": updated_streak.reward_streak,
            "multiplier": multiplier,
        },
    )
    
    # Check for streak milestones (Phase 6)
    milestone_days = [7, 14, 30, 60, 90, 180, 365]
    if updated_streak.reward_streak in milestone_days:
        from app.services.premium_notifications import notify_streak_milestone
        await notify_streak_milestone(
            db=db,
            user_id=current_user.id,
            streak_days=updated_streak.reward_streak,
            milestone_reward=0,  # Could add bonus points for milestones
        )
    
    return DailyRewardClaim(
        success=True,
        points_earned=points_to_award,
        reward_title=claimable_reward.title,
        reward_description=claimable_reward.description,
        reward_emoji=claimable_reward.icon_emoji,
        new_total_points=current_user.service_credit_balance if settings.wallet_split_enabled else current_user.points_balance,
        streak_day=updated_streak.reward_streak,
        is_multiplier=claimable_reward.reward_type == "multiplier",
        multiplier_value=claimable_reward.reward_value if claimable_reward.reward_type == "multiplier" else None
    )


@router.get("/daily/history")
async def get_daily_reward_history(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    limit: int = 30
):
    """Get user's daily reward claim history."""
    query = await db.execute(
        select(UserRewardClaim, DailyReward)
        .join(DailyReward, UserRewardClaim.reward_id == DailyReward.id)
        .where(UserRewardClaim.user_id == current_user.id)
        .order_by(desc(UserRewardClaim.claimed_at))
        .limit(limit)
    )
    
    claims = query.fetchall()
    
    return DailyRewardHistory(
        claims=[
            {
                "date": claim[0].claim_date,
                "points_earned": claim[0].points_earned,
                "streak_day": claim[0].streak_day,
                "reward_title": claim[1].title,
                "reward_emoji": claim[1].icon_emoji,
                "reward_type": claim[1].reward_type,
                "claimed_at": claim[0].claimed_at.isoformat()
            } for claim in claims
        ],
        total_points_earned=sum(claim[0].points_earned for claim in claims)
    )


@router.get("/daily/config")
async def get_daily_reward_config(
    db: AsyncSession = Depends(get_db),
):
    """Get the active daily reward configuration (all rewards)."""
    result = await db.execute(
        select(DailyReward).where(DailyReward.is_active == True).order_by(DailyReward.day_number)
    )
    rewards = result.scalars().all()
    
    return [
        {
            "id": r.id,
            "day_number": r.day_number,
            "reward_type": r.reward_type,
            "reward_value": r.reward_value,
            "title": r.title,
            "description": r.description,
            "icon_emoji": r.icon_emoji,
        }
        for r in rewards
    ]


def _streak_freeze_cost(previous_streak_day: int) -> int:
    if previous_streak_day <= 6:
        return 5
    elif previous_streak_day <= 13:
        return 10
    elif previous_streak_day <= 20:
        return 15
    elif previous_streak_day <= 29:
        return 20
    else:
        return 30


async def _get_last_claim(db: AsyncSession, user_id: int) -> UserRewardClaim | None:
    result = await db.execute(
        select(UserRewardClaim)
        .where(UserRewardClaim.user_id == user_id)
        .order_by(desc(UserRewardClaim.claimed_at))
        .limit(1)
    )
    return result.scalar_one_or_none()


@router.post("/daily/freeze-by-ad", response_model=StreakFreezeByAdResponse)
async def freeze_streak_by_ad(
    payload: StreakFreezeByAdRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if payload.device_id:
        device_hash = hash_device_id(payload.device_id)
        if current_user.device_id_hash is None:
            current_user.device_id_hash = device_hash
        elif current_user.device_id_hash != device_hash:
            raise HTTPException(status_code=403, detail="Streak is bound to a different device.")

    streak = await _update_reward_streak(current_user.id, db, request)

    if streak.reward_streak > 0:
        raise HTTPException(status_code=400, detail="Streak is not broken.")

    last_claim = await _get_last_claim(db, current_user.id)
    if not last_claim or (datetime.utcnow() - last_claim.claimed_at) > timedelta(hours=48):
        raise HTTPException(status_code=400, detail="No recent streak to recover.")

    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    existing = await db.execute(
        select(StreakFreezeLog).where(
            StreakFreezeLog.user_id == current_user.id,
            StreakFreezeLog.method == "ad",
            StreakFreezeLog.created_at >= today_start,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Ad-recovery already used today.")

    ad_event_id = None
    recent_ad = await db.execute(
        select(AdEvent).where(
            AdEvent.user_id == current_user.id,
            AdEvent.credit_status == "credited",
        ).order_by(desc(AdEvent.created_at)).limit(1)
    )
    recent_ad_row = recent_ad.scalar_one_or_none()
    if recent_ad_row:
        ad_event_id = recent_ad_row.id

    yesterday = date.today() - timedelta(days=1)
    streak.reward_streak = last_claim.streak_day
    streak.last_reward_claim_date = yesterday.isoformat()
    streak.last_claim_date = yesterday.isoformat()
    streak.reward_streak_expires_at = datetime.utcnow() + timedelta(hours=24)

    freeze_log = StreakFreezeLog(
        user_id=current_user.id,
        method="ad",
        sv_spent=0,
        streak_length_at_freeze=last_claim.streak_day,
        ad_event_id=ad_event_id,
        device_id_hash=current_user.device_id_hash,
    )
    db.add(freeze_log)
    await db.commit()
    await db.refresh(streak)

    next_claim = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    return StreakFreezeByAdResponse(recovered=True, next_claim_available_at=next_claim)


@router.post("/daily/freeze-by-points", response_model=StreakFreezeByPointsResponse)
async def freeze_streak_by_points(
    payload: StreakFreezeByPointsRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if payload.device_id:
        device_hash = hash_device_id(payload.device_id)
        if current_user.device_id_hash is None:
            current_user.device_id_hash = device_hash
        elif current_user.device_id_hash != device_hash:
            raise HTTPException(status_code=403, detail="Streak is bound to a different device.")

    streak = await _update_reward_streak(current_user.id, db, request)

    if streak.reward_streak > 0:
        raise HTTPException(status_code=400, detail="Streak is not broken.")

    last_claim = await _get_last_claim(db, current_user.id)
    if not last_claim or (datetime.utcnow() - last_claim.claimed_at) > timedelta(hours=48):
        raise HTTPException(status_code=400, detail="No recent streak to recover.")

    cost = _streak_freeze_cost(last_claim.streak_day)
    if current_user.service_credit_balance < cost:
        raise HTTPException(
            status_code=402,
            detail=f"Insufficient service credits. Need {cost} sv to recover streak.",
        )

    current_user.service_credit_balance -= cost
    yesterday = date.today() - timedelta(days=1)
    streak.reward_streak = last_claim.streak_day
    streak.last_reward_claim_date = yesterday.isoformat()
    streak.last_claim_date = yesterday.isoformat()
    streak.reward_streak_expires_at = datetime.utcnow() + timedelta(hours=24)

    freeze_log = StreakFreezeLog(
        user_id=current_user.id,
        method="points",
        sv_spent=cost,
        streak_length_at_freeze=last_claim.streak_day,
        device_id_hash=current_user.device_id_hash,
    )
    db.add(freeze_log)
    await db.commit()
    await db.refresh(current_user)
    await db.refresh(streak)

    return StreakFreezeByPointsResponse(recovered=True, sv_spent=cost, new_balance=current_user.service_credit_balance)