"""Premium Subscription Payments

Paystack-powered subscription payments for premium tiers.
Users upgrade from FREE → PREMIUM_MONTHLY or PREMIUM_YEARLY.
"""

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Header, Request
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User, UserTier, Payment
from app.routers.auth import get_current_user
from app.schemas import (
    PaymentInitiateRequest,
    PaymentInitiateResponse,
    PaymentWebhookResponse,
    UserTierInfo,
    TierInfo,
)
from app.services.paystack import get_client
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
    """
    if not settings.paystack_secret_key:
        raise HTTPException(status_code=503, detail="Payments not configured")
    
    # Parse tier enum
    try:
        tier = UserTier(payload.tier)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid tier: {payload.tier}")
    
    # Get tier price
    amount_kobo = get_tier_price_kobo(tier)
    
    # Generate unique reference
    import uuid
    tx_ref = f"PP-{current_user.id}-{uuid.uuid4().hex[:12]}"
    
    # Create pending payment record
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
    
    # Initialize Paystack checkout
    if payload.provider == "paystack":
        import httpx
        
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
                    logger.error(f"Paystack init failed: {response.text}")
                    raise HTTPException(
                        status_code=502,
                        detail="Payment provider unavailable"
                    )
                
                data = response.json()
                
                if not data.get("status"):
                    raise HTTPException(
                        status_code=502,
                        detail=data.get("message", "Payment initialization failed")
                    )
                
                authorization_url = data["data"]["authorization_url"]
                
                return PaymentInitiateResponse(
                    payment_url=authorization_url,
                    provider_tx_ref=tx_ref,
                    provider=payload.provider,
                    amount_kobo=amount_kobo,
                    tier=tier.value,
                )
                
        except httpx.RequestError as e:
            logger.error(f"Paystack request error: {e}")
            raise HTTPException(
                status_code=502,
                detail="Could not reach payment provider"
            )
    
    else:
        raise HTTPException(status_code=400, detail=f"Provider {payload.provider} not supported")


@router.post("/paystack/webhook", response_model=PaymentWebhookResponse)
async def paystack_webhook(
    request: Request,
    x_paystack_signature: str = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """Handle Paystack webhook events.
    
    Verifies webhook signature using Paystack secret key (HMAC-SHA512).
    Processes successful payments and upgrades user tier.
    """
    if not settings.paystack_secret_key:
        logger.error("Paystack secret key not configured")
        return PaymentWebhookResponse(status="error", message="Webhook not configured")
    
    # Get raw body for signature verification
    body = await request.body()
    
    # Verify signature - Paystack uses the SECRET KEY for HMAC-SHA512
    if not get_client().verify_webhook_signature(
        raw_body=body,
        signature_header=x_paystack_signature,
        secret=settings.paystack_secret_key,
    ):
        logger.warning("Invalid Paystack webhook signature")
        raise HTTPException(status_code=401, detail="Invalid webhook signature")
    
    # Parse webhook data
    try:
        data = await request.json()
    except Exception:
        logger.error("Could not parse webhook JSON")
        return PaymentWebhookResponse(status="error", message="Invalid JSON")
    
    event = data.get("event")
    event_data = data.get("data", {})
    
    # Only process successful charges
    if event != "charge.success":
        return PaymentWebhookResponse(status="ignored", message=f"Event {event} not handled")
    
    tx_ref = event_data.get("reference")
    if not tx_ref:
        logger.error("Webhook missing reference")
        return PaymentWebhookResponse(status="error", message="Missing reference")
    
    # Find payment record
    result = await db.execute(
        select(Payment).where(Payment.provider_tx_ref == tx_ref)
    )
    payment = result.scalar_one_or_none()
    
    if not payment:
        logger.warning(f"Payment not found for reference: {tx_ref}")
        return PaymentWebhookResponse(status="error", message="Payment not found")
    
    # Idempotency: already processed
    if payment.webhook_confirmed:
        return PaymentWebhookResponse(status="success", message="Already processed")
    
    # Update payment status
    payment.status = "success"
    payment.webhook_confirmed = True
    payment.confirmed_at = datetime.utcnow()
    
    # Upgrade user tier
    try:
        tier = UserTier(payment.tier)
        expires_at = calculate_subscription_end_date(tier)
        
        await db.execute(
            update(User)
            .where(User.id == payment.user_id)
            .values(
                tier=tier,
                subscription_expires_at=expires_at,
            )
        )
        
        await db.commit()
        
        logger.info(
            f"User {payment.user_id} upgraded to {tier.value} "
            f"(expires {expires_at.isoformat()})"
        )
        
        return PaymentWebhookResponse(
            status="success",
            message=f"User upgraded to {tier.value}"
        )
        
    except Exception as e:
        logger.error(f"Failed to upgrade user {payment.user_id}: {e}")
        await db.rollback()
        return PaymentWebhookResponse(status="error", message=str(e))


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
            "tier_name": format_tier_name(UserTier(p.tier)),
            "amount_kobo": p.amount_kobo,
            "amount_naira": p.amount_kobo / 100,
            "provider": p.provider,
            "status": p.status,
            "created_at": p.created_at.isoformat(),
            "confirmed_at": p.confirmed_at.isoformat() if p.confirmed_at else None,
        }
        for p in payments
    ]
