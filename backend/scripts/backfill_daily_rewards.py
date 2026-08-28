"""Backfill daily_rewards table with §5 values.

Run: python -m backend.scripts.backfill_daily_rewards
"""
import asyncio
from sqlalchemy import select, update
from app.database import AsyncSessionLocal
from app.models import DailyReward

# reward-system-migration.md §5 values
DEFAULT_REWARDS = [
    (1, 50, "Welcome Back!", "Great to see you again", "🎯"),
    (2, 50, "Getting Started", "Building momentum", "⚡"),
    (3, 50, "On a Roll", "Keep it going", "🚀"),
    (4, 50, "Consistency Pays", "Four days strong", "💪"),
    (5, 50, "Dedication", "Five days in a row", "🔥"),
    (6, 50, "Almost There", "One more for the week", "⭐"),
    (7, 200, "Week Warrior", "7-day streak milestone", "🏆"),
    (14, 350, "Two Week Champion", "14-day streak milestone", "🛡️"),
    (21, 500, "Three Week Legend", "21-day streak milestone", "👑"),
    (30, 800, "Monthly Master", "30-day streak milestone", "💎"),
    (60, 1500, "Diamond Streak", "60-day streak milestone", "💍"),
    (100, 3000, "Centurion", "100-day streak milestone", "🎖️"),
    (365, 15000, "Yearly Legend", "365-day streak milestone", "👑"),
]


async def backfill():
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(DailyReward).where(DailyReward.is_active == True))
        existing = {r[0].day_number: r[0] for r in result.fetchall()}

        updated = 0
        for day_number, reward_value, title, description, icon in DEFAULT_REWARDS:
            if day_number in existing:
                row = existing[day_number]
                if (
                    row.reward_value != reward_value
                    or row.title != title
                    or row.description != description
                    or row.icon_emoji != icon
                ):
                    row.reward_value = reward_value
                    row.title = title
                    row.description = description
                    row.icon_emoji = icon
                    updated += 1
            else:
                db.add(
                    DailyReward(
                        day_number=day_number,
                        reward_type="points",
                        reward_value=reward_value,
                        title=title,
                        description=description,
                        icon_emoji=icon,
                        is_active=True,
                    )
                )
                updated += 1

        await db.commit()
        print(f"Daily rewards backfilled: {updated} rows updated/created.")


if __name__ == "__main__":
    asyncio.run(backfill())
