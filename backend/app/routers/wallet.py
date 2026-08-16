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
from app.models import ReadingSession, ContentCatalog, AdEvent, User, Payment, BillTransaction, PayoutTransaction, PointCredit, StudyTransaction, StudyMaterial, PayoutAccount as PayoutAccountRow
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

    # Bill transactions: every successful VTU purchase that earned points.
    bill_stmt = (
        select(BillTransaction)
        .where(BillTransaction.user_id == current_user.id)
        .where(BillTransaction.status == "success")
        .where(BillTransaction.points_earned > 0)
        .order_by(BillTransaction.created_at.desc())
        .limit(limit)
    )
    bill_txs = (await db.execute(bill_stmt)).scalars().all()

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

    for bill in bill_txs:
        service_label = bill.service.replace("_", " ").title()
        description = f"Bought {service_label}"
        if bill.phone:
            description += f" for {bill.phone}"
        elif bill.meter_number:
            description += f" (meter {bill.meter_number})"
        elif bill.smartcard_number:
            description += f" (smartcard {bill.smartcard_number})"
        if bill.points_earned > 0:
            description += f" — earned {bill.points_earned} pts"
        out.append(
            Transaction(
                id=bill.id, type="earn", points=bill.points_earned,
                description=description,
                date=bill.created_at,
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


# ══════════════════════════════════════════════════════════════════════
# UNIFIED WALLET HISTORY
# ══════════════════════════════════════════════════════════════════════

from fastapi import Query


def _norm(v):
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.isoformat()
    return str(v)


def _safe_meta(details, *keys):
    if not details:
        return None
    if isinstance(details, dict):
        for k in keys:
            if k in details and details[k] is not None:
                return details[k]
    return None


def _normalise_service(raw: str | None) -> str | None:
    if not raw:
        return raw
    value = raw.strip().lower()
    aliases = {
        "recharge_pin": "recharge",
        "isp_smile": "isp",
        "isp_spectranet": "isp",
    }
    return aliases.get(value, value)


def _map_bill_row(tx: BillTransaction) -> dict:
    service = _normalise_service(tx.service)
    amount_naira = tx.amount_naira / 100
    details = {
        "provider": tx.provider,
        "amountNaira": amount_naira,
    }
    if tx.phone:
        details["phone"] = tx.phone
    if tx.meter_number:
        details["meterNumber"] = tx.meter_number
    if tx.smartcard_number:
        details["smartcard"] = tx.smartcard_number
    if hasattr(tx, 'network_name') and tx.network_name:
        details["network"] = tx.network_name
    if hasattr(tx, 'customer_name') and tx.customer_name:
        details["customerName"] = tx.customer_name
    if hasattr(tx, 'token') and tx.token:
        details["token"] = tx.token
    if hasattr(tx, 'units') and tx.units:
        details["units"] = str(tx.units)
    if hasattr(tx, 'total_cost') and tx.total_cost is not None:
        details["totalCost"] = tx.total_cost / 100
    if tx.details:
        details.update(tx.details)

    descriptions = {
        "airtime": f"Airtime Top-up - {_safe_meta(details, 'network') or tx.provider}",
        "data": f"Data Bundle - {_safe_meta(details, 'network') or tx.provider}",
        "electricity": f"Electricity Bill - {_safe_meta(details, 'network') or tx.provider}",
        "tv": f"TV Subscription - {tx.provider}",
        "recharge": "Recharge Pin Purchase",
        "betting": f"Betting Funding - {_safe_meta(details, 'network') or tx.provider}",
        "isp": f"ISP Payment - {_safe_meta(details, 'network') or tx.provider}",
        "education": f"Education Payment - {_safe_meta(details, 'network') or tx.provider}",
        "sms": f"Bulk SMS - {_safe_meta(details, 'units', 'amountNaira') or tx.provider}",
    }
    description = descriptions.get(service, f"Bought {service}" if service else "Bill payment")

    return {
        "kind": "bill",
        "type": service or "spend",
        "status": tx.status,
        "txId": f"BT-{tx.id}",
        "ref": tx.reference,
        "description": description,
        "points": tx.points_earned,
        "amount": -int(amount_naira * 100),
        "date": tx.created_at,
        "details": details,
    }


@router.get("/history", response_model=list[dict])
async def get_wallet_history(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    type: str | None = Query(default=None),
    date: str | None = Query(default=None),
    search: str | None = Query(default=None),
    direction: str | None = Query(default=None),
):
    items: list[dict] = []

    sessions = (
        await db.execute(
            select(ReadingSession, ContentCatalog.title)
            .where(ReadingSession.user_id == current_user.id)
            .where(ReadingSession.end_time.is_not(None))
            .where(ReadingSession.points_earned > 0)
            .order_by(ReadingSession.end_time.desc())
        )
    ).all()
    for session, title in sessions:
        read_order = getattr(session, "read_order", None)
        total_slices = getattr(session, "total_slices", None)
        slice_info = _slice_label(read_order, total_slices)
        items.append({
            "kind": "read",
            "type": "read",
            "status": "success",
            "txId": f"RS-{session.id}",
            "ref": f"RS-{session.id}",
            "description": f'Read "{title}{slice_info}"',
            "points": session.points_earned,
            "amount": session.points_earned,
            "date": session.end_time,
            "details": {
                "title": title,
                "pages": session.duration_seconds // 60,
                "reward": session.points_earned,
            },
        })

    ad_events = (
        await db.execute(
            select(AdEvent)
            .where(AdEvent.user_id == current_user.id)
            .where(AdEvent.credit_status == "credited")
            .where(AdEvent.user_points_credited > 0)
            .order_by(AdEvent.created_at.desc())
        )
    ).scalars().all()
    for event in ad_events:
        items.append({
            "kind": "ad",
            "type": "ad",
            "status": "success",
            "txId": f"AD-{event.id}",
            "ref": event.transaction_id or f"AD-{event.id}",
            "description": f"{event.ad_type.replace('_', ' ').title()} Reward",
            "points": event.user_points_credited or 0,
            "amount": event.user_points_credited or 0,
            "date": event.created_at,
            "details": {
                "adType": event.ad_type,
                "campaign": event.ad_unit,
                "reward": event.user_points_credited,
            },
        })

    bill_txs = (
        await db.execute(
            select(BillTransaction)
            .where(BillTransaction.user_id == current_user.id)
            .order_by(BillTransaction.created_at.desc())
        )
    ).scalars().all()
    for tx in bill_txs:
        items.append(_map_bill_row(tx))

    payments = (
        await db.execute(
            select(Payment)
            .where(Payment.user_id == current_user.id)
            .order_by(Payment.created_at.desc())
        )
    ).scalars().all()
    for payment in payments:
        if payment.tier == "wallet_deposit":
            amount_naira = payment.amount_kobo / 100
            items.append({
                "kind": "payment",
                "type": "wallet",
                "status": payment.status,
                "txId": f"PAY-{payment.id}",
                "ref": payment.provider_tx_ref,
                "description": f"Wallet Funding - {payment.provider}",
                "points": 0,
                "amount": payment.amount_kobo,
                "date": payment.created_at,
                "details": {
                    "source": payment.provider.title(),
                    "amountNaira": amount_naira,
                    "reference": payment.provider_tx_ref,
                },
            })
        elif payment.tier in ("premium_monthly", "premium_yearly"):
            amount_naira = payment.amount_kobo / 100
            items.append({
                "kind": "payment",
                "type": "premium",
                "status": payment.status,
                "txId": f"PAY-{payment.id}",
                "ref": payment.provider_tx_ref,
                "description": f"Premium Subscription - {payment.tier.replace('premium_', '').title()}",
                "points": 0,
                "amount": -payment.amount_kobo,
                "date": payment.created_at,
                "details": {
                    "plan": payment.tier.replace("premium_", "").title(),
                    "amountNaira": amount_naira,
                    "nextBilling": _norm(payment.confirmed_at) if payment.confirmed_at else None,
                },
            })

    withdrawals = (
        await db.execute(
            select(PayoutTransaction)
            .where(PayoutTransaction.user_id == current_user.id)
            .order_by(PayoutTransaction.created_at.desc())
        )
    ).scalars().all()
    account = (
        await db.execute(
            select(PayoutAccountRow)
            .where(PayoutAccountRow.user_id == current_user.id)
        )
    ).scalar_one_or_none()
    for w in withdrawals:
        points = w.amount_kobo
        items.append({
            "kind": "withdrawal",
            "type": "withdraw",
            "status": w.status,
            "txId": f"WD-{w.id}",
            "ref": w.reference,
            "description": w.reason or "Wallet Withdrawal",
            "points": points,
            "amount": -points,
            "date": w.created_at,
            "details": {
                "fee": w.fee_kobo,
                "balanceAfter": w.balance_after_debit,
                "bank": account.bank_name if account else None,
                "accountLast4": account.account_number_last4 if account else None,
            },
        })

    study_txs = (
        await db.execute(
            select(StudyTransaction)
            .where(StudyTransaction.user_id == current_user.id)
            .order_by(StudyTransaction.created_at.desc())
        )
    ).scalars().all()
    for st in study_txs:
        material = (
            await db.execute(
                select(StudyMaterial.title, StudyMaterial.exam_type)
                .where(StudyMaterial.id == st.asset_id)
            )
        ).first()
        title = material[0] if material else None
        exam_type = material[1] if material else None
        if st.method == "points" and st.points_spent > 0:
            items.append({
                "kind": "study",
                "type": "study",
                "status": "success" if st.reward_granted else "failed",
                "txId": f"ST-{st.id}",
                "ref": f"ST-{st.id}",
                "description": f"Study Session - {title or 'Study Material'}",
                "points": -st.points_spent,
                "amount": -st.points_spent,
                "date": st.created_at,
                "details": {
                    "topic": title,
                    "duration": "N/A",
                    "pointsEarned": 0,
                    "examType": exam_type,
                },
            })
        elif st.method == "ad":
            items.append({
                "kind": "study",
                "type": "study",
                "status": "success" if st.reward_granted else "failed",
                "txId": f"ST-{st.id}",
                "ref": f"ST-{st.id}",
                "description": f"Study Reward - {title or 'Study Material'}",
                "points": st.points_spent,
                "amount": st.points_spent,
                "date": st.created_at,
                "details": {
                    "topic": title,
                    "duration": "N/A",
                    "pointsEarned": st.points_spent,
                    "examType": exam_type,
                },
            })

    point_credits = (
        await db.execute(
            select(PointCredit)
            .where(PointCredit.user_id == current_user.id)
            .order_by(PointCredit.created_at.desc())
        )
    ).scalars().all()
    for credit in point_credits:
        label = {
            "welcome_bonus": "Welcome Bonus",
            "referral_referee": "Referral Bonus",
            "referral_referrer": "Referral Bonus",
        }.get(credit.source, credit.source.replace("_", " ").title())
        items.append({
            "kind": "bonus",
            "type": "bonus",
            "status": "success",
            "txId": f"PC-{credit.id}",
            "ref": f"PC-{credit.id}",
            "description": label,
            "points": credit.points,
            "amount": credit.points,
            "date": credit.created_at,
            "details": {
                "reason": credit.source,
                "points": credit.points,
            },
        })

    items.sort(key=lambda x: x["date"], reverse=True)
    if type:
        items = [item for item in items if item.get("type") == type]
    if direction == 'earn':
        items = [item for item in items if (item.get("amount") or 0) > 0]
    elif direction == 'spend':
        items = [item for item in items if (item.get("amount") or 0) < 0]
    if date:
        now = datetime.utcnow()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        yesterday_start = today_start - timedelta(days=1)
        week_start = today_start - timedelta(days=7)
        month_start = today_start - timedelta(days=30)
        filtered = []
        for item in items:
            try:
                item_date = datetime.fromisoformat(item.get("date", "").replace("Z", "+00:00")).replace(tzinfo=None)
            except Exception:
                continue
            if date == 'Today' and today_start <= item_date:
                filtered.append(item)
            elif date == 'Yesterday' and yesterday_start <= item_date < today_start:
                filtered.append(item)
            elif date == 'This Week' and week_start <= item_date:
                filtered.append(item)
            elif date == 'This Month' and month_start <= item_date:
                filtered.append(item)
        items = filtered
    if search:
        q = search.lower()
        items = [item for item in items if q in item.get("description", "").lower() or q in item.get("txId", "").lower() or q in item.get("ref", "").lower()]
    return items[offset:offset + limit]


@router.get("/history/{type}/{item_id}", response_model=dict)
async def get_wallet_history_detail(
    type: str,
    item_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    prefix = item_id.split("-")[0] if "-" in item_id else ""
    if prefix == "BT":
        bill_id = int(item_id.split("-")[1])
        result = await db.execute(
            select(BillTransaction).where(
                BillTransaction.id == bill_id,
                BillTransaction.user_id == current_user.id,
            )
        )
        tx = result.scalar_one_or_none()
        if not tx:
            raise HTTPException(status_code=404, detail="Transaction not found")
        return _map_bill_row(tx)
    if prefix == "PAY":
        payment_id = int(item_id.split("-")[1])
        result = await db.execute(
            select(Payment).where(
                Payment.id == payment_id,
                Payment.user_id == current_user.id,
            )
        )
        payment = result.scalar_one_or_none()
        if not payment:
            raise HTTPException(status_code=404, detail="Transaction not found")
        if payment.tier == "wallet_deposit":
            return {
                "kind": "payment",
                "type": "wallet",
                "status": payment.status,
                "txId": f"PAY-{payment.id}",
                "ref": payment.provider_tx_ref,
                "description": f"Wallet Funding - {payment.provider}",
                "points": 0,
                "amount": payment.amount_kobo,
                "date": payment.created_at,
                "details": {
                    "source": payment.provider.title(),
                    "amountNaira": payment.amount_kobo / 100,
                    "reference": payment.provider_tx_ref,
                },
            }
        return {
            "kind": "payment",
            "type": "premium",
            "status": payment.status,
            "txId": f"PAY-{payment.id}",
            "ref": payment.provider_tx_ref,
            "description": f"Premium Subscription - {payment.tier.replace('premium_', '').title()}",
            "points": 0,
            "amount": -payment.amount_kobo,
            "date": payment.created_at,
            "details": {
                "plan": payment.tier.replace("premium_", "").title(),
                "amountNaira": payment.amount_kobo / 100,
            },
        }
    if prefix == "WD":
        w_id = int(item_id.split("-")[1])
        result = await db.execute(
            select(PayoutTransaction).where(
                PayoutTransaction.id == w_id,
                PayoutTransaction.user_id == current_user.id,
            )
        )
        w = result.scalar_one_or_none()
        if not w:
            raise HTTPException(status_code=404, detail="Transaction not found")
        account = (
            await db.execute(
                select(PayoutAccountRow).where(
                    PayoutAccountRow.user_id == current_user.id
                )
            )
        ).scalar_one_or_none()
        return {
            "kind": "withdrawal",
            "type": "withdraw",
            "status": w.status,
            "txId": f"WD-{w.id}",
            "ref": w.reference,
            "description": w.reason or "Wallet Withdrawal",
            "points": w.amount_kobo,
            "amount": -w.amount_kobo,
            "date": w.created_at,
            "details": {
                "fee": w.fee_kobo,
                "balanceAfter": w.balance_after_debit,
                "bank": account.bank_name if account else None,
                "accountLast4": account.account_number_last4 if account else None,
            },
        }
    if prefix == "RS":
        session_id = int(item_id.split("-")[1])
        result = await db.execute(
            select(ReadingSession, ContentCatalog.title)
            .where(
                ReadingSession.id == session_id,
                ReadingSession.user_id == current_user.id,
            )
            .join(ContentCatalog, ContentCatalog.id == ReadingSession.content_id)
        )
        row = result.first()
        if not row:
            raise HTTPException(status_code=404, detail="Transaction not found")
        session, title = row
        read_order = getattr(session, "read_order", None)
        total_slices = getattr(session, "total_slices", None)
        slice_info = _slice_label(read_order, total_slices)
        return {
            "kind": "history",
            "type": "read",
            "status": "success",
            "txId": f"RS-{session.id}",
            "ref": f"RS-{session.id}",
            "description": f'Read "{title}{slice_info}"',
            "points": session.points_earned,
            "amount": session.points_earned,
            "date": session.end_time,
            "details": {
                "title": title,
                "pages": session.duration_seconds // 60,
                "reward": session.points_earned,
            },
        }
    if prefix == "AD":
        event_id = int(item_id.split("-")[1])
        result = await db.execute(
            select(AdEvent).where(
                AdEvent.id == event_id,
                AdEvent.user_id == current_user.id,
            )
        )
        event = result.scalar_one_or_none()
        if not event:
            raise HTTPException(status_code=404, detail="Transaction not found")
        return {
            "kind": "history",
            "type": "ad",
            "status": "success",
            "txId": f"AD-{event.id}",
            "ref": event.transaction_id or f"AD-{event.id}",
            "description": f"{event.ad_type.replace('_', ' ').title()} Reward",
            "points": event.user_points_credited or 0,
            "amount": event.user_points_credited or 0,
            "date": event.created_at,
            "details": {
                "adType": event.ad_type,
                "campaign": event.ad_unit,
                "reward": event.user_points_credited,
            },
        }
    if prefix == "ST":
        st_id = int(item_id.split("-")[1])
        result = await db.execute(
            select(StudyTransaction).where(
                StudyTransaction.id == st_id,
                StudyTransaction.user_id == current_user.id,
            )
        )
        st = result.scalar_one_or_none()
        if not st:
            raise HTTPException(status_code=404, detail="Transaction not found")
        material = (
            await db.execute(
                select(StudyMaterial.title, StudyMaterial.exam_type)
                .where(StudyMaterial.id == st.asset_id)
            )
        ).first()
        title = material[0] if material else None
        return {
            "kind": "history",
            "type": "study",
            "status": "success" if st.reward_granted else "failed",
            "txId": f"ST-{st.id}",
            "ref": f"ST-{st.id}",
            "description": f"Study Session - {title or 'Study Material'}",
            "points": st.points_spent,
            "amount": st.points_spent,
            "date": st.created_at,
            "details": {
                "topic": title,
                "duration": "N/A",
                "pointsEarned": st.points_spent,
                "examType": material[1] if material else None,
            },
        }
    if prefix == "PC":
        pc_id = int(item_id.split("-")[1])
        result = await db.execute(
            select(PointCredit).where(
                PointCredit.id == pc_id,
                PointCredit.user_id == current_user.id,
            )
        )
        credit = result.scalar_one_or_none()
        if not credit:
            raise HTTPException(status_code=404, detail="Transaction not found")
        label = {
            "welcome_bonus": "Welcome Bonus",
            "referral_referee": "Referral Bonus",
            "referral_referrer": "Referral Bonus",
        }.get(credit.source, credit.source.replace("_", " ").title())
        return {
            "kind": "bonus",
            "type": "bonus",
            "status": "success",
            "txId": f"PC-{credit.id}",
            "ref": f"PC-{credit.id}",
            "description": label,
            "points": credit.points,
            "amount": credit.points,
            "date": credit.created_at,
            "details": {
                "reason": credit.source,
                "points": credit.points,
            },
        }

    # Backward-compatible lookup for unprefixed IDs from the legacy
    # wallet home screen. The old UI passes plain numeric IDs with
    # kind values like `session`, `payment`, `withdrawal`, or `bill`.
    # We resolve them here so the detail screen does not need frontend
    # fallbacks.
    try:
        raw_id = int(item_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=404, detail="Transaction not found")

    if type == "withdrawal":
        raw_id_val = None
        try:
            raw_id_val = int(item_id)
        except (ValueError, TypeError):
            pass

        result = await db.execute(
            select(PayoutTransaction).where(
                PayoutTransaction.user_id == current_user.id,
                (
                    (PayoutTransaction.id == raw_id_val)
                    if raw_id_val is not None
                    else (PayoutTransaction.reference == item_id)
                ),
            )
        )
        w = result.scalar_one_or_none()
        if not w:
            raise HTTPException(status_code=404, detail="Transaction not found")
        account = (
            await db.execute(
                select(PayoutAccountRow).where(
                    PayoutAccountRow.user_id == current_user.id
                )
            )
        ).scalar_one_or_none()
        return {
            "kind": "withdrawal",
            "type": "withdraw",
            "status": w.status,
            "txId": f"WD-{w.id}",
            "ref": w.reference,
            "description": w.reason or "Wallet Withdrawal",
            "points": w.amount_kobo,
            "amount": -w.amount_kobo,
            "date": w.created_at,
            "details": {
                "fee": w.fee_kobo,
                "balanceAfter": w.balance_after_debit,
                "bank": account.bank_name if account else None,
                "accountLast4": account.account_number_last4 if account else None,
            },
        }

    if type == "payment":
        result = await db.execute(
            select(Payment).where(
                Payment.id == raw_id,
                Payment.user_id == current_user.id,
            )
        )
        payment = result.scalar_one_or_none()
        if not payment:
            raise HTTPException(status_code=404, detail="Transaction not found")
        if payment.tier == "wallet_deposit":
            return {
                "kind": "payment",
                "type": "wallet",
                "status": payment.status,
                "txId": f"PAY-{payment.id}",
                "ref": payment.provider_tx_ref,
                "description": f"Wallet Funding - {payment.provider}",
                "points": 0,
                "amount": payment.amount_kobo,
                "date": payment.created_at,
                "details": {
                    "source": payment.provider.title(),
                    "amountNaira": payment.amount_kobo / 100,
                    "reference": payment.provider_tx_ref,
                },
            }
        return {
            "kind": "payment",
            "type": "premium",
            "status": payment.status,
            "txId": f"PAY-{payment.id}",
            "ref": payment.provider_tx_ref,
            "description": f"Premium Subscription - {payment.tier.replace('premium_', '').title()}",
            "points": 0,
            "amount": -payment.amount_kobo,
            "date": payment.created_at,
            "details": {
                "plan": payment.tier.replace("premium_", "").title(),
                "amountNaira": payment.amount_kobo / 100,
            },
        }

    if type == "bill":
        result = await db.execute(
            select(BillTransaction).where(
                BillTransaction.id == raw_id,
                BillTransaction.user_id == current_user.id,
            )
        )
        tx = result.scalar_one_or_none()
        if not tx:
            raise HTTPException(status_code=404, detail="Transaction not found")
        return _map_bill_row(tx)

    if type in ("session", "history"):
        session_result = await db.execute(
            select(ReadingSession, ContentCatalog.title)
            .where(
                ReadingSession.id == raw_id,
                ReadingSession.user_id == current_user.id,
            )
            .join(ContentCatalog, ContentCatalog.id == ReadingSession.content_id)
        )
        row = session_result.first()
        if row:
            session, title = row
            read_order = getattr(session, "read_order", None)
            total_slices = getattr(session, "total_slices", None)
            slice_info = _slice_label(read_order, total_slices)
            return {
                "kind": "history",
                "type": "read",
                "status": "success",
                "txId": f"RS-{session.id}",
                "ref": f"RS-{session.id}",
                "description": f'Read "{title}{slice_info}"',
                "points": session.points_earned,
                "amount": session.points_earned,
                "date": session.end_time,
                "details": {
                    "title": title,
                    "pages": session.duration_seconds // 60,
                    "reward": session.points_earned,
                },
            }

        event_result = await db.execute(
            select(AdEvent).where(
                AdEvent.id == raw_id,
                AdEvent.user_id == current_user.id,
            )
        )
        event = event_result.scalar_one_or_none()
        if event:
            return {
                "kind": "history",
                "type": "ad",
                "status": "success",
                "txId": f"AD-{event.id}",
                "ref": event.transaction_id or f"AD-{event.id}",
                "description": f"{event.ad_type.replace('_', ' ').title()} Reward",
                "points": event.user_points_credited or 0,
                "amount": event.user_points_credited or 0,
                "date": event.created_at,
                "details": {
                    "adType": event.ad_type,
                    "campaign": event.ad_unit,
                    "reward": event.user_points_credited,
                },
            }

    raise HTTPException(status_code=404, detail="Transaction not found")
