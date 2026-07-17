"""Admin authentication endpoints.

Handles admin login, logout, and current admin profile retrieval.
All endpoints use Bearer JWT authentication for subsequent requests.
"""

import logging
import json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import AdminUser
from app.schemas import AdminLoginRequest, AdminLoginResponse, AdminUserOut
from app.services.admin_auth import (
    get_current_admin, create_admin_token, hash_password, verify_password,
)

logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/auth", tags=["admin-auth"])


@router.post("/login")
async def admin_login(
    payload: AdminLoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Authenticate admin user and return session token via httpOnly cookie."""
    result = await db.execute(
        select(AdminUser).where(AdminUser.email == payload.email.lower())
    )
    admin = result.scalar_one_or_none()

    if not admin or not verify_password(payload.password, admin.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not admin.is_active:
        raise HTTPException(status_code=403, detail="Admin account is disabled")

    # Update last login timestamp
    admin.last_login_at = datetime.utcnow()
    await db.commit()

    # Parse permissions
    perms = []
    if admin.permissions:
        try:
            perms = json.loads(admin.permissions)
        except (json.JSONDecodeError, TypeError):
            pass

    # Create JWT token
    token = create_admin_token(admin.id, admin.role)

    # Set httpOnly cookie instead of returning token in response
    response.set_cookie(
        key="admin_session",
        value=token,
        httponly=True,
        secure=True,
        samesite="none",
        max_age=settings.access_token_expire_minutes * 60,
        path="/",
    )

    return AdminLoginResponse(
        access_token="",  # Don't send token in response body
        token_type="cookie",
        role=admin.role,
        permissions=perms,
    )


@router.get("/me", response_model=AdminUserOut)
async def admin_me(
    current_admin: AdminUser = Depends(get_current_admin),
):
    """Get current admin profile information."""
    perms = []
    if current_admin.permissions:
        try:
            perms = json.loads(current_admin.permissions)
        except (json.JSONDecodeError, TypeError):
            pass

    return AdminUserOut(
        id=current_admin.id,
        email=current_admin.email,
        role=current_admin.role,
        is_active=current_admin.is_active,
        last_login_at=current_admin.last_login_at,
        created_at=current_admin.created_at,
        permissions=perms,
    )


@router.post("/logout")
async def admin_logout(response: Response):
    """Clear admin session cookie and logout."""
    response.delete_cookie(key="admin_session", path="/", samesite="none")
    return {"success": True, "message": "Logged out successfully"}
