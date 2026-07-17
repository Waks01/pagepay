"""Fraud detection and resolution endpoints.

Lists and manages fraud flags: suspicious sessions, duplicate accounts,
referral abuse. Allows admins to resolve (legitimate), ignore (false positive),
and manually flag users for manual review.
"""

import logging
import json
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import FraudFlag, User, AdminUser, AdminAuditLog
from app.schemas import FraudFlagOut
from app.services.admin_auth import require_permission

logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/fraud", tags=["admin-fraud"])


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


# ── Fraud Listing ───────────────────────────────────────────────────


@router.get("/sessions")
async def list_fraud_sessions(
    severity: str | None = Query(None),
    status: str | None = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    current_admin: AdminUser = Depends(require_permission("fraud.view")),
    db: AsyncSession = Depends(get_db),
):
    """List suspicious reading sessions flagged for fraud review."""
    q = select(FraudFlag).where(
        FraudFlag.flag_type == "suspicious_session"
    )
    
    if severity:
        q = q.where(FraudFlag.severity == severity)
    if status:
        q = q.where(FraudFlag.status == status)
    
    total = (
        await db.execute(select(func.count()).select_from(q.subquery()))
    ).scalar_one()
    rows = await db.execute(
        q.order_by(FraudFlag.created_at.desc())
        .limit(limit)
        .offset((page - 1) * limit)
    )
    
    items = [
        FraudFlagOut.model_validate(f).model_dump()
        for f in rows.scalars().all()
    ]
    
    return {"items": items, "total": int(total), "page": page, "limit": limit}


@router.get("/duplicates")
async def list_fraud_duplicates(
    current_admin: AdminUser = Depends(require_permission("fraud.view")),
    db: AsyncSession = Depends(get_db),
):
    """List potential duplicate account fraud flags."""
    rows = await db.execute(
        select(FraudFlag)
        .where(FraudFlag.flag_type == "duplicate_account")
        .order_by(FraudFlag.created_at.desc())
        .limit(50)
    )
    
    items = [
        FraudFlagOut.model_validate(f).model_dump()
        for f in rows.scalars().all()
    ]
    
    return {"items": items, "total": len(items)}


@router.get("/referrals")
async def list_fraud_referrals(
    current_admin: AdminUser = Depends(require_permission("fraud.view")),
    db: AsyncSession = Depends(get_db),
):
    """List referral abuse fraud flags."""
    rows = await db.execute(
        select(FraudFlag)
        .where(FraudFlag.flag_type == "referral_abuse")
        .order_by(FraudFlag.created_at.desc())
        .limit(50)
    )
    
    items = [
        FraudFlagOut.model_validate(f).model_dump()
        for f in rows.scalars().all()
    ]
    
    return {"items": items, "total": len(items)}


# ── Fraud Resolution ────────────────────────────────────────────────


@router.post("/{flag_id}/resolve")
async def resolve_fraud_flag(
    request: Request,
    flag_id: int,
    notes: str = Query(None),
    current_admin: AdminUser = Depends(require_permission("fraud.resolve")),
    db: AsyncSession = Depends(get_db),
):
    """Mark fraud flag as resolved (legitimate activity confirmed)."""
    result = await db.execute(
        select(FraudFlag).where(FraudFlag.id == flag_id)
    )
    flag = result.scalar_one_or_none()
    if not flag:
        raise HTTPException(status_code=404, detail="Fraud flag not found")

    if flag.status == "resolved":
        raise HTTPException(status_code=400, detail="Flag already resolved")

    old_status = flag.status
    flag.status = "resolved"
    flag.reviewed_at = datetime.utcnow()
    flag.reviewed_by = current_admin.id

    # Append resolution notes to details
    if notes:
        flag.details = f"{flag.details}\n\n[Admin Resolution] {notes}"

    db.add(
        _log_admin_action(
            current_admin.id,
            current_admin.email,
            "resolve_fraud_flag",
            "fraud_flag",
            flag_id,
            {
                "flag_type": flag.flag_type,
                "severity": flag.severity,
                "user_id": flag.user_id,
                "status": {"from": old_status, "to": "resolved"},
                "notes": notes,
            },
            request.client.host,
        )
    )
    
    await db.commit()

    return {"success": True, "message": "Fraud flag resolved"}


@router.post("/{flag_id}/ignore")
async def ignore_fraud_flag(
    request: Request,
    flag_id: int,
    reason: str = Query(...),
    current_admin: AdminUser = Depends(require_permission("fraud.resolve")),
    db: AsyncSession = Depends(get_db),
):
    """Mark fraud flag as false positive (ignore)."""
    result = await db.execute(
        select(FraudFlag).where(FraudFlag.id == flag_id)
    )
    flag = result.scalar_one_or_none()
    if not flag:
        raise HTTPException(status_code=404, detail="Fraud flag not found")

    if flag.status in ["resolved", "ignored"]:
        raise HTTPException(
            status_code=400, detail=f"Flag already {flag.status}"
        )

    old_status = flag.status
    flag.status = "ignored"
    flag.reviewed_at = datetime.now(timezone.utc)
    flag.reviewed_by = current_admin.id

    # Append ignore reason to details
    flag.details = f"{flag.details}\n\n[Admin False Positive] {reason}"

    db.add(
        _log_admin_action(
            current_admin.id,
            current_admin.email,
            "ignore_fraud_flag",
            "fraud_flag",
            flag_id,
            {
                "flag_type": flag.flag_type,
                "severity": flag.severity,
                "user_id": flag.user_id,
                "status": {"from": old_status, "to": "ignored"},
                "reason": reason,
            },
            request.client.host,
        )
    )
    
    await db.commit()

    return {"success": True, "message": "Fraud flag marked as false positive"}


@router.post("/user/{user_id}/flag")
async def manually_flag_user(
    request: Request,
    user_id: int,
    flag_type: str = Query(...),
    severity: str = Query(..., regex="^(low|medium|high)$"),
    details: str = Query(...),
    current_admin: AdminUser = Depends(require_permission("fraud.flag")),
    db: AsyncSession = Depends(get_db),
):
    """Manually create a fraud flag for a user."""
    # Verify user exists
    user_result = await db.execute(
        select(User).where(User.id == user_id)
    )
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Create fraud flag
    flag = FraudFlag(
        user_id=user_id,
        session_id=None,
        flag_type=flag_type,
        severity=severity,
        details=f"[Manual Flag by Admin {current_admin.email}]\n{details}",
        status="pending",
    )
    db.add(flag)

    db.add(
        _log_admin_action(
            current_admin.id,
            current_admin.email,
            "manual_fraud_flag",
            "user",
            user_id,
            {
                "flag_type": flag_type,
                "severity": severity,
                "details": details,
            },
            request.client.host,
        )
    )
    
    await db.commit()
    await db.refresh(flag)

    return {
        "success": True,
        "flag_id": flag.id,
        "message": f"User {user_id} flagged for {flag_type}",
    }
