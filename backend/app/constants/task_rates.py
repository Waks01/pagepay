"""Single source of truth for platform-controlled task base rates.

Every platform + task type combination that PagePay supports is declared
here. Values are in **kobo** so the backend can store/calculate with
integers and the client can render naira by dividing by 100.

To add a new platform or task type:
  1. Add the entry to `TASK_BASE_RATES_KOB`
  2. Add the task type to the `task_type` Literal in
     `backend/app/schemas/__init__.py`
  3. Update the frontend task-type picker if needed

Both the backend validation path and the `/api/v1/config/platform`
endpoint read from this mapping, so there is exactly one place to
change a rate.
"""

from typing import Dict
import json

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models import AppConfig

# Keys use the form `<platform>_<task_type>`.
# Values are minimum reward in kobo.
TASK_BASE_RATES_KOB: Dict[str, int] = {
    # YouTube
    "youtube_subscribe": 15_000,
    "youtube_like": 5_000,
    "youtube_watch": 10_000,
    "youtube_comment": 30_000,
    "youtube_share": 10_000,
    # Instagram
    "instagram_follow": 15_000,
    "instagram_like": 5_000,
    "instagram_comment": 30_000,
    "instagram_repost": 10_000,
    # TikTok
    "tiktok_follow": 15_000,
    "tiktok_like": 5_000,
    "tiktok_comment": 30_000,
    "tiktok_share": 10_000,
    # X / Twitter
    "twitter_follow": 15_000,
    "twitter_like": 5_000,
    "twitter_retweet": 10_000,
    "twitter_comment": 30_000,
    "twitter_share": 10_000,
    # Facebook
    "facebook_follow": 15_000,
    "facebook_like": 5_000,
    # LinkedIn
    "linkedin_follow": 15_000,
    "linkedin_like": 5_000,
    "linkedin_comment": 30_000,
    # Pinterest
    "pinterest_follow": 15_000,
    "pinterest_like": 5_000,
    "pinterest_repin": 10_000,
    "pinterest_comment": 30_000,
    # Telegram
    "telegram_join": 10_000,
    "telegram_view": 5_000,
    # Snapchat
    "snapchat_add_friend": 15_000,
    "snapchat_view_story": 5_000,
    # Reddit
    "reddit_follow": 15_000,
    "reddit_upvote": 5_000,
    "reddit_comment": 30_000,
    # Discord
    "discord_join_server": 10_000,
    "discord_verify": 5_000,
    "discord_message": 30_000,
}

TASK_RATES_CONFIG_KEY = "task_base_rates_kobo"


def get_min_reward_kobo(task_type: str) -> int | None:
    """Return the platform-controlled minimum reward for a task type,
    or ``None`` if the task type has no enforced base rate."""
    return TASK_BASE_RATES_KOB.get(task_type)


def get_supported_task_types() -> list[str]:
    """Return all task types that have a defined base rate."""
    return list(TASK_BASE_RATES_KOB.keys())


async def get_task_rates_from_db(db: AsyncSession) -> Dict[str, int]:
    """Return task base rates from AppConfig if present, otherwise
    fall back to the hardcoded constants.

    The AppConfig row uses key `task_base_rates_kobo` and stores a
    JSON object mapping task_type -> kobo.
    """
    result = await db.execute(
        select(AppConfig).where(AppConfig.key == TASK_RATES_CONFIG_KEY)
    )
    row = result.scalar_one_or_none()
    if row and row.value:
        try:
            parsed = json.loads(row.value)
            if isinstance(parsed, dict):
                return {str(k): int(v) for k, v in parsed.items()}
        except (json.JSONDecodeError, ValueError):
            pass
    return dict(TASK_BASE_RATES_KOB)


async def set_task_rates_in_db(db: AsyncSession, rates: Dict[str, int]) -> None:
    """Persist task base rates to AppConfig.

    Creates or updates the `task_base_rates_kobo` row.
    """
    result = await db.execute(
        select(AppConfig).where(AppConfig.key == TASK_RATES_CONFIG_KEY)
    )
    row = result.scalar_one_or_none()
    if row:
        row.value = json.dumps(rates)
    else:
        row = AppConfig(
            key=TASK_RATES_CONFIG_KEY,
            value=json.dumps(rates),
            environment="prod",
            description="Platform-controlled task base rates in kobo",
        )
        db.add(row)
    await db.commit()
