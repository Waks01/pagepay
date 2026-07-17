"""Payment and subscription management endpoints.

Manage premium subscription payments. List subscriptions, view details,
refund payments, and track failed transactions. Integrates with Paystack
for refund processing.
"""

import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Payment, User, AdminUser
from app.services.admin_auth import require_permission

logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/payments", tags=["admin-payments"])


# ── Subscription Listing ────────────────────────────────────────────


@router.get("/subscriptions")
async def list_subscriptions(
    status_filter: str | None = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    current_admin: AdminUser = Depends(require_permission("finance.view")),
    db: AsyncSession = Depends(get_db),
):
    """List all premium subscription payments."""
    query = select(Payment)
    if status_filter:
        query = query.where(Payment.status == status_filter)

    total = (
        await db.execute(select(func.count()).select_from(query.subquery()))
    ).scalar_one()
    rows = await db.execute(
        query.order_by(Payment.created_at.desc())
        .limit(limit)
        .offset((page - 1) * limit)
    )

    items = []
    for payment in rows.scalars().all():
        # Get user email
        user_result = await db.execute(
            select(User).where(User.id == payment.user_id)
        )
        user = user_result.scalar_one_or_none()

        items.append({
            "id": payment.id,
            "user_id": payment.user_id,
            "user_email": user.email if user else f"User {payment.user_id}",
            "tier": payment.tier,
            "amount_kobo": payment.amount_kobo,
            "amount_ngn": payment.amount_kobo / 100,
            "provider": payment.provider,
            "provider_tx_ref": payment.provider_tx_ref,
            "status": payment.status,
            "webhook_confirmed": payment.webhook_confirmed,
            "created_at": payment.created_at.isoformat(),
            "confirmed_at": (
                payment.confirmed_at.isoformat()
                if payment.confirmed_at else None
            ),
        })

    return {"items": items, "total": int(total), "page": page, "limit": limit}


@router.get("/subscriptions/{payment_id}")
async def get_subscription_detail(
    payment_id: int,
    current_admin: AdminUser = Depends(require_permission("finance.view")),
    db: AsyncSession = Depends(get_db),
):
    """Get details of a specific payment."""
    result = await db.execute(
        select(Payment).where(Payment.id == payment_id)
    )
    payment = result.scalar_one_or_none()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    # Get user details
    user_result = await db.execute(
        select(User).where(User.id == payment.user_id)
    )
    user = user_result.scalar_one_or_none()

    return {
        "id": payment.id,
        "user_id": payment.user_id,
        "user_email": user.email if user else f"User {payment.user_id}",
        "user_tier_current": (
            user.tier.value if user and hasattr(user.tier, "value") else None
        ),
        "subscription_expires_at": (
            user.subscription_expires_at.isoformat()
            if user and user.subscription_expires_at else None
        ),
        "tier": payment.tier,
        "amount_kobo": payment.amount_kobo,
        "amount_ngn": payment.amount_kobo / 100,
        "provider": payment.provider,
        "provider_tx_ref": payment.provider_tx_ref,
        "status": payment.status,
        "webhook_confirmed": payment.webhook_confirmed,
        "created_at": payment.created_at.isoformat(),
        "confirmed_at": (
            payment.confirmed_at.isoformat()
            if payment.confirmed_at else None
        ),
    }


