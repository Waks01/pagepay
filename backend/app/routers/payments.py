"""Premium Subscription Payments

Paystack-powered subscription payments for premium tiers.
Users upgrade from FREE → PREMIUM_MONTHLY or PREMIUM_YEARLY.
"""

import asyncio
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User, UserTier, Payment
from app.routers.auth import get_current_user
from app.routers.payouts import paystack_webhook as _payouts_paystack_webhook
from app.schemas import (
    PaymentInitiateRequest,
    PaymentInitiateResponse,
    UserTierInfo,
    TierInfo,
)
from app.services.subscription import (
    get_tier_price_kobo,
    calculate_subscription_end_date,
    format_tier_name,
    get_subscription_status,
)
from app.config import settings

logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/payments", tags=["payments"])


# Tier pricing configuration
TIER_BENEFITS = {
    UserTier.PREMIUM_MONTHLY: [
        "Ad-free study materials",
        "2x reading points (10 pts per 10 min)",
        "Priority AI generation",
        "Gold Premium badge",
        "Monthly billing",
    ],
    UserTier.PREMIUM_YEARLY: [
        "Ad-free study materials",
        "2x reading points (10 pts per 10 min)",
        "Priority AI generation",
        "Gold Premium badge",
        "Save ₦1,000 per year",
    ],
}


@router.get("/tiers", response_model=list[TierInfo])
async def get_tier_pricing():
    """Get available subscription tiers and pricing."""
    tiers = []
    
    for tier in [UserTier.PREMIUM_MONTHLY, UserTier.PREMIUM_YEARLY]:
        duration_days = 30 if tier == UserTier.PREMIUM_MONTHLY else 365
        tiers.append(TierInfo(
            tier=tier.value,
            display_name=format_tier_name(tier),
            price_kobo=get_tier_price_kobo(tier),
            duration_days=duration_days,
            benefits=TIER_BENEFITS[tier],
        ))
    
    return tiers


@router.get("/subscription", response_model=dict)
async def get_subscription_status_endpoint(
    current_user: User = Depends(get_current_user),
):
    """Get user's current subscription status."""
    return get_subscription_status(current_user)


