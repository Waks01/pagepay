"""Transaction history API endpoints.

Aggregates all user transaction types into a single unified history:
- BillTransaction: VTU purchases
- Payment: wallet deposits / subscriptions
- PayoutTransaction: withdrawals
- UserRewardClaim: daily reward claims
- StudyTransaction: study asset unlocks
- PointCredit: one-time bonus credits
- StreakFreezeLog: streak freeze attempts
- AudioUnlock: audio unlock events
"""

import logging
from datetime import datetime
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import (
    User,
    BillTransaction,
    Payment,
    PayoutTransaction,
    UserRewardClaim,
    DailyReward,
    StudyTransaction,
    PointCredit,
    StreakFreezeLog,
    AudioUnlock,
)
from app.routers.auth import get_current_user
from app.schemas import DailyRewardHistory

logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/transactions", tags=["transactions"])


class TransactionHistoryItem(BaseModel):
    id: int
    type: Literal["bill", "payment", "payout", "daily_reward", "reading_reward", "study", "ad", "bonus", "streak_freeze", "audio_unlock"]
    subtype: str | None = None
    status: str
    amount: int  # signed: negative = debit, positive = credit
    unit: Literal["NGN", "SP", "USD"]
    description: str
    reference: str | None = None
    timestamp: datetime
    ledger: str | None = None  # service_credit | cashable | null
    metadata: dict | None = None


class TransactionHistoryResponse(BaseModel):
    items: list[TransactionHistoryItem]
    total: int
    page: int
    limit: int


def _bill_description(tx: BillTransaction) -> str:
    service = tx.service or "bill"
    if service == "airtime":
        return f"Airtime Top-up"
    if service == "data":
        return f"Data Bundle"
    if service == "electricity":
        return f"Electricity Bill"
    if service == "tv":
        return f"TV Subscription"
    if service == "recharge_pin":
        return f"Recharge Pin Purchase"
    if service == "betting":
        return f"Betting Funding"
    if service == "isp":
        return f"ISP Payment"
    if service == "education":
        return f"Education Payment"
    if service == "sms":
        return f"Bulk SMS"
    return f"Bill Payment"


def _bill_metadata(tx: BillTransaction) -> dict | None:
    meta: dict = {}
    if tx.phone:
        meta["phone"] = tx.phone
    if tx.meter_number:
        meta["meter_number"] = tx.meter_number
    if tx.smartcard_number:
        meta["smartcard_number"] = tx.smartcard_number
    if tx.amount_naira:
        meta["amount_naira"] = tx.amount_naira
    if tx.commission_naira:
        meta["commission_naira"] = tx.commission_naira
    if tx.points_earned:
        meta["points_earned"] = tx.points_earned
    if tx.external_ref:
        meta["external_ref"] = tx.external_ref
    if tx.delivery_status:
        meta["delivery_status"] = tx.delivery_status
    if tx.error_message:
        meta["error_message"] = tx.error_message
    if tx.details:
        meta.update(tx.details)
    return meta if meta else None


