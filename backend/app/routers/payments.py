"""Premium Subscription Payments

Paystack-powered subscription payments for premium tiers.
Users upgrade from FREE → PREMIUM_MONTHLY or PREMIUM_YEARLY.
"""

import logging

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
    import asyncio
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
                logger.info("✅ Paystack initialization successful!")
                logger.info("   Authorization URL: %s", authorization_url)
                logger.info("🎉 Subscription payment initiated successfully!")
                logger.info("=" * 80)
                
                return PaymentInitiateResponse(
                    payment_url=authorization_url,
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
