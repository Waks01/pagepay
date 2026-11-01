"""Admin user management endpoints.

CRUD operations for admin accounts: create, read, update, delete.
Only super_admin users can perform most operations.
Includes permission and role management.
"""

import logging
import json
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import AdminUser, AdminAuditLog
from app.services.admin_auth import (
    require_permission, hash_password,
)

logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/admins", tags=["admin-users"])


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


# ── Admin CRUD ───────────────────────────────────────────────────────


@router.get("")
async def list_admins(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    current_admin: AdminUser = Depends(require_permission("admins.view")),
    db: AsyncSession = Depends(get_db),
):
    """List all admin users with pagination."""
    query = select(AdminUser).order_by(AdminUser.created_at.desc())
    total = (
        await db.execute(select(func.count()).select_from(query.subquery()))
    ).scalar_one()
    rows = await db.execute(
        query.limit(limit).offset((page - 1) * limit)
    )

    items = []
    for admin in rows.scalars().all():
        perms = []
        if admin.permissions:
            try:
                perms = json.loads(admin.permissions)
            except (json.JSONDecodeError, TypeError):
                pass

        items.append({
            "id": admin.id,
            "email": admin.email,
            "role": admin.role,
            "permissions": perms,
            "is_active": admin.is_active,
            "last_login_at": admin.last_login_at.isoformat()
            if admin.last_login_at else None,
            "last_login_ip": admin.last_login_ip,
            "created_at": admin.created_at.isoformat(),
            "created_by": admin.created_by,
        })

    return {"items": items, "total": int(total), "page": page, "limit": limit}


@router.post("")
async def create_admin(
    request: Request,
    email: str = Query(...),
    password: str = Query(..., min_length=8),
    role: str = Query(...),
    permissions: str = Query(None),
    current_admin: AdminUser = Depends(require_permission("admins.create")),
    db: AsyncSession = Depends(get_db),
):
    """Create a new admin user."""
    # Verify email is unique
    existing = await db.execute(
        select(AdminUser).where(AdminUser.email == email.lower())
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already exists")

    # Validate role
    valid_roles = ["super_admin", "finance", "moderator", "support"]
    if role not in valid_roles:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid role. Must be one of: {valid_roles}",
        )

    # Only super_admin can create super_admin or finance users
    if role in ("super_admin", "finance") and current_admin.role != "super_admin":
        raise HTTPException(
            status_code=403,
            detail="Only super_admin can assign super_admin or finance roles",
        )

    # Parse permissions
    perms_list = []
    if permissions:
        try:
            perms_list = json.loads(permissions)
        except json.JSONDecodeError:
            # Try comma-separated string
            perms_list = [p.strip() for p in permissions.split(",") if p.strip()]

    # Create admin user
    new_admin = AdminUser(
        email=email.lower(),
        password_hash=hash_password(password),
        role=role,
        permissions=json.dumps(perms_list) if perms_list else None,
        is_active=True,
        created_by=current_admin.id,
    )
    db.add(new_admin)

    db.add(
        _log_admin_action(
            current_admin.id,
            current_admin.email,
            "create_admin",
            "admin_user",
            None,
                {
                    "email": email,
                    "role": role,
                    "permissions": perms_list,
                },
                request.client.host,
        )
    )

    await db.commit()
    await db.refresh(new_admin)

    return {
        "success": True,
        "admin_id": new_admin.id,
        "email": new_admin.email,
        "role": new_admin.role,
    }


@router.get("/{admin_id}")
async def get_admin_detail(
    admin_id: int,
    current_admin: AdminUser = Depends(require_permission("admins.view")),
    db: AsyncSession = Depends(get_db),
):
    """Get details of a specific admin user."""
    result = await db.execute(
        select(AdminUser).where(AdminUser.id == admin_id)
    )
    admin = result.scalar_one_or_none()
    if not admin:
        raise HTTPException(status_code=404, detail="Admin not found")

    perms = []
    if admin.permissions:
        try:
            perms = json.loads(admin.permissions)
        except (json.JSONDecodeError, TypeError):
            pass

    return {
        "id": admin.id,
        "email": admin.email,
        "role": admin.role,
        "permissions": perms,
        "is_active": admin.is_active,
        "last_login_at": admin.last_login_at.isoformat()
        if admin.last_login_at else None,
        "last_login_ip": admin.last_login_ip,
        "created_at": admin.created_at.isoformat(),
        "created_by": admin.created_by,
    }