@router.post("/subscriptions/{payment_id}/refund")
async def refund_payment(
    payment_id: int,
    reason: str = Query(...),
    current_admin: AdminUser = Depends(require_permission("finance.approve")),
    db: AsyncSession = Depends(get_db),
):
    """Refund a premium subscription payment via Paystack."""
    from app.services.paystack import PaystackError, get_client as get_paystack_client

    result = await db.execute(
        select(Payment).where(Payment.id == payment_id)
    )
    payment = result.scalar_one_or_none()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    if payment.status == "failed":
        raise HTTPException(status_code=400, detail="Cannot refund failed payment")

    if payment.status == "pending":
        raise HTTPException(
            status_code=400,
            detail="Cannot refund pending payment. Wait for confirmation.",
        )

    if payment.status == "refunded":
        raise HTTPException(status_code=400, detail="Payment already refunded")

    # Call Paystack refund API
    try:
        paystack = get_paystack_client()
        refund_receipt = await paystack.refund_charge(
            reference=payment.provider_tx_ref,
            amount_kobo=payment.amount_kobo,
        )

        # Get user to revert subscription
        user_result = await db.execute(
            select(User).where(User.id == payment.user_id)
        )
        user = user_result.scalar_one_or_none()

        # Revert user subscription if it matches the tier we're refunding
        if user and user.tier.value == payment.tier:
            user.tier = "free"
            user.subscription_expires_at = None

        # Mark payment as refunded so the duplicate-refund check
        # above catches re-runs. (We keep the original row as the
        # source of truth rather than inserting a new negative row.)
        payment.status = "refunded"

        await db.commit()

        return {
            "success": True,
            "message": "Payment refunded successfully",
            "refund_reference": (
                refund_receipt.reference
                if refund_receipt.reference else None
            ),
            "amount_refunded_kobo": payment.amount_kobo,
        }
    except PaystackError as e:
        logger.error("Paystack refund failed: %s", str(e))
        raise HTTPException(status_code=400, detail=f"Refund failed: {str(e)}")
    except Exception as e:
        logger.error("Unexpected error during refund: %s", str(e))
        raise HTTPException(status_code=500, detail="Refund processing error")


# ── Failed Payments ────────────────────────────────────────────────


@router.get("/failed")
async def list_failed_payments(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    current_admin: AdminUser = Depends(require_permission("finance.view")),
    db: AsyncSession = Depends(get_db),
):
    """List failed payment transactions."""
    query = select(Payment).where(Payment.status == "failed")
    
    total = (
        await db.execute(select(func.count()).select_from(query.subquery()))
    ).scalar_one()
    rows = await db.execute(
        query.order_by(Payment.created_at.desc())
        .limit(limit)
        .offset((page - 1) * limit)
    )

    items = []
    for payment in rows.scalars().all():
        # Get user email
        user_result = await db.execute(
            select(User).where(User.id == payment.user_id)
        )
        user = user_result.scalar_one_or_none()

        items.append({
            "id": payment.id,
            "user_id": payment.user_id,
            "user_email": user.email if user else f"User {payment.user_id}",
            "tier": payment.tier,
            "amount_kobo": payment.amount_kobo,
            "amount_ngn": payment.amount_kobo / 100,
            "provider": payment.provider,
            "provider_tx_ref": payment.provider_tx_ref,
            "created_at": payment.created_at.isoformat(),
        })

    return {"items": items, "total": int(total), "page": page, "limit": limit}


# ── Active Subscriptions ────────────────────────────────────────────


@router.get("/subscriptions/active")
async def list_active_subscriptions(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    current_admin: AdminUser = Depends(require_permission("finance.view")),
    db: AsyncSession = Depends(get_db),
):
    """List users with active premium subscriptions."""
    now = datetime.now(timezone.utc)
    query = select(User).where(
        (User.subscription_expires_at > now) &
        (User.tier != "free")
    )

    total = (
        await db.execute(select(func.count()).select_from(query.subquery()))
    ).scalar_one()
    rows = await db.execute(
        query.order_by(User.subscription_expires_at.desc())
        .limit(limit)
        .offset((page - 1) * limit)
    )

    items = []
    for user in rows.scalars().all():
        items.append({
            "id": user.id,
            "email": user.email,
            "tier": (
                user.tier.value
                if hasattr(user.tier, "value") else str(user.tier)
            ),
            "subscription_expires_at": (
                user.subscription_expires_at.isoformat()
                if user.subscription_expires_at else None
            ),
            "days_remaining": (
                (user.subscription_expires_at - now).days
                if user.subscription_expires_at else None
            ),
        })

    return {"items": items, "total": int(total), "page": page, "limit": limit}


@router.post("/subscriptions/{user_id}/cancel")
async def cancel_subscription(
    user_id: int,
    reason: str = Query(...),
    current_admin: AdminUser = Depends(require_permission("finance.approve")),
    db: AsyncSession = Depends(get_db),
):
    """Cancel a user's premium subscription and revert to free tier."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.tier.value == "free":
        raise HTTPException(status_code=400, detail="User is not on a premium plan")

    previous_tier = user.tier.value
    user.tier = "free"
    user.subscription_expires_at = None
    await db.commit()

    return {
        "success": True,
        "message": f"Subscription cancelled. Previous plan: {previous_tier}.",
    }
