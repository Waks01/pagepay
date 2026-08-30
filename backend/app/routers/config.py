"""Public config endpoints.

`GET /api/v1/config/platform` — returns platform revenue split percentages
and task base rates.
"""

from __future__ import annotations

import logging
from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.config import settings
from app.constants.task_rates import TASK_BASE_RATES_KOB


logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/config", tags=["config"])


@router.get("/platform")
async def get_platform_config(db: AsyncSession = Depends(get_db)) -> dict[str, float | dict[str, int]]:
    """Return platform revenue split percentages + task base rates.

    Shape:
        {
          "ad_revenue_platform_percent": 0.20,
          "ad_revenue_user_percent": 0.80,
          "task_revenue_platform_percent": 0.30,
          "task_revenue_worker_percent": 0.70,
          "task_base_rates_kobo": {
            "youtube_subscribe": 15000,
            "youtube_like": 5000,
            "youtube_watch": 10000,
            "youtube_comment": 30000
          }
        }

    Revenue values are fractions (0.20 = 20%). Task rates are in kobo
    so the client can render them without another conversion step.

    Task rates are read from AppConfig if present, otherwise the
    hardcoded `TASK_BASE_RATES_KOB` constants are used. The backend
    validation path also reads from the same source so there is
    exactly one source of truth for rates.
    """
    from app.constants.task_rates import get_task_rates_from_db
    task_rates = await get_task_rates_from_db(db)

    return {
        "ad_revenue_platform_percent": settings.platform_ad_revenue_percent,
        "ad_revenue_user_percent": 1.0 - settings.platform_ad_revenue_percent,
        "task_revenue_platform_percent": settings.platform_task_revenue_percent,
        "task_revenue_worker_percent": 1.0 - settings.platform_task_revenue_percent,
        "task_base_rates_kobo": task_rates,
        "paystack_public_key": settings.paystack_public_key or "",
    }