@router.patch("/{admin_id}")
async def update_admin(
    admin_id: int,
    request: Request,
    role: str = Query(None),
    permissions: str = Query(None),
    is_active: bool = Query(None),
    current_admin: AdminUser = Depends(require_permission("admins.edit")),
    db: AsyncSession = Depends(get_db),
):
    """Update admin user role, permissions, or active status."""
    result = await db.execute(
        select(AdminUser).where(AdminUser.id == admin_id)
    )
    admin = result.scalar_one_or_none()
    if not admin:
        raise HTTPException(status_code=404, detail="Admin not found")

    # Prevent self-deactivation
    if is_active is False and admin.id == current_admin.id:
        raise HTTPException(
            status_code=400, detail="Cannot deactivate your own account"
        )

    # Only super_admin can modify super_admin
    if admin.role == "super_admin" and current_admin.role != "super_admin":
        raise HTTPException(
            status_code=403,
            detail="Only super_admin can modify super_admin users",
        )

    changes = {}

    if role is not None:
        valid_roles = ["super_admin", "finance", "moderator", "support"]
        if role not in valid_roles:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid role. Must be one of: {valid_roles}",
            )

        # Only super_admin can assign super_admin role
        if role == "super_admin" and current_admin.role != "super_admin":
            raise HTTPException(
                status_code=403,
                detail="Only super_admin can assign super_admin role",
            )

        changes["role"] = {"from": admin.role, "to": role}
        admin.role = role

    if permissions is not None:
        perms_list = []
        try:
            perms_list = json.loads(permissions)
        except json.JSONDecodeError:
            perms_list = [
                p.strip() for p in permissions.split(",") if p.strip()
            ]

        changes["permissions"] = {
            "from": admin.permissions,
            "to": json.dumps(perms_list),
        }
        admin.permissions = (
            json.dumps(perms_list) if perms_list else None
        )

    if is_active is not None:
        changes["is_active"] = {
            "from": admin.is_active,
            "to": is_active,
        }
        admin.is_active = is_active

    db.add(
        _log_admin_action(
            current_admin.id,
            current_admin.email,
            "update_admin",
            "admin_user",
            admin_id,
            changes,
            request.client.host,
        )
    )

    await db.commit()

    return {"success": True, "message": "Admin updated successfully"}


@router.post("/{admin_id}/reset-password")
async def reset_admin_password(
    request: Request,
    admin_id: int,
    new_password: str = Query(..., min_length=8),
    current_admin: AdminUser = Depends(require_permission("admins.reset_password")),
    db: AsyncSession = Depends(get_db),
):
    """Reset admin user password."""
    result = await db.execute(
        select(AdminUser).where(AdminUser.id == admin_id)
    )
    admin = result.scalar_one_or_none()
    if not admin:
        raise HTTPException(status_code=404, detail="Admin not found")

    # Only super_admin can reset other super_admin passwords
    if (
        admin.role == "super_admin"
        and current_admin.role != "super_admin"
        and admin.id != current_admin.id
    ):
        raise HTTPException(
            status_code=403,
            detail="Only super_admin can reset super_admin passwords",
        )

    admin.password_hash = hash_password(new_password)

    db.add(
        _log_admin_action(
            current_admin.id,
            current_admin.email,
            "reset_admin_password",
            "admin_user",
            admin_id,
            {"email": admin.email},
            request.client.host,
        )
    )

    await db.commit()

    return {"success": True, "message": "Password reset successfully"}


@router.delete("/{admin_id}")
async def delete_admin(
    admin_id: int,
    request: Request,
    current_admin: AdminUser = Depends(require_permission("admins.delete")),
    db: AsyncSession = Depends(get_db),
):
    """Delete (deactivate) an admin user."""
    result = await db.execute(
        select(AdminUser).where(AdminUser.id == admin_id)
    )
    admin = result.scalar_one_or_none()
    if not admin:
        raise HTTPException(status_code=404, detail="Admin not found")

    # Prevent self-deletion
    if admin.id == current_admin.id:
        raise HTTPException(
            status_code=400, detail="Cannot delete your own account"
        )

    # Only super_admin can delete super_admin
    if admin.role == "super_admin" and current_admin.role != "super_admin":
        raise HTTPException(
            status_code=403,
            detail="Only super_admin can delete super_admin users",
        )

    # Soft delete by deactivating
    admin.is_active = False

    db.add(
        _log_admin_action(
            current_admin.id,
            current_admin.email,
            "delete_admin",
            "admin_user",
            admin_id,
            {"email": admin.email, "role": admin.role},
            request.client.host,
        )
    )

    await db.commit()

    return {"success": True, "message": "Admin deactivated successfully"}