@router.get("/history", response_model=TransactionHistoryResponse)
async def get_transaction_history(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
) -> TransactionHistoryResponse:
    """Unified transaction history across all transaction types."""
    items: list[TransactionHistoryItem] = []

    # Bill transactions
    bill_result = await db.execute(
        select(BillTransaction)
        .where(BillTransaction.user_id == current_user.id)
        .order_by(BillTransaction.created_at.desc())
    )
    for tx in bill_result.scalars().all():
        items.append(TransactionHistoryItem(
            id=tx.id,
            type="bill",
            subtype=tx.service,
            status=tx.status,
            amount=-tx.amount_naira,
            unit="NGN",
            description=_bill_description(tx),
            reference=tx.reference,
            timestamp=tx.created_at,
            ledger="cashable",
            metadata=_bill_metadata(tx),
        ))

    # Payments
    payment_result = await db.execute(
        select(Payment)
        .where(Payment.user_id == current_user.id)
        .order_by(Payment.created_at.desc())
    )
    for tx in payment_result.scalars().all():
        subtype = tx.tier
        description = "Wallet Deposit" if tx.tier == "wallet_deposit" else f"Premium Subscription ({tx.tier})"
        items.append(TransactionHistoryItem(
            id=tx.id,
            type="payment",
            subtype=subtype,
            status=tx.status,
            amount=tx.amount_kobo,
            unit="NGN",
            description=description,
            reference=tx.provider_tx_ref,
            timestamp=tx.created_at,
            ledger="cashable",
            metadata={
                "provider": tx.provider,
                "webhook_confirmed": tx.webhook_confirmed,
                "payment_metadata": tx.payment_metadata,
                "confirmed_at": tx.confirmed_at.isoformat() if tx.confirmed_at else None,
            } if tx.payment_metadata or tx.webhook_confirmed else None,
        ))

    # Payouts / withdrawals
    payout_result = await db.execute(
        select(PayoutTransaction)
        .where(PayoutTransaction.user_id == current_user.id)
        .order_by(PayoutTransaction.created_at.desc())
    )
    for tx in payout_result.scalars().all():
        items.append(TransactionHistoryItem(
            id=tx.id,
            type="payout",
            status=tx.status,
            amount=-(tx.amount_kobo + tx.fee_kobo),
            unit="NGN",
            description=f"Withdrawal to {tx.recipient_code}",
            reference=tx.reference,
            timestamp=tx.created_at,
            ledger="cashable",
            metadata={
                "amount_kobo": tx.amount_kobo,
                "fee_kobo": tx.fee_kobo,
                "recipient_code": tx.recipient_code,
                "reason": tx.reason,
                "paystack_transfer_code": tx.paystack_transfer_code,
                "balance_after_debit": tx.balance_after_debit,
                "settled_at": tx.settled_at.isoformat() if tx.settled_at else None,
                "paystack_event_id": tx.paystack_event_id,
            },
        ))

    # Daily reward claims
    claim_result = await db.execute(
        select(UserRewardClaim)
        .where(UserRewardClaim.user_id == current_user.id)
        .order_by(UserRewardClaim.claimed_at.desc())
    )
    for tx in claim_result.scalars().all():
        # Fetch reward details
        reward_result = await db.execute(
            select(DailyReward).where(DailyReward.id == tx.reward_id)
        )
        reward = reward_result.scalar_one_or_none()
        
        items.append(TransactionHistoryItem(
            id=tx.id,
            type="daily_reward",
            status="success",
            amount=tx.points_earned,
            unit="SP",
            description=f"Day {tx.streak_day} Reward",
            reference=f"DR-{tx.id}",
            timestamp=tx.claimed_at,
            ledger="service_credit",
            metadata={
                "reward_id": tx.reward_id,
                "streak_day": tx.streak_day,
                "claim_date": tx.claim_date,
                "points_earned": tx.points_earned,
                "reward_title": reward.title if reward else None,
                "reward_description": reward.description if reward else None,
                "reward_type": reward.reward_type if reward else None,
                "reward_value": reward.reward_value if reward else None,
                "icon_emoji": reward.icon_emoji if reward else "🎁",
            },
        ))

    # Study transactions
    study_result = await db.execute(
        select(StudyTransaction)
        .where(StudyTransaction.user_id == current_user.id)
        .order_by(StudyTransaction.created_at.desc())
    )
    for tx in study_result.scalars().all():
        subtype = tx.method
        description = f"Study Asset Unlock ({tx.method})"
        items.append(TransactionHistoryItem(
            id=tx.id,
            type="study",
            subtype=subtype,
            status="success" if tx.reward_granted else "failed",
            amount=-tx.points_spent if tx.method == "points" else 0,
            unit="SP",
            description=description,
            reference=None,
            timestamp=tx.created_at,
            ledger="service_credit",
            metadata={
                "asset_id": tx.asset_id,
                "method": tx.method,
                "points_spent": tx.points_spent,
                "reward_granted": tx.reward_granted,
            },
        ))

    # Point credits
    credit_result = await db.execute(
        select(PointCredit)
        .where(PointCredit.user_id == current_user.id)
        .order_by(PointCredit.created_at.desc())
    )
    for tx in credit_result.scalars().all():
        # Distinguish reading rewards from other bonuses
        is_reading = tx.source and tx.source.startswith("reading_slice_")
        tx_type = "reading_reward" if is_reading else "bonus"
        description = "Reading Slice Reward" if is_reading else f"Bonus: {tx.source}"

        items.append(TransactionHistoryItem(
            id=tx.id,
            type=tx_type,
            subtype=tx.source,
            status="success",
            amount=tx.points,
            unit="SP",
            description=description,
            reference=None,
            timestamp=tx.created_at,
            ledger="service_credit",
            metadata={
                "source": tx.source,
                "metadata_json": tx.metadata_json,
            } if tx.metadata_json else None,
        ))

    # Streak freeze logs
    freeze_result = await db.execute(
        select(StreakFreezeLog)
        .where(StreakFreezeLog.user_id == current_user.id)
        .order_by(StreakFreezeLog.created_at.desc())
    )
    for tx in freeze_result.scalars().all():
        description = f"Streak Freeze ({tx.method})"
        items.append(TransactionHistoryItem(
            id=tx.id,
            type="streak_freeze",
            subtype=tx.method,
            status="success",
            amount=-tx.sv_spent,
            unit="SP",
            description=description,
            reference=None,
            timestamp=tx.created_at,
            ledger="service_credit",
            metadata={
                "sv_spent": tx.sv_spent,
                "streak_length_at_freeze": tx.streak_length_at_freeze,
                "ad_event_id": tx.ad_event_id,
                "device_id_hash": tx.device_id_hash,
            },
        ))

    # Audio unlocks
    audio_result = await db.execute(
        select(AudioUnlock)
        .where(AudioUnlock.user_id == current_user.id)
        .order_by(AudioUnlock.created_at.desc())
    )
    for tx in audio_result.scalars().all():
        description = f"Audio Unlock ({tx.method})"
        items.append(TransactionHistoryItem(
            id=tx.id,
            type="audio_unlock",
            subtype=tx.method,
            status="success",
            amount=-tx.cost_sv,
            unit="SP",
            description=description,
            reference=None,
            timestamp=tx.created_at,
            ledger="service_credit",
            metadata={
                "material_id": tx.material_id,
                "method": tx.method,
                "cost_sv": tx.cost_sv,
                "ad_event_id": tx.ad_event_id,
            },
        ))

    # Sort all by timestamp DESC
    items.sort(key=lambda x: x.timestamp, reverse=True)

    total = len(items)
    offset = (page - 1) * limit
    paginated = items[offset:offset + limit]

    return TransactionHistoryResponse(
        items=paginated,
        total=total,
        page=page,
        limit=limit,
    )


