import logging
import uuid
from datetime import datetime
from math import ceil
import asyncio
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from pydantic import BaseModel, Field

from app.database import get_db
from app.models import ReadingSession, ContentCatalog, AdEvent, User, Payment
from app.routers.auth import get_current_user
from app.routers.payouts import paystack_webhook as _payouts_paystack_webhook
from app.services.paystack import get_client
from app.config import settings
from app.services.money_caps import record_amount_v2

logger = logging.getLogger("uvicorn.error")

router = APIRouter(prefix="/wallet", tags=["wallet"])


def _slice_label(read_order: int | None, total_slices: int | None) -> str:
    """Format slice position for transaction descriptions.

    Standalone slices (read_order/total_slices are None) and single-slice
    works (total_slices==1) render with the bare title. Multi-slice works
    append the part position so the wallet clearly shows per-slice earnings
    instead of sounding like a whole-book reward.
    """
    if read_order and total_slices and total_slices > 1:
        return f" (Part {read_order} of {total_slices})"
    return ""


class Transaction(BaseModel):
    id: int
    type: str  # "earn" | "pending" | "ad_reward"
    points: int
    description: str
    date: datetime


@router.get("/transactions", response_model=list[Transaction])
async def list_transactions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    limit: int = 50,
):
    """Unified point-earning history combining reading sessions and ad rewards.

    Two independent streams feed the wallet, and we surface both:

    1. **Reading sessions** — every session with `end_time` set and
       `points_earned > 0`. Slice-completion bonuses are settled at
       /session/end (no claim required), so any verified session that
       earned the bonus is listed as an "earn" entry. Unverified or
       in-progress sessions are excluded — they have no balance impact.

    2. **Ad events** — every AdEvent row with `credit_status='credited'`
       AND `user_points_credited > 0`. Pre-read, post-read, and unbonded
       (unrelated to a session) ads are all listed. SSV webhooks are
       independent of /session/end, so an ad credited to a settled
       session still appears as its own entry here.

    Entries are sorted newest-first and truncated to `limit`. The 0-pts
    "Reading…" placeholder that used to appear for unverified sessions
    is gone — there's nothing to show for them, and surfacing "0 pts"
    was misleading.
    """
    # Reading sessions: only those that actually credited the wallet.
    session_stmt = (
        select(
            ReadingSession,
            ContentCatalog.title,
            ContentCatalog.read_order,
            ContentCatalog.total_slices,
        )
        .join(ContentCatalog, ContentCatalog.id == ReadingSession.content_id)
        .where(ReadingSession.user_id == current_user.id)
        .where(ReadingSession.end_time.is_not(None))
        .where(ReadingSession.points_earned > 0)
        .order_by(ReadingSession.end_time.desc())
        .limit(limit)
    )
    sessions = (await db.execute(session_stmt)).all()

    # Ad events: every credited ad, regardless of session_id. SSV
    # callbacks credit the wallet directly; the ad may or may not be
    # bound to a session row, but the credit lands in either case.
    ad_stmt = (
        select(AdEvent)
        .where(AdEvent.user_id == current_user.id)
        .where(AdEvent.credit_status == "credited")
        .where(AdEvent.user_points_credited > 0)
        .order_by(AdEvent.created_at.desc())
        .limit(limit)
    )
    ad_events = (await db.execute(ad_stmt)).scalars().all()

    out: list[Transaction] = []
    for session, title, read_order, total_slices in sessions:
        sid = session.id
        slice_info = _slice_label(read_order, total_slices)
        # Type "earn" because the bonus was settled at /session/end.
        # Pre-read/post-read ads credited by SSV appear separately as
        # their own "earn" entries below.
        out.append(
            Transaction(
                id=sid, type="earn", points=session.points_earned,
                description=f'Read "{title}{slice_info}"',
                date=session.end_time,
            )
        )

    for event in ad_events:
        out.append(
            Transaction(
                id=event.id, type="earn", points=event.user_points_credited,
                description="Rewarded ad",
                date=event.created_at,
            )
        )

    # Sort newest first, limit. We pull `limit` from each stream and
    # merge — a user with hundreds of ads and a handful of sessions
    # gets a coherent merged list. To bias more toward recent activity,
    # we sort by date desc and slice to `limit` again.
    out.sort(key=lambda t: t.date, reverse=True)
    return out[:limit]



# ══════════════════════════════════════════════════════════════════════
# WALLET FUNDING (DEPOSIT)
# ══════════════════════════════════════════════════════════════════════


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
    logger.info("📲 Sending payment initiated notification...")
    from app.services.fcm import send_push_notification
    asyncio.create_task(
        send_push_notification(
            db=db,
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
        reference=reference,
        amount_kobo=total_amount,
        deposit_amount_kobo=payload.deposit_amount_kobo,
    )
