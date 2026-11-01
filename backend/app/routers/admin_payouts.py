"""Payout management endpoints.

Handles approval/rejection of user payout requests and integrates with
Paystack for actual fund transfers. Tracks all payout status changes
and payment processing.
"""

import logging
import json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import PayoutTransaction, User, AdminUser, AdminAuditLog
from app.services.admin_auth import require_permission

logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/payouts", tags=["admin-payouts"])


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


# ── Payout Management ───────────────────────────────────────────────


@router.get("")
async def list_payouts(
    status_filter: str | None = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    current_admin: AdminUser = Depends(require_permission("finance.view")),
    db: AsyncSession = Depends(get_db),
):
    """List pending/completed payouts with optional status filter."""
    q = select(PayoutTransaction)
    if status_filter:
        q = q.where(PayoutTransaction.status == status_filter)
    
    total = (
        await db.execute(select(func.count()).select_from(q.subquery()))
    ).scalar_one()
    rows = await db.execute(
        q.order_by(PayoutTransaction.created_at.desc())
        .limit(limit)
        .offset((page - 1) * limit)
    )
    
    items = [
        {
            "id": p.id,
            "user_id": p.user_id,
            "amount_kobo": p.amount_kobo,
            "fee_kobo": p.fee_kobo,
            "status": p.status,
            "recipient_code": p.recipient_code,
            "created_at": p.created_at.isoformat(),
        }
        for p in rows.scalars().all()
    ]
    
    return {"items": items, "total": int(total), "page": page, "limit": limit}


@router.post("/{payout_id}/approve")
async def approve_payout(
    request: Request,
    payout_id: int,
    current_admin: AdminUser = Depends(require_permission("finance.approve")),
    db: AsyncSession = Depends(get_db),
):
    """Approve a payout and initiate Paystack transfer."""
    from app.services.paystack import get_client, PaystackError

    result = await db.execute(
        select(PayoutTransaction).where(PayoutTransaction.id == payout_id)
    )
    payout = result.scalar_one_or_none()
    if not payout:
        raise HTTPException(status_code=404, detail="Payout not found")

    if payout.status != "pending":
        raise HTTPException(
            status_code=400, detail=f"Payout is already {payout.status}"
        )

    # Initiate actual Paystack transfer
    try:
        paystack = get_client()
        receipt = await paystack.initiate_transfer(
            recipient_code=payout.recipient_code,
            amount_kobo=payout.amount_kobo,
            reason=payout.reason or "PagePay withdrawal - Admin approved",
            reference=payout.reference,
        )

        # Update payout with Paystack transfer details
        payout.paystack_transfer_code = receipt.transfer_code
        payout.status = receipt.status

        db.add(
            _log_admin_action(
                current_admin.id,
                current_admin.email,
                "approve_payout",
                "payout",
                payout_id,
                {
                    "transfer_code": receipt.transfer_code,
                    "reference": receipt.reference,
                    "amount_kobo": payout.amount_kobo,
                },
                request.client.host,
            )
        )
        await db.commit()

        return {
            "success": True,
            "transfer_code": receipt.transfer_code,
            "status": receipt.status,
            "message": "Paystack transfer initiated. Status updates via webhook.",
        }

    except PaystackError as e:
        # Log the failure
        error_msg = str(e)
        db.add(
            _log_admin_action(
                current_admin.id,
                current_admin.email,
                "approve_payout_failed",
                "payout",
                payout_id,
                {"error": error_msg},
                request.client.host,
                result="error",
                error=error_msg,
            )
        )
        await db.commit()
        raise HTTPException(
            status_code=502,
            detail=f"Paystack transfer failed: {error_msg}",
        )


@router.post("/{payout_id}/reject")
async def reject_payout(
    request: Request,
    payout_id: int,
    reason: str = Query(...),
    current_admin: AdminUser = Depends(require_permission("finance.approve")),
    db: AsyncSession = Depends(get_db),
):
    """Reject a payout and refund user's points."""
    result = await db.execute(
        select(PayoutTransaction).where(PayoutTransaction.id == payout_id)
    )
    payout = result.scalar_one_or_none()
    if not payout:
        raise HTTPException(status_code=404, detail="Payout not found")

    if payout.status != "pending":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot reject payout that is already {payout.status}",
        )

    # Fetch the user to refund points
    user_result = await db.execute(
        select(User).where(User.id == payout.user_id)
    )
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Refund the full amount (amount + fee) back to user's balance
    refund_amount = payout.amount_kobo + payout.fee_kobo
    old_balance = user.points_balance
    user.points_balance += refund_amount

    # Update payout status
    payout.status = "failed"
    payout.reason = reason
    payout.settled_at = datetime.utcnow()

    db.add(
        _log_admin_action(
            current_admin.id,
            current_admin.email,
            "reject_payout",
            "payout",
            payout_id,
            {
                "reason": reason,
                "refund_amount": refund_amount,
                "user_balance": {"from": old_balance, "to": user.points_balance},
            },
                request.client.host,
            )
    )

    await db.commit()

    return {
        "success": True,
        "refunded_amount": refund_amount,
        "user_new_balance": user.points_balance,
    }

