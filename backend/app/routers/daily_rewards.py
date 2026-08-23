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
from app.routers.streak import _update_login_streak, _get_timezone_offset_minutes, _user_local_date
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
    """Determine what reward the user can claim today based on their streak."""
    if user_streak.last_claim_date == today_str:
        return None  # Already claimed today
        
    current_streak = user_streak.current_streak
    
    # Find the appropriate reward for the current streak day
    # For streaks beyond day 7, we use special milestone rewards or cycle back
    if current_streak <= 7:
        # Days 1-7: direct mapping
        for reward in rewards:
            if reward.day_number == current_streak:
                return reward
    else:
        # Beyond day 7: check for milestone rewards or use day 7 reward
        milestone_rewards = [r for r in rewards if r.day_number in [14, 21, 30] and current_streak >= r.day_number]
        if milestone_rewards:
            # Use the highest applicable milestone
            return max(milestone_rewards, key=lambda r: r.day_number)
        else:
            # Fall back to day 7 reward for consistency
            for reward in rewards:
                if reward.day_number == 7:
                    return reward
    
    return None


@router.get("/daily/status")
async def get_daily_reward_status(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the user's current daily reward status - what they can claim today."""
    # Update user's login streak first
    streak = await _update_login_streak(current_user.id, db, request)
    
    # Get available rewards
    rewards = await _get_or_create_default_rewards(db)

    # Get today's date from client header (user's local date)
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

    # Find claimable reward
    claimable_reward = await _get_claimable_reward(streak, rewards, today_str)
    
    # Get recent claim history
    history_query = await db.execute(
        select(UserRewardClaim)
        .where(UserRewardClaim.user_id == current_user.id)
        .order_by(desc(UserRewardClaim.claimed_at))
        .limit(7)
    )
    recent_claims = history_query.fetchall()
    
    return DailyRewardStatus(
        current_streak=streak.current_streak,
        longest_streak=streak.longest_streak,
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
        last_claim_date=streak.last_claim_date,
        next_milestone_day=next((r.day_number for r in sorted(rewards, key=lambda x: x.day_number) 
                               if r.day_number > streak.current_streak), None),
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
    # Get current login streak status
    streak = await _update_login_streak(current_user.id, db, request)
    
    # Get available rewards
    rewards = await _get_or_create_default_rewards(db)

    # Get today's date from client header (user's local date)
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

    # Check if user already claimed today
    if streak.last_claim_date == today_str:
        raise HTTPException(status_code=400, detail="Already claimed reward for today")
    
    # Find claimable reward
    claimable_reward = await _get_claimable_reward(streak, rewards, today_str)
    
    if not claimable_reward:
        raise HTTPException(status_code=400, detail="No reward available to claim")
    
    # Calculate points to award
    points_to_award = claimable_reward.reward_value
    if claimable_reward.reward_type == "multiplier":
        # For multiplier rewards, give base points but also note the multiplier effect
        points_to_award = 500  # Base points for multiplier rewards
    
    # Create reward claim record
    claim = UserRewardClaim(
        user_id=current_user.id,
        reward_id=claimable_reward.id,
        claim_date=today_str,
        streak_day=streak.current_streak,
        points_earned=points_to_award
    )
    db.add(claim)
    
    # Update user's points
    current_user.points_balance += points_to_award
    
    # Update streak's last claim date
    streak.last_claim_date = today_str
    
    await db.commit()
    await db.refresh(claim)
    
    return DailyRewardClaim(
        success=True,
        points_earned=points_to_award,
        reward_title=claimable_reward.title,
        reward_description=claimable_reward.description,
        reward_emoji=claimable_reward.icon_emoji,
        new_total_points=current_user.points_balance,
        streak_day=streak.current_streak,
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