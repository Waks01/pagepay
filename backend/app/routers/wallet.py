import logging
import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from pydantic import BaseModel, Field

from app.database import get_db
from app.models import ReadingSession, ContentCatalog, AdEvent, User, Payment
from app.routers.auth import get_current_user
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
    """Unified point-earning history combining reading sessions and ad rewards."""
    # Reading sessions
    session_stmt = (
        select(
            ReadingSession,
            ContentCatalog.title,
            ContentCatalog.read_order,
            ContentCatalog.total_slices,
        )
        .join(ContentCatalog, ContentCatalog.id == ReadingSession.content_id)
        .where(ReadingSession.user_id == current_user.id)
        .order_by(ReadingSession.start_time.desc())
        .limit(limit)
    )
    sessions = (await db.execute(session_stmt)).all()

    # Ad reward events
    ad_stmt = (
        select(AdEvent)
        .where(AdEvent.user_id == current_user.id)
        .where(AdEvent.credit_status == "credited")
        .where(AdEvent.user_points_credited > 0)
        .where(AdEvent.session_id.is_(None))
        .order_by(AdEvent.created_at.desc())
        .limit(limit)
    )
    ad_events = (await db.execute(ad_stmt)).scalars().all()

    out: list[Transaction] = []
    for session, title, read_order, total_slices in sessions:
        sid = session.id
        slice_info = _slice_label(read_order, total_slices)
        if session.claimed_at is not None and session.points_earned > 0:
            out.append(
                Transaction(
                    id=sid, type="earn", points=session.points_earned,
                    description=f'Earned on "{title}{slice_info}"', date=session.claimed_at,
                )
            )
        elif (session.pending_points or 0) > 0:
            out.append(
                Transaction(
                    id=sid, type="pending", points=session.pending_points or 0,
                    description=f'Watch an ad to claim "{title}{slice_info}"',
                    date=session.end_time or session.start_time,
                )
            )
        else:
            desc = "Reading..." if session.end_time is None else f'Read "{title}{slice_info}"'
            out.append(
                Transaction(
                    id=sid, type="pending", points=0,
                    description=desc,
                    date=session.end_time or session.start_time,
                )
            )

    for event in ad_events:
        out.append(
            Transaction(
                id=event.id, type="earn", points=event.user_points_credited,
                description="Ad reward", date=event.created_at,
            )
        )

    # Sort newest first, limit
    out.sort(key=lambda t: t.date, reverse=True)
    return out[:limit]



# ══════════════════════════════════════════════════════════════════════
# WALLET FUNDING (DEPOSIT)
# ══════════════════════════════════════════════════════════════════════


class WalletDepositRequest(BaseModel):
    """Request to fund wallet via Paystack."""
    amount_kobo: int = Field(ge=50000, description="Minimum ₦500 (50,000 kobo)")


class WalletDepositResponse(BaseModel):
    """Paystack checkout URL response."""
    payment_url: str
    reference: str
    amount_kobo: int


@router.post("/deposit", response_model=WalletDepositResponse)
async def initiate_wallet_deposit(
    payload: WalletDepositRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Initiate Paystack payment to fund user wallet.
    
    Minimum deposit: ₦500 (50,000 kobo)
    Conversion: 10 points = ₦1 (amount_kobo = points to credit)
    
    After successful payment, webhook will credit user's points_balance.
    """
    if not settings.paystack_secret_key:
        raise HTTPException(
            status_code=503,
            detail="Wallet funding temporarily unavailable. Please try again later.",
        )

    # M1 audit fix: enforce per-tx + 24h-rolling deposit caps BEFORE
    # talking to Paystack. A stolen-card deposit or a compromised
    # account shouldn't be able to push more than the cap through
    # the system in any 24h window.
    allowed, current_24h = record_amount_v2(
        user_id=current_user.id,
        kind="deposit",
        amount_kobo=payload.amount_kobo,
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
    
    # Generate unique reference
    reference = f"wallet_deposit_{current_user.id}_{uuid.uuid4().hex[:16]}"
    
    # Initialize Paystack transaction
    paystack = get_client()
    try:
        result = await paystack.initialize_transaction(
            email=current_user.email,
            amount_kobo=payload.amount_kobo,
            reference=reference,
            callback_url=f"{settings.frontend_url}/wallet",
            metadata={
                "user_id": current_user.id,
                "type": "wallet_deposit",
                "amount_kobo": payload.amount_kobo,
            }
        )
    except Exception as exc:
        logger.error("Paystack initialization failed for wallet deposit: %s", exc)
        raise HTTPException(status_code=502, detail="Payment provider unavailable")
    
    # Create Payment record to track deposit
    payment = Payment(
        user_id=current_user.id,
        tier="wallet_deposit",  # Using tier field to indicate deposit
        amount_kobo=payload.amount_kobo,
        provider="paystack",
        provider_tx_ref=reference,
        status="pending",
    )
    db.add(payment)
    await db.commit()
    
    logger.info(
        "Wallet deposit initiated: user_id=%d, amount=%d, ref=%s",
        current_user.id, payload.amount_kobo, reference
    )
    
    return WalletDepositResponse(
        payment_url=result["authorization_url"],
        reference=reference,
        amount_kobo=payload.amount_kobo,
    )
