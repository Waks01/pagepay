"""Per-user AI cost logging.

`AiUsageLog` is written at every metered AI call so the pricing model
can be measured: cost per active user, by cohort (free vs paid), and
margin (what we charged against what the call cost).

Two rules shape this module:

1. **Logging must never break a request.** Every call is wrapped; a
   failure to record usage is a telemetry gap, not a user-facing error.
2. **Cost is computed at write time** from the published model price.
   A later price change must not silently rewrite what a call cost last
   month — that would make the p50/p90/p99 meaningless.

`sv_charged` records what the user was billed. Comparing it to
`cost_usd` over a window is the whole point: it is the only number that
says whether chat metering and the generation charge actually returned
what they were supposed to.
"""

from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import AiUsageLog

logger = logging.getLogger("uvicorn.error")


def model_cost_usd(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    """USD cost of one call, from the published per-M-token price.

    Returns 0.0 for an unknown model rather than raising — telemetry
    should degrade, not fail. A new model that ships without a price
    entry shows up as free until someone adds it, which is a loud zero
    in the summary rather than a crash.
    """
    prices = settings.ai_model_cost_usd.get(model)
    if not prices:
        return 0.0
    return (
        prompt_tokens / 1_000_000 * prices.get("input", 0.0)
        + completion_tokens / 1_000_000 * prices.get("output", 0.0)
    )


async def log_usage(
    db: AsyncSession | None,
    *,
    user_id: int,
    endpoint: str,
    model: str,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    tier: str | None = None,
    sv_charged: int = 0,
    cost_usd: float | None = None,
) -> None:
    """Record one AI call. Never raises.

    `cost_usd` may be passed explicitly for non-token pricing (MeloTTS
    is billed per audio-minute); otherwise it is derived from the
    model's token price.
    """
    if db is None:
        return
    try:
        if cost_usd is None:
            cost_usd = model_cost_usd(model, prompt_tokens, completion_tokens)
        db.add(
            AiUsageLog(
                user_id=user_id,
                endpoint=endpoint,
                model=model,
                tier=tier,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                sv_charged=sv_charged,
                cost_usd=cost_usd,
            )
        )
        await db.commit()
    except Exception as exc:  # telemetry must never break a request
        logger.warning("Failed to log AI usage (%s): %s", endpoint, exc)
        try:
            await db.rollback()
        except Exception:
            pass


def margin_usd(sv_charged: int) -> float:
    """USD revenue of an SV amount.

    SV and points are the same unit at POINTS_PER_NAIRA per naira, so
    revenue in naira is sv / ppn, then converted at the naira-per-USD
    rate.
    """
    if sv_charged <= 0:
        return 0.0
    naira = sv_charged / settings.points_per_naira
    return naira / _naira_per_usd()


def _naira_per_usd() -> float:
    """Naira per USD, for turning SV revenue into USD.

    There is no FX setting in config — the rate is a business input, not
    a code constant. This default is the CBN NFEM rate observed in Oct
    2026 (N1,332.5/USD). Override via env `NAIRA_PER_USD` if the
    platform starts holding the rate centrally.
    """
    import os

    override = os.getenv("NAIRA_PER_USD")
    if override:
        try:
            return float(override)
        except ValueError:
            pass
    return 1332.5