@router.post("/initiate", response_model=PaymentInitiateResponse)
async def initiate_payment(
    payload: PaymentInitiateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Initiate a premium subscription payment via Paystack.
    
    Returns a checkout URL for the user to complete payment.
    
    DEBUG: Added extensive logging to trace subscription payment flow.
    """
    logger.info("=" * 80)
    logger.info("🎫 PREMIUM SUBSCRIPTION INITIATED")
    logger.info("User ID: %s", current_user.id)
    logger.info("Email: %s", current_user.email)
    logger.info("Tier: %s", payload.tier)
    logger.info("Provider: %s", payload.provider)
    
    if not settings.paystack_secret_key:
        logger.error("❌ PAYSTACK_SECRET_KEY not configured!")
        raise HTTPException(status_code=503, detail="Payments not configured")
    
    # Parse tier enum
    try:
        tier = UserTier(payload.tier)
        logger.info("✅ Tier parsed: %s", tier.value)
    except ValueError:
        logger.error("❌ Invalid tier: %s", payload.tier)
        raise HTTPException(status_code=400, detail=f"Invalid tier: {payload.tier}")
    
    # Get tier price
    amount_kobo = get_tier_price_kobo(tier)
    logger.info("💰 Subscription price: %s kobo (₦%s)", amount_kobo, amount_kobo / 100)
    
    # Generate unique reference with project prefix "pp_"
    import uuid
    tx_ref = f"pp_sub_{current_user.id}_{uuid.uuid4().hex[:12]}"
    logger.info("📝 Generated reference: %s", tx_ref)
    
    # Create pending payment record
    logger.info("💾 Creating Payment record for subscription...")
    payment = Payment(
        user_id=current_user.id,
        tier=tier.value,
        amount_kobo=amount_kobo,
        provider=payload.provider,
        provider_tx_ref=tx_ref,
        status="pending",
    )
    db.add(payment)
    await db.commit()
    logger.info("✅ Payment record created: ID=%s", payment.id)
    
    # Send push notification: Subscription payment initiated
    logger.info("📲 Scheduling subscription payment initiated notification...")
    from app.services.fcm import send_push_notification_background
    asyncio.create_task(
        send_push_notification_background(
            user_id=current_user.id,
            title="💳 Subscription Payment Initiated",
            body=f"Processing your {format_tier_name(tier)} subscription (₦{amount_kobo / 100:.2f})...",
            data={
                "type": "subscription_initiated",
                "reference": tx_ref,
                "tier": tier.value,
                "amount_kobo": str(amount_kobo),
            },
            category="subscriptions",
        )
    )
    
    # Initialize Paystack checkout
    if payload.provider == "paystack":
        import httpx
        
        logger.info("🌐 Calling Paystack to initialize subscription checkout...")
        url = "https://api.paystack.co/transaction/initialize"
        headers = {
            "Authorization": f"Bearer {settings.paystack_secret_key}",
            "Content-Type": "application/json",
        }
        body = {
            "email": current_user.email,
            "amount": amount_kobo,  # Paystack expects kobo
            "reference": tx_ref,
            "currency": "NGN",
            "callback_url": f"{settings.frontend_url}/subscription/success",
            "metadata": {
                "user_id": current_user.id,
                "tier": tier.value,
                "custom_fields": [
                    {
                        "display_name": "Tier",
                        "variable_name": "tier",
                        "value": format_tier_name(tier),
                    }
                ]
            }
        }
        
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.post(url, json=body, headers=headers)
                
                if response.status_code != 200:
                    logger.error("❌ Paystack init failed: %s", response.text)
                    raise HTTPException(
                        status_code=502,
                        detail="Payment provider unavailable"
                    )
                
                data = response.json()
                
                if not data.get("status"):
                    logger.error("❌ Paystack returned error: %s", data.get("message"))
                    raise HTTPException(
                        status_code=502,
                        detail=data.get("message", "Payment initialization failed")
                    )
                
                authorization_url = data["data"]["authorization_url"]
                access_code = data["data"].get("access_code", "")
                logger.info("✅ Paystack initialization successful!")
                logger.info("   Authorization URL: %s", authorization_url)
                logger.info("   Access code: %s", access_code)
                logger.info("🎉 Subscription payment initiated successfully!")
                logger.info("=" * 80)
                
                return PaymentInitiateResponse(
                    payment_url=authorization_url,
                    access_code=access_code,
                    provider_tx_ref=tx_ref,
                    provider=payload.provider,
                    amount_kobo=amount_kobo,
                    tier=tier.value,
                )
                
        except httpx.RequestError as e:
            logger.error("❌ Paystack request error: %s", e)
            raise HTTPException(
                status_code=502,
                detail="Could not reach payment provider"
            )
    
    else:
        raise HTTPException(status_code=400, detail=f"Provider {payload.provider} not supported")


@router.post("/webhook")
async def paystack_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Universal Paystack webhook alias for premium subscription events.

    Paystack's dashboard accepts ONE webhook URL per API key. Many
    operators point it at `/api/v1/payments/webhook` (the canonical
    "subscriptions" endpoint) but configure it for a different product
    elsewhere — the result is a stream of `charge.success` and
    `transfer.success` events hitting a URL that 405s. The real
    dispatcher lives in `app/routers/payouts.py:paystack_webhook`,
    which already handles BOTH `transfer.*` (withdrawal settlement)
    AND `charge.success` (wallet deposits + premium upgrades). We
    re-export it here so any of these paths reach the same handler:

      - POST /api/v1/payouts/webhook
      - POST /api/v1/payments/webhook
      - POST /api/v1/wallet/deposit/webhook

    The Paystack signature is verified once, inside the dispatcher —
    no separate verification per route.
    """
    return await _payouts_paystack_webhook(request=request, db=db)


@router.get("/history", response_model=list[dict])
async def get_payment_history(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get user's payment history."""
    result = await db.execute(
        select(Payment)
        .where(Payment.user_id == current_user.id)
        .order_by(Payment.created_at.desc())
    )
    payments = result.scalars().all()
    
    return [
        {
            "id": p.id,
            "tier": p.tier,
            "tier_name": _format_payment_tier_name(p.tier),
            "amount_kobo": p.amount_kobo,
            "amount_naira": p.amount_kobo / 100,
            "provider": p.provider,
            "status": p.status,
            "created_at": p.created_at.isoformat(),
            "confirmed_at": p.confirmed_at.isoformat() if p.confirmed_at else None,
        }
        for p in payments
    ]


def _format_payment_tier_name(tier: str) -> str:
    if tier == "wallet_deposit":
        return "Wallet Deposit"
    try:
        return format_tier_name(UserTier(tier))
    except ValueError:
        return tier.replace("_", " ").title()


@router.get("/status/{reference}")
async def get_payment_status(
    reference: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the status of a payment by reference.
    
    This endpoint allows the frontend to check payment status if needed,
    though the webhook-driven approach should handle most cases automatically.
    """
    payment = (
        await db.execute(
            select(Payment).where(
                Payment.provider_tx_ref == reference,
                Payment.user_id == current_user.id  # Ensure user owns this payment
            )
        )
    ).scalar_one_or_none()
    
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    
    return {
        "reference": payment.provider_tx_ref,
        "status": payment.status,
        "tier": payment.tier,
        "tier_name": _format_payment_tier_name(payment.tier),
        "amount_kobo": payment.amount_kobo,
        "amount_naira": payment.amount_kobo / 100,
        "created_at": payment.created_at.isoformat(),
        "confirmed_at": payment.confirmed_at.isoformat() if payment.confirmed_at else None,
        "webhook_confirmed": payment.webhook_confirmed,
    }


@router.post("/status/{reference}/cancel")
async def cancel_payment_status(
    reference: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Manually update payment status to cancelled when user cancels in frontend.
    
    This handles cases where Paystack doesn't send a webhook for cancelled payments.
    """
    logger.info("🔄 [CANCEL] Received cancel request for reference: %s", reference)
    logger.info("🔄 [CANCEL] User ID: %s", current_user.id)
    
    payment = (
        await db.execute(
            select(Payment).where(
                Payment.provider_tx_ref == reference,
                Payment.user_id == current_user.id  # Ensure user owns this payment
            )
        )
    ).scalar_one_or_none()
    
    if not payment:
        logger.warning("❌ [CANCEL] Payment not found for reference: %s, user: %s", reference, current_user.id)
        raise HTTPException(status_code=404, detail="Payment not found")
    
    logger.info("✅ [CANCEL] Payment found: id=%s, status=%s", payment.id, payment.status)
    
    # Only update if still pending (don't override webhook updates)
    if payment.status == "pending":
        logger.info("🔄 [CANCEL] Updating payment status to cancelled for reference: %s", reference)
        payment.status = "cancelled"
        payment.confirmed_at = datetime.utcnow()
        await db.commit()
        logger.info("✅ [CANCEL] Payment status updated successfully")
        
        return {
            "success": True,
            "message": "Payment status updated to cancelled",
            "reference": reference,
            "status": "cancelled"
        }
    else:
        logger.info("⚠️ [CANCEL] Payment already has final status: %s, not updating", payment.status)
        return {
            "success": False,
            "message": f"Payment already has status: {payment.status}",
            "reference": reference,
            "status": payment.status
        }


@router.post("/status/{reference}/fail")
async def fail_payment_status(
    reference: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Manually update payment status to failed when payment fails in frontend.
    
    This handles cases where Paystack doesn't send a webhook for failed payments.
    """
    logger.info("🔄 [FAIL] Received fail request for reference: %s", reference)
    logger.info("🔄 [FAIL] User ID: %s", current_user.id)
    
    payment = (
        await db.execute(
            select(Payment).where(
                Payment.provider_tx_ref == reference,
                Payment.user_id == current_user.id  # Ensure user owns this payment
            )
        )
    ).scalar_one_or_none()
    
    if not payment:
        logger.warning("❌ [FAIL] Payment not found for reference: %s, user: %s", reference, current_user.id)
        raise HTTPException(status_code=404, detail="Payment not found")
    
    logger.info("✅ [FAIL] Payment found: id=%s, status=%s", payment.id, payment.status)
    
    # Only update if still pending (don't override webhook updates)
    if payment.status == "pending":
        logger.info("🔄 [FAIL] Updating payment status to failed for reference: %s", reference)
        payment.status = "failed"
        payment.confirmed_at = datetime.utcnow()
        await db.commit()
        logger.info("✅ [FAIL] Payment status updated successfully")
        
        return {
            "success": True,
            "message": "Payment status updated to failed",
            "reference": reference,
            "status": "failed"
        }
    else:
        logger.info("⚠️ [FAIL] Payment already has final status: %s, not updating", payment.status)
        return {
            "success": False,
            "message": f"Payment already has status: {payment.status}",
            "reference": reference,
            "status": payment.status
        }


@router.post("/refund")
async def initiate_refund(
    reference: str,
    reason: str = "Customer request",
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Initiate a refund for a payment.
    
    This calls Paystack's refund API and lets the webhook handle the actual
    refund processing when Paystack confirms it.
    """
    if not settings.paystack_secret_key:
        logger.error("❌ PAYSTACK_SECRET_KEY not configured!")
        raise HTTPException(status_code=503, detail="Payments not configured")
    
    # Find the payment record
    payment = (
        await db.execute(
            select(Payment).where(
                Payment.provider_tx_ref == reference,
                Payment.user_id == current_user.id  # Ensure user owns this payment
            )
        )
    ).scalar_one_or_none()
    
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    
    if payment.status != "success":
        raise HTTPException(
            status_code=400, 
            detail=f"Cannot refund payment with status: {payment.status}"
        )
    
    logger.info("🔄 Initiating refund for payment: %s", payment.id)
    logger.info("   Reference: %s", reference)
    logger.info("   Amount: %s kobo", payment.amount_kobo)
    logger.info("   Reason: %s", reason)
    
    try:
        import httpx
        
        # Call Paystack refund API
        url = "https://api.paystack.co/refund"
        headers = {
            "Authorization": f"Bearer {settings.paystack_secret_key}",
            "Content-Type": "application/json",
        }
        body = {
            "transaction": reference,
            "amount": payment.amount_kobo,  # Full refund
            "currency": "NGN",
            "customer_note": reason,
            "merchant_note": f"Refund initiated by user {current_user.id}",
        }
        
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(url, json=body, headers=headers)
            
            if response.status_code != 200:
                logger.error("❌ Paystack refund failed: %s", response.text)
                raise HTTPException(
                    status_code=502,
                    detail="Refund request failed with payment provider"
                )
            
            data = response.json()
            
            if not data.get("status"):
                logger.error("❌ Paystack returned error: %s", data.get("message"))
                raise HTTPException(
                    status_code=502,
                    detail=data.get("message", "Refund initiation failed")
                )
            
            refund_data = data["data"]
            logger.info("✅ Paystack refund initiated successfully!")
            logger.info("   Refund ID: %s", refund_data.get("id"))
            logger.info("   Status: %s", refund_data.get("status"))
            
            # Mark payment as refund requested (webhook will complete the process)
            payment.status = "refund_requested"
            await db.commit()
            
            return {
                "success": True,
                "message": "Refund initiated successfully",
                "refund_id": refund_data.get("id"),
                "status": refund_data.get("status"),
                "amount_kobo": payment.amount_kobo,
                "reference": reference
            }
            
    except httpx.RequestError as e:
        logger.error("❌ Paystack request error: %s", e)
        raise HTTPException(
            status_code=502,
            detail="Could not reach payment provider"
        )
    except Exception as e:
        logger.error("❌ Unexpected refund error: %s", e)
        raise HTTPException(
            status_code=500,
            detail="Internal server error during refund"
        )
