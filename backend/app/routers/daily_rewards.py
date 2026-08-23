"""Daily Rewards API endpoints.

Handles the daily claim system where users can claim rewards based on their login streak.
Supports daily rewards (days 1-7), weekly bonuses, and monthly rewards.
"""

import logging
from datetime import date, datetime, timedelta, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select, and_, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User, UserStreak, DailyReward, UserRewardClaim
from app.routers.auth import get_current_user
from app.routers.streak import _update_reward_streak, _claim_daily_reward_increment_streak, _get_timezone_offset_minutes, _user_local_date
from app.schemas import DailyRewardInfo, DailyRewardStatus, DailyRewardClaim, DailyRewardHistory

logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/rewards", tags=["daily_rewards"])


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
    """
    if user_streak.last_reward_claim_date == today_str:
        return None  # Already claimed today
        
    # Use reward streak instead of login streak
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
    """Get the user's current daily reward status - what they can claim today."""
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

    claimable_reward = await _get_claimable_reward(streak, rewards, today_str)
    
    history_query = await db.execute(
        select(UserRewardClaim)
        .where(UserRewardClaim.user_id == current_user.id)
        .order_by(desc(UserRewardClaim.claimed_at))
        .limit(7)
    )
    recent_claims = history_query.fetchall()
    
    return DailyRewardStatus(
        current_streak=streak.reward_streak,
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


@router.post("/daily/claim")
async def claim_daily_reward(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Claim today's daily reward if available."""
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
    
    claim = UserRewardClaim(
        user_id=current_user.id,
        reward_id=claimable_reward.id,
        claim_date=today_str,
        streak_day=streak.reward_streak + 1,
        points_earned=points_to_award
    )
    db.add(claim)
    
    current_user.points_balance += points_to_award
    
    updated_streak = await _claim_daily_reward_increment_streak(current_user.id, db, request)
    
    await db.commit()
    await db.refresh(claim)
    
    return DailyRewardClaim(
        success=True,
        points_earned=points_to_award,
        reward_title=claimable_reward.title,
        reward_description=claimable_reward.description,
        reward_emoji=claimable_reward.icon_emoji,
        new_total_points=current_user.points_balance,
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