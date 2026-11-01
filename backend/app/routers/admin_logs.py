"""Audit log endpoints.

Track all administrative actions taken in the system. Provides searchable,
filterable audit trail for compliance and troubleshooting. Filter by action,
target type, admin, and date range.
"""

import logging
from datetime import datetime
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import AdminAuditLog, AdminUser
from app.schemas import AdminAuditLogOut
from app.services.admin_auth import require_permission

logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/logs", tags=["admin-logs"])


@router.get("", response_model=list[AdminAuditLogOut])
async def list_audit_logs(
    action: str | None = Query(None),
    target_type: str | None = Query(None),
    admin_id: int | None = Query(None),
    start_date: str | None = Query(None),
    end_date: str | None = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    current_admin: AdminUser = Depends(require_permission("logs.view")),
    db: AsyncSession = Depends(get_db),
):
    """List audit logs with filtering options."""
    q = select(AdminAuditLog)
    
    if action:
        q = q.where(AdminAuditLog.action == action)
    if target_type:
        q = q.where(AdminAuditLog.target_type == target_type)
    if admin_id:
        q = q.where(AdminAuditLog.admin_id == admin_id)
    if start_date:
        q = q.where(
            AdminAuditLog.created_at >=
            datetime.fromisoformat(start_date)
        )
    if end_date:
        q = q.where(
            AdminAuditLog.created_at <=
            datetime.fromisoformat(end_date)
        )
    
    total = (
        await db.execute(select(func.count()).select_from(q.subquery()))
    ).scalar_one()
    rows = await db.execute(
        q.order_by(AdminAuditLog.created_at.desc())
        .limit(limit)
        .offset((page - 1) * limit)
    )
    
    items = [
        AdminAuditLogOut.model_validate(r).model_dump()
        for r in rows.scalars().all()
    ]
    
    return items
