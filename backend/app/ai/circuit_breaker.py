"""AI provider circuit breaker.

Stores per-provider failure state in `ai_provider_health` so the
breaker survives process restarts. After `CIRCUIT_BREAKER_THRESHOLD`
consecutive failures the circuit opens for `CIRCUIT_OPEN_COOLDOWN`
seconds; during that window the router skips the provider.
"""

from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AiProviderHealth

CIRCUIT_BREAKER_THRESHOLD = 3
CIRCUIT_OPEN_COOLDOWN_SECONDS = 300  # 5 minutes


async def mark_failed(db: AsyncSession, provider_name: str) -> None:
    now = datetime.utcnow()
    result = await db.execute(
        select(AiProviderHealth).where(AiProviderHealth.provider_name == provider_name)
    )
    row = result.scalar_one_or_none()
    if row is None:
        row = AiProviderHealth(provider_name=provider_name)
        db.add(row)
    row.consecutive_failures = (row.consecutive_failures or 0) + 1
    row.last_failure_at = now
    if row.consecutive_failures >= CIRCUIT_BREAKER_THRESHOLD:
        from datetime import timedelta
        row.circuit_open_until = now + timedelta(seconds=CIRCUIT_OPEN_COOLDOWN_SECONDS)
    await db.commit()


async def mark_success(db: AsyncSession, provider_name: str) -> None:
    result = await db.execute(
        select(AiProviderHealth).where(AiProviderHealth.provider_name == provider_name)
    )
    row = result.scalar_one_or_none()
    if row is None:
        row = AiProviderHealth(provider_name=provider_name)
        db.add(row)
    row.consecutive_failures = 0
    row.circuit_open_until = None
    row.last_failure_at = None
    await db.commit()


async def get_circuit_open(db: AsyncSession) -> list[str]:
    """Return provider names whose circuit is currently open."""
    now = datetime.utcnow()
    result = await db.execute(
        select(AiProviderHealth.provider_name).where(
            AiProviderHealth.circuit_open_until > now
        )
    )
    return [row[0] for row in result.all()]
