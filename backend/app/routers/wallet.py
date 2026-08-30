import logging
import uuid
from datetime import datetime, timedelta
from math import ceil
import asyncio
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from pydantic import BaseModel, Field

from app.database import get_db
from app.models import ReadingSession, ContentCatalog, User, Payment, BillTransaction, PayoutTransaction, PointCredit, StudyTransaction, StudyMaterial, PayoutAccount as PayoutAccountRow, UserRewardClaim, DailyReward
from app.routers.auth import get_current_user
from app.routers.payouts import paystack_webhook as _payouts_paystack_webhook
from app.services.paystack import get_client
from app.config import settings
from app.services.money_caps import record_amount_v2

logger = logging.getLogger("uvicorn.error")

router = APIRouter(prefix="/wallet", tags=["wallet"])


class WalletDepositRequest(BaseModel):
    """Request to fund wallet via Paystack."""
    # Minimum is ₦100 (10,000 kobo). Below that the per-tx fee starts
    # to feel punitive as a percentage of the deposit. The cap-check
    # at /wallet/deposit still rejects anything above
    # settings.max_deposit_kobo_per_tx before talking to Paystack.
    deposit_amount_kobo: int = Field(ge=10000, description="Deposit amount in kobo (minimum ₦100)")
    custom_amount: bool = Field(default=False, description="Whether this is a custom deposit amount")


class WalletDepositResponse(BaseModel):
    """Paystack checkout URL response."""
    payment_url: str
    access_code: str
    reference: str
    amount_kobo: int
    deposit_amount_kobo: int


