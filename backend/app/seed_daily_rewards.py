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
            # Daily rewards (Days 1-7)
            DailyReward(day_number=1, reward_type="points", reward_value=100, title="Welcome Back!", description="Great to see you again", icon_emoji="🎯"),
            DailyReward(day_number=2, reward_type="points", reward_value=150, title="Getting Started", description="Building momentum", icon_emoji="⚡"),
            DailyReward(day_number=3, reward_type="points", reward_value=200, title="On a Roll", description="Keep it going", icon_emoji="🚀"),
            DailyReward(day_number=4, reward_type="points", reward_value=300, title="Consistency Pays", description="Four days strong", icon_emoji="💪"),
            DailyReward(day_number=5, reward_type="points", reward_value=400, title="Dedication", description="Five days in a row", icon_emoji="🔥"),
            DailyReward(day_number=6, reward_type="points", reward_value=500, title="Almost There", description="One more for the week", icon_emoji="⭐"),
            DailyReward(day_number=7, reward_type="points", reward_value=750, title="Week Complete!", description="Seven day streak bonus", icon_emoji="🏆"),
            
            # Weekly bonuses
            DailyReward(day_number=14, reward_type="multiplier", reward_value=120, title="Two Week Warrior", description="20% bonus multiplier", icon_emoji="🛡️"),
            DailyReward(day_number=21, reward_type="points", reward_value=1500, title="Three Week Legend", description="Major milestone bonus", icon_emoji="👑"),
            DailyReward(day_number=30, reward_type="multiplier", reward_value=150, title="Monthly Master", description="50% bonus multiplier", icon_emoji="💎"),
        ]
        
        for reward in rewards:
            db.add(reward)
        
        await db.commit()
        print(f"Created {len(rewards)} default daily rewards.")

if __name__ == "__main__":
    asyncio.run(seed_daily_rewards())