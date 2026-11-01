"""Configuration management endpoints.

Manage application configuration values stored in database.
Update feature flags, thresholds, and settings without redeployment.
All changes are logged in audit trail.
"""

import logging
import json
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import AppConfig, AdminUser, AdminAuditLog
from app.schemas import ConfigItem, ConfigUpdateRequest
from app.services.admin_auth import require_permission

logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/config", tags=["admin-config"])


# ── Helpers ─────────────────────────────────────────────────────────


def _log_admin_action(
    admin_id: int | None,
    admin_email: str | None,
    action: str,
    target_type: str,
    target_id: int | None,
    changes: dict | None,
    ip: str | None = None,
    result: str = "success",
    error: str | None = None,
):
    """Create an audit log entry for admin actions."""
    return AdminAuditLog(
        admin_id=admin_id,
        admin_email=admin_email,
        action=action,
        target_type=target_type,
        target_id=target_id,
        changes=json.dumps(changes) if changes else None,
        ip_address=ip,
        result=result,
        error_message=error,
    )


# ── Configuration Management ────────────────────────────────────────


@router.get("")
async def list_config(
    current_admin: AdminUser = Depends(require_permission("config.view")),
    db: AsyncSession = Depends(get_db),
):
    """List all application configuration values."""
    rows = await db.execute(
        select(AppConfig).order_by(AppConfig.key)
    )
    
    return [
        ConfigItem(
            key=c.key,
            value=c.value,
            environment=c.environment,
            description=c.description,
            updated_at=c.updated_at,
        ).model_dump()
        for c in rows.scalars().all()
    ]


@router.put("/{key}")
async def update_config(
    request: Request,
    key: str,
    payload: ConfigUpdateRequest,
    current_admin: AdminUser = Depends(require_permission("config.edit")),
    db: AsyncSession = Depends(get_db),
):
    """Update a configuration value."""
    result = await db.execute(
        select(AppConfig).where(AppConfig.key == key)
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(status_code=404, detail="Config key not found")
    
    old = config.value
    config.value = payload.value
    if payload.description is not None:
        config.description = payload.description
    
    db.add(
        _log_admin_action(
            current_admin.id,
            current_admin.email,
            "update_config",
            "config",
            None,
            {"key": key, "old": old, "new": payload.value},
            request.client.host,
        )
    )
    
    await db.commit()
    
    return {"success": True}


@router.get("/task-rates")
async def get_task_rates(
    current_admin: AdminUser = Depends(require_permission("config.view")),
    db: AsyncSession = Depends(get_db),
):
    """Return current task base rates from AppConfig or constants."""
    from app.constants.task_rates import get_task_rates_from_db
    rates = await get_task_rates_from_db(db)
    return {"task_base_rates_kobo": rates}


@router.put("/task-rates")
async def update_task_rates(
    request: Request,
    payload: dict,
    current_admin: AdminUser = Depends(require_permission("config.edit")),
    db: AsyncSession = Depends(get_db),
):
    """Update task base rates.

    Payload shape:
        {
          "youtube_subscribe": 15000,
          "youtube_like": 5000,
          ...
        }
    """
    from app.constants.task_rates import get_task_rates_from_db, set_task_rates_in_db, TASK_RATES_CONFIG_KEY

    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Payload must be a JSON object")

    for key, value in payload.items():
        if not isinstance(key, str):
            raise HTTPException(status_code=400, detail=f"Invalid task rate key: {key}")
        try:
            int_value = int(value)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail=f"Invalid kobo value for {key}: {value}")
        if int_value < 0:
            raise HTTPException(status_code=400, detail=f"Negative rate not allowed: {key}")

    old_rates = await get_task_rates_from_db(db)
    await set_task_rates_in_db(db, {str(k): int(v) for k, v in payload.items()})

    db.add(
        _log_admin_action(
            current_admin.id,
            current_admin.email,
            "update_task_rates",
            "config",
            None,
            {"old": old_rates, "new": payload},
            request.client.host,
        )
    )
    await db.commit()

    return {"success": True, "task_base_rates_kobo": payload}