@router.post("/deposit/webhook")
async def paystack_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Universal Paystack webhook alias for wallet deposit events.

    Paystack's dashboard accepts ONE webhook URL per API key. Many
    operators point it at `/api/v1/wallet/deposit/webhook` because
    that's the surface that "funds the wallet", but configure the
    same key for premium subscription products elsewhere — the
    result is a stream of `charge.success` events (the only event
    Paystack sends for charges) hitting a URL that 405s.

    The real dispatcher lives in `app/routers/payouts.py:paystack_webhook`
    and already handles `charge.success` (wallet deposits +
    subscription tier upgrades) AND `transfer.*` (withdrawal
    settlement). We re-export it under the conventional wallet path
    so any of these paths reaches the same handler:

      - POST /api/v1/payouts/webhook
      - POST /api/v1/payments/webhook
      - POST /api/v1/wallet/deposit/webhook

    The Paystack signature is verified once, inside the dispatcher —
    no separate verification per route. See payouts.py:613.
    """
    return await _payouts_paystack_webhook(request=request, db=db)


@router.post("/deposit", response_model=WalletDepositResponse)
async def initiate_wallet_deposit(
    payload: WalletDepositRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Initiate Paystack payment to fund user wallet.
    
    DEBUG: Added extensive logging to trace payment initiation.
    """
    logger.info("=" * 80)
    logger.info("💳 WALLET DEPOSIT INITIATED")
    logger.info("User ID: %s", current_user.id)
    logger.info("Email: %s", current_user.email)
    logger.info("Deposit amount (kobo): %s", payload.deposit_amount_kobo)
    logger.info("Custom amount: %s", payload.custom_amount)
    
    if not settings.paystack_secret_key:
        logger.error("❌ PAYSTACK_SECRET_KEY not configured!")
        raise HTTPException(
            status_code=503,
            detail="Wallet funding temporarily unavailable. Please try again later.",
        )

    # Calculate fee (env-overridable via WALLET_DEPOSIT_FEE_PERCENT /
    # WALLET_DEPOSIT_MAX_FEE_KOBO). Scales linearly with deposit size
    # up to the cap, so ₦100 pays ₦1.50 and ₦10,000 still pays ₦20.
    # Compute the fee + total BEFORE the cap check so the cap compares
    # the full amount the user is actually moving through the system,
    # not just the deposit slice. Order matters: record_amount_v2
    # references `total_amount`, so it must be defined first.
    processing_fee = min(
        ceil(payload.deposit_amount_kobo * settings.wallet_deposit_fee_percent),
        settings.wallet_deposit_max_fee_kobo,
    )
    total_amount = payload.deposit_amount_kobo + processing_fee

    # M1 audit fix: enforce per-tx + 24h-rolling deposit caps BEFORE
    # talking to Paystack. A stolen-card deposit or a compromised
    # account shouldn't be able to push more than the cap through
    # the system in any 24h window.
    allowed, current_24h = record_amount_v2(
        user_id=current_user.id,
        kind="deposit",
        amount_kobo=total_amount,
        max_per_tx=settings.max_deposit_kobo_per_tx,
        max_per_day=settings.max_deposit_kobo_per_day,
    )
    if not allowed:
        if current_24h == 0:
            # Per-tx cap exceeded
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Deposit amount exceeds the per-transaction limit of "
                    f"{settings.max_deposit_kobo_per_tx} kobo."
                ),
            )
        # 24h cap exceeded — current_24h is what the user has already moved
        raise HTTPException(
            status_code=429,
            detail=(
                f"24-hour deposit limit reached. You've moved {current_24h} of "
                f"{settings.max_deposit_kobo_per_day} kobo allowed per day."
            ),
        )

    # Generate unique reference with project prefix "pp_"
    reference = f"pp_wallet_{current_user.id}_{uuid.uuid4().hex[:16]}"
    logger.info("📝 Generated reference: %s", reference)
    
    # Initialize Paystack transaction
    logger.info("🌐 Calling Paystack to initialize transaction...")
    paystack = get_client()
    try:
        result = await paystack.initialize_transaction(
            email=current_user.email,
            amount_kobo=total_amount,
            reference=reference,
            callback_url=f"{settings.frontend_url}/wallet",
            metadata={
                "user_id": current_user.id,
                "type": "wallet_deposit",
                "deposit_amount_kobo": payload.deposit_amount_kobo,
                "processing_fee_kobo": processing_fee,
                "total_amount_kobo": total_amount,
                "custom_amount": payload.custom_amount,
            }
        )
        logger.info("✅ Paystack initialization successful!")
        logger.info("   Authorization URL: %s", result.get("authorization_url"))
    except Exception as exc:
        logger.error("❌ Paystack initialization FAILED: %s", exc)
        raise HTTPException(status_code=502, detail="Payment provider unavailable")
    
    # Create Payment record to track deposit
    #
    # The Payment ORM column is `payment_metadata` (NOT `metadata`).
    # Using the wrong kwarg here silently drops the dict — SQLAlchemy
    # ignores unknown kwargs at construction, so no error is raised,
    # but the dispatcher at app/routers/payouts.py:701 reads
    # `payment.payment_metadata` to credit points_balance, and that
    # branch never fires if the dict is missing. That bug surfaced as
    # "the webhook returns handled:true but the wallet balance stays
    # at 0" — the dispatcher thought everything was fine.
    
    logger.info("💾 Creating Payment record in database...")
    payment = Payment(
        user_id=current_user.id,
        tier="wallet_deposit",
        amount_kobo=total_amount,
        provider="paystack",
        provider_tx_ref=reference,
        status="pending",
        payment_metadata={
            "deposit_amount_kobo": payload.deposit_amount_kobo,
            "processing_fee_kobo": processing_fee,
            "total_amount_kobo": total_amount,
            "custom_amount": payload.custom_amount,
        },
    )
    db.add(payment)
    await db.commit()
    logger.info("✅ Payment record created: ID=%s", payment.id)
    
    # Send push notification: Payment initiated
    # Note: We spawn this as a background task and create a new DB session
    # inside it to avoid session conflicts with the request-scoped session
    logger.info("📲 Scheduling payment initiated notification...")
    from app.services.fcm import send_push_notification_background
    asyncio.create_task(
        send_push_notification_background(
            user_id=current_user.id,
            title="💳 Payment Initiated",
            body=f"Processing your ₦{payload.deposit_amount_kobo / 100:.2f} wallet deposit...",
            data={
                "type": "payment_initiated",
                "reference": reference,
                "amount_kobo": str(payload.deposit_amount_kobo),
                "total_kobo": str(total_amount),
            },
            category="wallet_updates",
        )
    )
    
    logger.info("🎉 Wallet deposit initiated successfully!")
    logger.info("   Reference: %s", reference)
    logger.info("   Amount: %s kobo", payload.deposit_amount_kobo)
    logger.info("   Fee: %s kobo", processing_fee)
    logger.info("   Total: %s kobo", total_amount)
    logger.info("=" * 80)
    
    return WalletDepositResponse(
        payment_url=result["authorization_url"],
        access_code=result.get("access_code", ""),
        reference=reference,
        amount_kobo=total_amount,
        deposit_amount_kobo=payload.deposit_amount_kobo,
    )
