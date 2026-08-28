"""Seed default daily rewards configuration."""

import asyncio
from sqlalchemy import select
from app.database import AsyncSessionLocal
from app.models import DailyReward

async def seed_daily_rewards():
    """Create default daily rewards if they don't exist."""
    async with AsyncSessionLocal() as db:
        # Check if rewards already exist
        existing = await db.execute(select(DailyReward).limit(1))
        if existing.scalar_one_or_none():
            print("Daily rewards already exist, skipping seed.")
            return
        
        # Create default reward structure
        rewards = [
            # Daily rewards (Days 1-6): 50 sp each
            DailyReward(day_number=1, reward_type="points", reward_value=50, title="Welcome Back!", description="Great to see you again", icon_emoji="🎯"),
            DailyReward(day_number=2, reward_type="points", reward_value=50, title="Getting Started", description="Building momentum", icon_emoji="⚡"),
            DailyReward(day_number=3, reward_type="points", reward_value=50, title="On a Roll", description="Keep it going", icon_emoji="🚀"),
            DailyReward(day_number=4, reward_type="points", reward_value=50, title="Consistency Pays", description="Four days strong", icon_emoji="💪"),
            DailyReward(day_number=5, reward_type="points", reward_value=50, title="Dedication", description="Five days in a row", icon_emoji="🔥"),
            DailyReward(day_number=6, reward_type="points", reward_value=50, title="Almost There", description="One more for the week", icon_emoji="⭐"),
            DailyReward(day_number=7, reward_type="points", reward_value=200, title="Week Warrior", description="7-day streak milestone", icon_emoji="🏆"),
            
            # Milestones
            DailyReward(day_number=14, reward_type="points", reward_value=350, title="Two Week Champion", description="14-day streak milestone", icon_emoji="🛡️"),
            DailyReward(day_number=21, reward_type="points", reward_value=500, title="Three Week Legend", description="21-day streak milestone", icon_emoji="👑"),
            DailyReward(day_number=30, reward_type="points", reward_value=800, title="Monthly Master", description="30-day streak milestone", icon_emoji="💎"),
            DailyReward(day_number=60, reward_type="points", reward_value=1500, title="Diamond Streak", description="60-day streak milestone", icon_emoji="💍"),
            DailyReward(day_number=100, reward_type="points", reward_value=3000, title="Centurion", description="100-day streak milestone", icon_emoji="🎖️"),
            DailyReward(day_number=365, reward_type="points", reward_value=15000, title="Yearly Legend", description="365-day streak milestone", icon_emoji="👑"),
        ]
        
        for reward in rewards:
            db.add(reward)
        
        await db.commit()
        print(f"Created {len(rewards)} default daily rewards.")

if __name__ == "__main__":
    asyncio.run(seed_daily_rewards())