@router.get("/receipt/{transaction_id}/pdf")
async def download_receipt_pdf(
    transaction_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Download transaction receipt as PDF.
    
    Only supports bill transactions for now.
    """
    from fastapi.responses import Response
    from app.services.pdf_receipt import generate_receipt_pdf
    
    # Get bill transaction
    result = await db.execute(
        select(BillTransaction)
        .where(
            BillTransaction.id == transaction_id,
            BillTransaction.user_id == current_user.id
        )
    )
    transaction = result.scalar_one_or_none()
    
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    # Generate PDF
    pdf_bytes = generate_receipt_pdf(transaction)
    
    # Return as downloadable file
    filename = f"pagepay_receipt_{transaction.reference}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        }
    )


@router.get("/receipt/{transaction_id}/image")
async def download_receipt_image(
    transaction_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Download transaction receipt as PNG image.
    
    Only supports bill transactions for now.
    """
    from fastapi.responses import Response
    from app.services.image_receipt import generate_receipt_image
    
    # Get bill transaction
    result = await db.execute(
        select(BillTransaction)
        .where(
            BillTransaction.id == transaction_id,
            BillTransaction.user_id == current_user.id
        )
    )
    transaction = result.scalar_one_or_none()
    
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    # Generate image
    image_bytes = generate_receipt_image(transaction)
    
    # Return as downloadable file
    filename = f"pagepay_receipt_{transaction.reference}.png"
    return Response(
        content=image_bytes,
        media_type="image/png",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        }
    )
