"""Platform user management endpoints.

Admin operations on platform users: ban, unban, adjust balance, view details,
reading sessions, and transaction history. Includes user filtering and search.
"""

import logging
import json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import (
    User, ReadingSession, PayoutTransaction, Payment, AdminUser,
    AdminAuditLog,
)
from app.schemas import UserListResponse
from app.services.admin_auth import require_permission

logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/users", tags=["admin-users-management"])


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


# ── User Listing & Details ──────────────────────────────────────────


@router.get("")
async def list_users(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    tier: str | None = Query(None),
    status: str | None = Query(None),
    search: str | None = Query(None),
    current_admin: AdminUser = Depends(require_permission("users.view")),
    db: AsyncSession = Depends(get_db),
):
    """List platform users with filtering and search."""
    query = select(User)
    if tier:
        query = query.where(User.tier == tier)
    if status:
        query = query.where(User.status == status)
    if search:
        query = query.where(
            (User.email.ilike(f"%{search}%")) |
            (User.phone.ilike(f"%{search}%"))
        )

    total = (
        await db.execute(select(func.count()).select_from(query.subquery()))
    ).scalar_one()
    rows = await db.execute(
        query.order_by(User.created_at.desc()).limit(limit).offset(
            (page - 1) * limit
        )
    )

    items = []
    for u in rows.scalars().all():
        # Defensive serialization: every field defaults to a JSON-safe
        # placeholder so a single bad row (None datetime, unknown enum
        # value from a manual DB edit, etc) doesn't 500 the whole page.
        # An admin list view must always render — better to show "—"
        # for one cell than to fail the entire request.
        tier_val = u.tier
        if hasattr(tier_val, "value"):
            tier_val = tier_val.value
        elif tier_val is not None:
            tier_val = str(tier_val)
        items.append({
            "id": u.id,
            "email": u.email,
            "phone": u.phone,
            "tier": tier_val,
            "status": u.status,
            "points_balance": u.points_balance,
            "referral_code": u.referral_code,
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "last_active_at": (
                u.last_login_at.isoformat()
                if u.last_login_at else None
            ),
        })

    return UserListResponse(
        items=items, total=int(total), page=page, limit=limit
    )


@router.get("/{user_id}")
async def get_user_detail(
    user_id: int,
    current_admin: AdminUser = Depends(require_permission("users.view")),
    db: AsyncSession = Depends(get_db),
):
    """Get detailed information about a specific user."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    return {
        "id": user.id,
        "email": user.email,
        "phone": user.phone,
        "tier": user.tier.value if hasattr(user.tier, "value") else str(user.tier),
        "status": user.status,
        "points_balance": user.points_balance,
        "referral_code": user.referral_code,
        "referred_by": user.referred_by,
        "subscription_expires_at": (
            user.subscription_expires_at.isoformat()
            if user.subscription_expires_at else None
        ),
        "created_at": user.created_at.isoformat(),
        "last_active_at": (
            user.last_login_at.isoformat()
            if user.last_login_at else None
        ),
    }


# ── User Actions ────────────────────────────────────────────────────


@router.post("/{user_id}/ban")
async def ban_user(
    request: Request,
    user_id: int,
    reason: str = Query(...),
    current_admin: AdminUser = Depends(require_permission("users.ban")),
    db: AsyncSession = Depends(get_db),
):
    """Ban a user from the platform."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    user.status = "banned"
    user.banned_at = datetime.utcnow()
    user.ban_reason = reason
    user.banned_by = current_admin.id
    
    db.add(
        _log_admin_action(
            current_admin.id,
            current_admin.email,
            "ban_user",
            "user",
            user_id,
            {
                "status": {"from": "active", "to": "banned"},
                "reason": reason,
            },
            request.client.host,
        )
    )
    
    await db.commit()
    return {"success": True}


@router.post("/{user_id}/unban")
async def unban_user(
    request: Request,
    user_id: int,
    current_admin: AdminUser = Depends(require_permission("users.ban")),
    db: AsyncSession = Depends(get_db),
):
    """Unban a user and restore platform access."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    user.status = "active"
    user.banned_at = None
    user.ban_reason = None
    user.banned_by = None
    
    db.add(
        _log_admin_action(
            current_admin.id,
            current_admin.email,
            "unban_user",
            "user",
            user_id,
            {"status": {"from": "banned", "to": "active"}},
            request.client.host,
        )
    )
    
    await db.commit()
    return {"success": True}


@router.post("/{user_id}/adjust-balance")
async def adjust_balance(
    request: Request,
    user_id: int,
    amount: int = Query(...),
    reason: str = Query(...),
    current_admin: AdminUser = Depends(require_permission("users.adjust_balance")),
    db: AsyncSession = Depends(get_db),
):
    """Adjust user's point balance (add or deduct)."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    old_balance = user.points_balance
    user.points_balance = max(0, old_balance + amount)
    
    db.add(
        _log_admin_action(
            current_admin.id,
            current_admin.email,
            "adjust_balance",
            "user",
            user_id,
            {
                "points": {"from": old_balance, "to": user.points_balance},
                "reason": reason,
            },
            request.client.host,
        )
    )
    
    await db.commit()
    return {"success": True, "new_balance": user.points_balance}

# ── User Sessions & Transactions ────────────────────────────────────


@router.get("/{user_id}/sessions")
async def get_user_sessions(
    user_id: int,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    current_admin: AdminUser = Depends(require_permission("users.view")),
    db: AsyncSession = Depends(get_db),
):
    """Get reading sessions for a user."""
    q = (
        select(ReadingSession)
        .where(ReadingSession.user_id == user_id)
        .order_by(ReadingSession.start_time.desc())
    )
    total = (
        await db.execute(select(func.count()).select_from(q.subquery()))
    ).scalar_one()
    rows = await db.execute(q.limit(limit).offset((page - 1) * limit))
    
    items = [
        {
            "id": s.id,
            "content_id": s.content_id,
            "start_time": s.start_time.isoformat(),
            "duration_seconds": s.duration_seconds,
            "verified": s.verified,
            "points_earned": s.points_earned,
        }
        for s in rows.scalars().all()
    ]
    
    return {"items": items, "total": int(total), "page": page, "limit": limit}


@router.get("/{user_id}/transactions")
async def get_user_transactions(
    user_id: int,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    current_admin: AdminUser = Depends(require_permission("users.view")),
    db: AsyncSession = Depends(get_db),
):
    """Get all transactions for a user (payouts, payments, etc)."""
    payout_q = (
        select(PayoutTransaction)
        .where(PayoutTransaction.user_id == user_id)
    )
    payment_q = select(Payment).where(Payment.user_id == user_id)
    
    # Simplified: return both as items
    items = []
    
    # Payouts
    rows = await db.execute(
        payout_q.limit(limit).offset((page - 1) * limit)
    )
    for r in rows.scalars().all():
        items.append({
            "type": "payout",
            "id": r.id,
            "amount_kobo": r.amount_kobo,
            "status": r.status,
            "created_at": r.created_at.isoformat(),
        })
    
    # Payments
    rows = await db.execute(
        payment_q.limit(limit).offset((page - 1) * limit)
    )
    for r in rows.scalars().all():
        items.append({
            "type": "payment",
            "id": r.id,
            "amount_kobo": r.amount_kobo,
            "tier": r.tier,
            "status": r.status,
            "created_at": r.created_at.isoformat(),
        })
    
    return {"items": items, "total": len(items), "page": page, "limit": limit}

