"""AI provider health monitoring endpoints.

Monitor the health status of external AI providers including consecutive failures,
circuit breaker status, and last failure timestamps. Helps identify provider outages
and routing issues.
"""

import logging
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import AiProviderHealth, AdminUser
from app.services.admin_auth import require_permission

logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/ai", tags=["admin-ai"])


@router.get("/health")
async def ai_health(
    current_admin: AdminUser = Depends(require_permission("ai.view")),
    db: AsyncSession = Depends(get_db),
):
    """Get health status of all AI providers."""
    rows = await db.execute(
        select(AiProviderHealth).order_by(AiProviderHealth.provider_name)
    )
    
    return [
        {
            "provider": h.provider_name,
            "consecutive_failures": h.consecutive_failures,
            "circuit_open_until": (
                h.circuit_open_until.isoformat()
                if h.circuit_open_until else None
            ),
            "last_failure_at": (
                h.last_failure_at.isoformat()
                if h.last_failure_at else None
            ),
        }
        for h in rows.scalars().all()
    ]
