"""Bills & Earn endpoints (Phase 8).

Users buy airtime, data, electricity, or cable TV subscriptions and earn
points back from the VTU provider's commission — the platform never funds
rewards from its own pocket.

Flow for every purchase:
  1. User requests a purchase (phone/meter, amount, network)
  2. Backend debits the user's wallet for the amount
  3. Backend calls VTU provider to fulfill the purchase
  4. Provider pays a commission (varies by service)
  5. Backend splits the commission: user gets points, platform keeps the rest
  6. Backend records the BillTransaction row
  7. User receives the service + points

Supported providers: Peyflex (client.peyflex.com.ng), Bigisub (api.bigisub.ng)
Switch provider via BILLS_PROVIDER env var.
"""

from __future__ import annotations

import logging
import uuid
import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.config import settings
from app.database import get_db
from app.models import BillTransaction, User, Beneficiary, BillDispute, ScheduledBill
from app.routers.auth import get_current_user
from app.schemas import (
    AirtimePurchaseRequest,
    AirtimePurchaseResponse,
    DataPurchaseRequest,
    ElectricityPurchaseRequest,
    TelevisionPurchaseRequest,
    BillsPurchaseResponse,
    BillTransactionOut,
    BillsHistoryResponse,
    BeneficiaryOut,
    BeneficiaryCreate,
    BeneficiaryDeleteResponse,
    BillDisputeCreate,
    BillDisputeOut,
    BillDisputeListResponse,
    BulkAirtimePurchaseRequest,
    BulkAirtimePurchaseResponse,
    BulkPurchaseResult,
    ScheduledBillCreate,
    ScheduledBillOut,
    ScheduledBillListResponse,
    ScheduledBillCancelResponse,
)
from app.services.money import kobo_to_points
from app.services.peyflex import get_client as get_peyflex_client, get_public_client as get_peyflex_public_client, PeyflexError
from app.services.bigisub import get_client as get_bigisub_client, BigisubError
from app.services.pdf_receipt import generate_receipt_pdf
from app.services.rate_limiter import enforce_rate_limits, get_remaining_quota

logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/bills", tags=["bills"])

_USER_SHARE = settings.bills_user_share
_POINTS_PER_NAIRA = settings.points_per_naira


def _get_vtu_client():
    if settings.bills_provider == "bigisub":
        return get_bigisub_client()
    return get_peyflex_client()


def _get_vtu_public_client():
    if settings.bills_provider == "bigisub":
        return get_bigisub_client()
    return get_peyflex_public_client()


def _vtu_error(exc: Exception) -> HTTPException:
    if isinstance(exc, (PeyflexError, BigisubError)):
        logger.error("VTU provider error: %s", exc)
        msg = str(exc)
        safe_msg = msg if msg else "Payment provider error"
        for sensitive in ["token", "key", "secret", "password", "authorization"]:
            safe_msg = safe_msg.replace(sensitive, "***")
        return HTTPException(status_code=502, detail=f"Payment provider error: {safe_msg}")
    raise exc


def _compute_points(commission_kobo: int, user: User | None = None) -> int:
    """Compute user's point share from a commission amount in kobo.
    
    The commission comes from the VTU provider's `discount` field in the API response,
    which reflects the real-time discount/margin rate:
    - Peyflex: discount percentage (e.g. "2.5").
    - Bigisub: computed as (plan_amount - charged) / plan_amount * 100.
    
    Users receive 67% of the commission as points (10 pts = ₦1).
    Platform keeps 33% to cover infrastructure costs.
    
    Premium users get 2x multiplier on bills cashback (Phase 2).
    """
    user_share_kobo = int(commission_kobo * _USER_SHARE)
    base_points = user_share_kobo * _POINTS_PER_NAIRA // 100
    
    # Apply premium multiplier to bills cashback (Phase 2)
    if user:
        from app.services.subscription import get_points_multiplier
        multiplier = get_points_multiplier(user, "bills")
        return int(base_points * multiplier)
    
    return base_points


def _effective_commission_kobo(
    amount_kobo: int,
    service: str,
    discount: str | None = None,
    charged: float | None = None,
    price_naira: float | None = None,
) -> int:
    """Convert provider discount/charged data to commission kobo, with fallback.

    Tries, in order:
    1. Provider `discount` percentage (Peyflex, some Bigisub responses).
    2. `charged` minus `price_naira` for services where the API returns both.
    3. Fallback minimum commission (1.8% of transaction value) so users earn
       points even when the provider returns 0/unknown discount.

    The fallback matches the frontend estimate users see before purchase.
    """
    commission_kobo = 0

    if discount is not None:
        try:
            commission_kobo = int(float(discount) * 100)
        except (ValueError, TypeError):
            pass

    if commission_kobo <= 0 and charged is not None and price_naira is not None:
        try:
            commission_kobo = int((price_naira - charged) * 100)
        except (ValueError, TypeError):
            pass

    if commission_kobo <= 0:
        fallback_kobo = max(1, int(amount_kobo * 0.018))
        logger.info("VTU %s returned 0 commission; using fallback of %d kobo", service, fallback_kobo)
        commission_kobo = fallback_kobo

    return commission_kobo


def _generate_reference() -> str:
    return f"BILL-{uuid.uuid4().hex[:12].upper()}"


# ── Airtime ──────────────────────────────────────────────────────────


@router.get("/airtime/networks")
async def list_airtime_networks():
    """List airtime networks available on VTU provider."""
    nets = await _get_vtu_public_client().get_airtime_networks()
    return [{"id": str(n.id), "name": n.name} for n in nets]


@router.post("/airtime", response_model=AirtimePurchaseResponse)
async def buy_airtime(
    payload: AirtimePurchaseRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AirtimePurchaseResponse:
    """Buy airtime and earn points from the commission."""
    # Enforce rate limits (10/hour, 50/day)
    await enforce_rate_limits(current_user.id, "airtime")
    
    reference = _generate_reference()
    amount_kobo = payload.amount_naira * 100

    user_row = (
        await db.execute(
            select(User).where(User.id == current_user.id).with_for_update()
        )
    ).scalar_one_or_none()
    if user_row is None:
        raise HTTPException(status_code=404, detail="User not found")

    # SV Discount eligibility check (Phase 4)
    actual_sv_discount = 0
    if payload.apply_sv_discount > 0:
        from app.services.discount import check_discount_eligibility, SvShortfallError
        try:
            actual_sv_discount = await check_discount_eligibility(
                user=user_row,
                product_type="airtime",
                price_kobo=amount_kobo,
                sv_requested=payload.apply_sv_discount,
                db=db,
            )
        except SvShortfallError as e:
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "insufficient_sv",
                    "shortfall_sv": e.shortfall_sv,
                    "ads_needed": e.ads_needed,
                    "ads_remaining": e.ads_remaining,
                    "user_balance": e.user_balance,
                    "requested_sv": e.requested_sv,
                    "earn_route": "watch_ads",
                },
            )

    # Calculate cash payment after SV discount
    sv_discount_kobo = actual_sv_discount * 10  # 1 sv = ₦0.10
    cash_payment_kobo = amount_kobo - sv_discount_kobo

    if settings.wallet_split_enabled:
        if user_row.cashable_balance < kobo_to_points(cash_payment_kobo):
            raise HTTPException(status_code=402, detail="Insufficient cashable balance")
        if actual_sv_discount > 0 and user_row.service_credit_balance < actual_sv_discount:
            raise HTTPException(status_code=402, detail="Insufficient service credits")
    else:
        if user_row.points_balance < kobo_to_points(amount_kobo):
            raise HTTPException(status_code=402, detail="Insufficient balance")


    # Debit cashable for cash portion and service credits for discount
    if settings.wallet_split_enabled:
        # Debit cashable balance for cash payment
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(cashable_balance=User.cashable_balance - kobo_to_points(cash_payment_kobo))
        )
        # Debit service credits if discount applied
        if actual_sv_discount > 0:
            await db.execute(
                update(User)
                .where(User.id == current_user.id)
                .values(service_credit_balance=User.service_credit_balance - actual_sv_discount)
            )
    else:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(points_balance=User.points_balance - kobo_to_points(amount_kobo))
        )

    # 2. Call VTU provider
    try:
        result = await _get_vtu_client().buy_airtime(
            network=payload.network,
            mobile_number=payload.phone,
            amount=payload.amount_naira,
        )
    except (PeyflexError, BigisubError) as exc:
        await db.rollback()
        raise _vtu_error(exc)

    if result.status != "success":
        await db.rollback()
        raise HTTPException(status_code=502, detail=f"Purchase failed: {result.message}")

    commission_kobo = _effective_commission_kobo(
        amount_kobo=amount_kobo,
        service="airtime",
        discount=result.discount,
    )

    # Get full user object for multiplier calculation (Phase 2)
    user_result = await db.execute(select(User).where(User.id == current_user.id))
    full_user = user_result.scalar_one()
    points = _compute_points(commission_kobo, full_user)
    
    logger.info(
        "Bills cashback: user=%d tier=%s service=airtime commission=%d points=%d sv_discount=%d",
        current_user.id, full_user.tier.value, commission_kobo, points, actual_sv_discount
    )

    # 4. Record transaction and credit points
    tx = BillTransaction(
        user_id=current_user.id,
        service="airtime",
        provider=settings.bills_provider,
        phone=payload.phone,
        amount_naira=payload.amount_naira,
        commission_naira=commission_kobo,
        points_earned=points,
        reference=reference,
        status="success",
        external_ref=result.reference,
        details={
            "network": result.network,
            "network_name": payload.network.upper(),
            "amount": str(result.amount),
            "discount": result.discount,
            "mobile_number": result.mobile_number,
        },
    )
    db.add(tx)

    # Credit commission as service credits (not cashable)
    if settings.wallet_split_enabled:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(service_credit_balance=User.service_credit_balance + points)
        )
        # Get new balances for response
        user_result = await db.execute(select(User).where(User.id == current_user.id))
        updated_user = user_result.scalar_one()
        new_cashable = updated_user.cashable_balance
        new_service_credit = updated_user.service_credit_balance
    else:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(points_balance=User.points_balance + points)
        )
        user_result = await db.execute(select(User).where(User.id == current_user.id))
        updated_user = user_result.scalar_one()
        new_cashable = updated_user.points_balance
        new_service_credit = 0
    
    await db.commit()

    from app.services.notifications import create_notification_background
    from app.services.fcm import send_push_notification_background

    asyncio.create_task(create_notification_background(
        user_id=current_user.id,
        title="Airtime Purchase Successful",
        body=f"You bought ₦{payload.amount_naira} airtime for {payload.phone} and earned {points} points.",
        category="wallet_updates",
        data={"type": "wallet_update", "service": "airtime", "points": str(points)},
    ))
    asyncio.create_task(send_push_notification_background(
        user_id=current_user.id,
        title="Airtime Purchase Successful",
        body=f"You bought ₦{payload.amount_naira} airtime for {payload.phone} and earned {points} points.",
        data={"type": "wallet_update", "service": "airtime", "points": str(points)},
        category="wallet_updates",
    ))

    # Build payment breakdown for response
    payment_breakdown = None
    if actual_sv_discount > 0:
        payment_breakdown = {
            "cashable_paid_kobo": cash_payment_kobo,
            "sv_discount_kobo": sv_discount_kobo,
            "sv_discount_pts": actual_sv_discount,
            "commission_earned_sv": points,
        }

    return AirtimePurchaseResponse(
        reference=reference,
        phone=payload.phone,
        amount_naira=payload.amount_naira,
        network=payload.network,
        commission_naira=commission_kobo,
        points_earned=points,
        new_balance=new_cashable if not settings.wallet_split_enabled else new_cashable + new_service_credit,
        status="success",
        payment_breakdown=payment_breakdown,
        new_service_credit_balance=new_service_credit if settings.wallet_split_enabled else None,
        new_cashable_balance=new_cashable if settings.wallet_split_enabled else None,
    )


# ── Data ──────────────────────────────────────────────────────────────

@router.post("/airtime/bulk", response_model=BulkAirtimePurchaseResponse)
async def buy_airtime_bulk(
    payload: BulkAirtimePurchaseRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BulkAirtimePurchaseResponse:
    """Buy airtime for multiple numbers in parallel.
    
    Processes up to 50 recipients at once. Each purchase is independent:
    - Success/failure per recipient
    - Points earned per successful purchase
    - Failed purchases don't rollback successful ones
    
    Total cost is deducted upfront; failed purchases are refunded.
    """
    # Enforce rate limits (counts as 1 bulk request, not N individual)
    await enforce_rate_limits(current_user.id, "airtime")
    
    recipients = payload.recipients
    if len(recipients) > 50:
        raise HTTPException(status_code=400, detail="Maximum 50 recipients per bulk purchase")
    
    # Calculate total cost
    total_amount_kobo = sum(r.amount_naira * 100 for r in recipients)
    
    # Check user balance
    user_row = (
        await db.execute(
            select(User).where(User.id == current_user.id).with_for_update()
        )
    ).scalar_one_or_none()
    if user_row is None:
        raise HTTPException(status_code=404, detail="User not found")
    
    if settings.wallet_split_enabled:
        if user_row.cashable_balance < kobo_to_points(total_amount_kobo):
            raise HTTPException(status_code=402, detail="Insufficient balance for bulk purchase")
    else:
        if user_row.points_balance < kobo_to_points(total_amount_kobo):
            raise HTTPException(status_code=402, detail="Insufficient balance for bulk purchase")
    
    if settings.wallet_split_enabled:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(cashable_balance=User.cashable_balance - kobo_to_points(total_amount_kobo))
        )
    else:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(points_balance=User.points_balance - kobo_to_points(total_amount_kobo))
        )
    
    # Process purchases in parallel
    results = []
    total_points_earned = 0
    successful_count = 0
    failed_count = 0
    
    async def process_one(recipient: BulkAirtimeRecipient) -> BulkPurchaseResult:
        """Process one recipient's airtime purchase."""
        reference = _generate_reference()
        amount_kobo = recipient.amount_naira * 100
        
        try:
            # Call VTU provider
            result = await _get_vtu_client().buy_airtime(
                network=recipient.network,
                mobile_number=recipient.phone,
                amount=recipient.amount_naira,
            )
            
            if result.status != "success":
                return BulkPurchaseResult(
                    phone=recipient.phone,
                    network=recipient.network,
                    amount_naira=recipient.amount_naira,
                    status="failed",
                    error_message=result.message,
                )
            
            # Calculate commission and points
            commission_kobo = _effective_commission_kobo(
                amount_kobo=amount_kobo,
                service="airtime",
                discount=result.discount,
            )
            
            # Get full user object for multiplier
            user_result = await db.execute(select(User).where(User.id == current_user.id))
            full_user = user_result.scalar_one()
            points = _compute_points(commission_kobo, full_user)
            
            # Record transaction
            tx = BillTransaction(
                user_id=current_user.id,
                service="airtime",
                provider=settings.bills_provider,
                phone=recipient.phone,
                amount_naira=recipient.amount_naira,
                commission_naira=commission_kobo,
                points_earned=points,
                reference=reference,
                status="success",
                external_ref=result.reference,
            )
            db.add(tx)
            
            return BulkPurchaseResult(
                phone=recipient.phone,
                network=recipient.network,
                amount_naira=recipient.amount_naira,
                status="success",
                reference=reference,
                points_earned=points,
            )
            
        except (PeyflexError, BigisubError) as exc:
            logger.error("Bulk airtime purchase failed for %s: %s", recipient.phone, exc)
            return BulkPurchaseResult(
                phone=recipient.phone,
                network=recipient.network,
                amount_naira=recipient.amount_naira,
                status="failed",
                error_message=str(exc),
            )
    
    # Execute all purchases in parallel
    results = await asyncio.gather(*[process_one(r) for r in recipients])
    
    # Sum up results
    for result in results:
        if result.status == "success":
            successful_count += 1
            total_points_earned += result.points_earned
        else:
            failed_count += 1
    
    # Refund failed purchases and credit earned points
    failed_refund_kobo = sum(
        r.amount_naira * 100 for r in results if r.status == "failed"
    )
    
    if settings.wallet_split_enabled:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(
                cashable_balance=User.cashable_balance + kobo_to_points(failed_refund_kobo) + total_points_earned
            )
        )
    else:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(
                points_balance=User.points_balance + kobo_to_points(failed_refund_kobo) + total_points_earned
            )
        )
    
    # Get new balance
    user_result = await db.execute(select(User).where(User.id == current_user.id))
    updated_user = user_result.scalar_one()
    new_balance = updated_user.points_balance
    
    await db.commit()
    
    # Send notification
    from app.services.notifications import create_notification_background
    from app.services.fcm import send_push_notification_background
    
    asyncio.create_task(create_notification_background(
        user_id=current_user.id,
        title="Bulk Airtime Purchase Complete",
        body=f"Processed {len(recipients)} purchases: {successful_count} successful, {failed_count} failed. Earned {total_points_earned} points.",
        category="wallet_updates",
        data={"type": "bulk_airtime", "successful": str(successful_count), "failed": str(failed_count)},
    ))
    asyncio.create_task(send_push_notification_background(
        user_id=current_user.id,
        title="Bulk Airtime Purchase Complete",
        body=f"Processed {len(recipients)} purchases: {successful_count} successful, {failed_count} failed.",
        data={"type": "bulk_airtime", "successful": str(successful_count), "failed": str(failed_count)},
        category="wallet_updates",
    ))
    
    return BulkAirtimePurchaseResponse(
        total_requested=len(recipients),
        successful=successful_count,
        failed=failed_count,
        total_amount=sum(r.amount_naira for r in recipients),
        total_points_earned=total_points_earned,
        new_balance=new_balance,
        results=results,
    )


# ── Data ──────────────────────────────────────────────────────────────

@router.get("/data/networks")
async def list_data_networks():
    """List data networks available on VTU provider."""
    logger.info("Fetching data networks from VTU provider: %s", settings.bills_provider)
    nets = await _get_vtu_public_client().get_data_networks()
    result = [{"identifier": n.identifier, "name": n.name} for n in nets]
    logger.info("Data networks response: %s", result)
    return result


@router.get("/data/plans")
async def list_data_plans(network: str = "1"):
    """List data plans for a specific network."""
    logger.info("Fetching data plans for network=%s provider=%s", network, settings.bills_provider)
    try:
        plans = await _get_vtu_public_client().get_data_plans(network)
    except (PeyflexError, BigisubError) as exc:
        logger.error("Failed to fetch data plans: %s", exc)
        raise HTTPException(status_code=502, detail="Payment provider unavailable. Please try again later.")
    result = [
        {
            "plan_code": p.plan_code,
            "amount": p.amount,
            "label": getattr(p, "label", p.plan_code),
            "plantype": getattr(p, "plantype", ""),
        }
        for p in plans
    ]
    logger.info("Data plans response: count=%d network=%s", len(result), network)
    return result


@router.post("/data", response_model=BillsPurchaseResponse)
async def buy_data(
    payload: DataPurchaseRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BillsPurchaseResponse:
    """Buy data bundle and earn points."""
    # Enforce rate limits (10/hour, 50/day)
    await enforce_rate_limits(current_user.id, "data")
    
    reference = _generate_reference()

    # Fetch plan price to know how much to charge
    try:
        plans = await _get_vtu_public_client().get_data_plans(payload.network)
    except (PeyflexError, BigisubError) as exc:
        logger.error("Failed to fetch plans for pricing: %s", exc)
        raise HTTPException(status_code=502, detail="Failed to get plan pricing")

    plan = next((p for p in plans if p.plan_code == payload.plan_code), None)
    if not plan:
        raise HTTPException(status_code=400, detail=f"Unknown plan: {payload.plan_code}")

    price_naira = plan.amount
    amount_kobo = price_naira * 100

    user_row = (
        await db.execute(
            select(User).where(User.id == current_user.id).with_for_update()
        )
    ).scalar_one_or_none()
    if user_row is None:
        raise HTTPException(status_code=404, detail="User not found")

    # SV Discount eligibility check (Phase 4)
    actual_sv_discount = 0
    if payload.apply_sv_discount > 0:
        from app.services.discount import check_discount_eligibility, SvShortfallError
        try:
            actual_sv_discount = await check_discount_eligibility(
                user=user_row,
                product_type="data",
                price_kobo=amount_kobo,
                sv_requested=payload.apply_sv_discount,
                db=db,
            )
        except SvShortfallError as e:
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "insufficient_sv",
                    "shortfall_sv": e.shortfall_sv,
                    "ads_needed": e.ads_needed,
                    "ads_remaining": e.ads_remaining,
                    "user_balance": e.user_balance,
                    "requested_sv": e.requested_sv,
                    "earn_route": "watch_ads",
                },
            )

    # Calculate cash payment after SV discount
    sv_discount_kobo = actual_sv_discount * 10  # 1 sv = ₦0.10
    cash_payment_kobo = amount_kobo - sv_discount_kobo

    if settings.wallet_split_enabled:
        if user_row.cashable_balance < kobo_to_points(cash_payment_kobo):
            raise HTTPException(status_code=402, detail="Insufficient cashable balance")
        if actual_sv_discount > 0 and user_row.service_credit_balance < actual_sv_discount:
            raise HTTPException(status_code=402, detail="Insufficient service credits")
    else:
        if user_row.points_balance < kobo_to_points(amount_kobo):
            raise HTTPException(status_code=402, detail="Insufficient balance")

    # Debit cashable for cash portion and service credits for discount
    if settings.wallet_split_enabled:
        # Debit cashable balance for cash payment
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(cashable_balance=User.cashable_balance - kobo_to_points(cash_payment_kobo))
        )
        # Debit service credits if discount applied
        if actual_sv_discount > 0:
            await db.execute(
                update(User)
                .where(User.id == current_user.id)
                .values(service_credit_balance=User.service_credit_balance - actual_sv_discount)
            )
    else:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(points_balance=User.points_balance - kobo_to_points(amount_kobo))
        )

    try:
        result = await _get_vtu_client().buy_data(
            network=payload.network,
            mobile_number=payload.phone,
            plan_code=payload.plan_code,
        )
    except (PeyflexError, BigisubError) as exc:
        await db.rollback()
        raise _vtu_error(exc)

    if result.status != "success":
        await db.rollback()
        raise HTTPException(status_code=502, detail=f"Purchase failed: {result.message}")

    commission_kobo = _effective_commission_kobo(
        amount_kobo=amount_kobo,
        service="data",
        discount=result.discount,
    )

    # Get full user object for multiplier calculation (Phase 2)
    user_result = await db.execute(select(User).where(User.id == current_user.id))
    full_user = user_result.scalar_one()
    points = _compute_points(commission_kobo, full_user)
    
    logger.info(
        "Bills cashback: user=%d tier=%s service=data commission=%d points=%d sv_discount=%d",
        current_user.id, full_user.tier.value, commission_kobo, points, actual_sv_discount
    )

    tx = BillTransaction(
        user_id=current_user.id,
        service="data",
        provider=settings.bills_provider,
        phone=payload.phone,
        amount_naira=price_naira,
        commission_naira=commission_kobo,
        points_earned=points,
        reference=reference,
        status="success",
        external_ref=result.reference,
        details={
            "network": result.network,
            "network_name": payload.network.upper(),
            "plan": result.plan,
            "plan_name": plan.label,
            "size": plan.size,
            "plan_volume": plan.plan_volume,
            "validity": plan.validity,
            "amount": str(result.amount),
            "charged": result.charged,
            "discount": result.discount,
            "mobile_number": result.mobile_number,
        },
    )
    db.add(tx)

    # Credit commission as service credits (not cashable)
    if settings.wallet_split_enabled:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(service_credit_balance=User.service_credit_balance + points)
        )
        # Get new balances for response
        user_result = await db.execute(select(User).where(User.id == current_user.id))
        updated_user = user_result.scalar_one()
        new_cashable = updated_user.cashable_balance
        new_service_credit = updated_user.service_credit_balance
    else:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(points_balance=User.points_balance + points)
        )
        user_result = await db.execute(select(User).where(User.id == current_user.id))
        updated_user = user_result.scalar_one()
        new_cashable = updated_user.points_balance
        new_service_credit = 0
    
    await db.commit()

    from app.services.notifications import create_notification_background
    from app.services.fcm import send_push_notification_background

    asyncio.create_task(create_notification_background(
        user_id=current_user.id,
        title="Data Purchase Successful",
        body=f"You bought data for {payload.phone} and earned {points} points.",
        category="wallet_updates",
        data={"type": "wallet_update", "service": "data", "points": str(points)},
    ))
    asyncio.create_task(send_push_notification_background(
        user_id=current_user.id,
        title="Data Purchase Successful",
        body=f"You bought data for {payload.phone} and earned {points} points.",
        data={"type": "wallet_update", "service": "data", "points": str(points)},
        category="wallet_updates",
    ))

    # Build payment breakdown for response
    payment_breakdown = None
    if actual_sv_discount > 0:
        payment_breakdown = {
            "cashable_paid_kobo": cash_payment_kobo,
            "sv_discount_kobo": sv_discount_kobo,
            "sv_discount_pts": actual_sv_discount,
            "commission_earned_sv": points,
        }

    return BillsPurchaseResponse(
        reference=reference,
        commission_naira=commission_kobo,
        points_earned=points,
        new_balance=new_cashable if not settings.wallet_split_enabled else new_cashable + new_service_credit,
        status="success",
        phone=payload.phone,
        customer_name=result.plan,
        payment_breakdown=payment_breakdown,
        new_service_credit_balance=new_service_credit if settings.wallet_split_enabled else None,
        new_cashable_balance=new_cashable if settings.wallet_split_enabled else None,
    )


# ── Electricity ─────────────────────────────────────────────────────

@router.get("/electricity/plans")
async def list_electricity_plans():
    """List electricity DISCOs available on VTU provider."""
    return await _get_vtu_public_client().get_electricity_plans()


@router.post("/electricity")
async def buy_electricity(
    payload: ElectricityPurchaseRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Buy electricity tokens and earn points."""
    # Enforce rate limits (5/hour, 20/day)
    await enforce_rate_limits(current_user.id, "electricity")
    
    reference = _generate_reference()
    amount_kobo = payload.amount_naira * 100

    user_row = (
        await db.execute(
            select(User).where(User.id == current_user.id).with_for_update()
        )
    ).scalar_one_or_none()
    if user_row is None:
        raise HTTPException(status_code=404, detail="User not found")

    # SV Discount eligibility check (Phase 4)
    actual_sv_discount = 0
    if payload.apply_sv_discount > 0:
        from app.services.discount import check_discount_eligibility, SvShortfallError
        try:
            actual_sv_discount = await check_discount_eligibility(
                user=user_row,
                product_type="electricity",
                price_kobo=amount_kobo,
                sv_requested=payload.apply_sv_discount,
                db=db,
            )
        except SvShortfallError as e:
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "insufficient_sv",
                    "shortfall_sv": e.shortfall_sv,
                    "ads_needed": e.ads_needed,
                    "ads_remaining": e.ads_remaining,
                    "user_balance": e.user_balance,
                    "requested_sv": e.requested_sv,
                    "earn_route": "watch_ads",
                },
            )

    # Calculate cash payment after SV discount
    sv_discount_kobo = actual_sv_discount * 10  # 1 sv = ₦0.10
    cash_payment_kobo = amount_kobo - sv_discount_kobo

    if settings.wallet_split_enabled:
        if user_row.cashable_balance < kobo_to_points(cash_payment_kobo):
            raise HTTPException(status_code=402, detail="Insufficient cashable balance")
        if actual_sv_discount > 0 and user_row.service_credit_balance < actual_sv_discount:
            raise HTTPException(status_code=402, detail="Insufficient service credits")
    else:
        if user_row.points_balance < kobo_to_points(amount_kobo):
            raise HTTPException(status_code=402, detail="Insufficient balance")

    # Debit cashable for cash portion and service credits for discount
    if settings.wallet_split_enabled:
        # Debit cashable balance for cash payment
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(cashable_balance=User.cashable_balance - kobo_to_points(cash_payment_kobo))
        )
        # Debit service credits if discount applied
        if actual_sv_discount > 0:
            await db.execute(
                update(User)
                .where(User.id == current_user.id)
                .values(service_credit_balance=User.service_credit_balance - actual_sv_discount)
            )
    else:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(points_balance=User.points_balance - kobo_to_points(amount_kobo))
        )

    try:
        result = await _get_vtu_client().buy_electricity(
            plan=payload.plan_id,
            meter=payload.meter_number,
            amount=payload.amount_naira,
            meter_type=payload.meter_type,
            phone=payload.phone,
        )
    except (PeyflexError, BigisubError) as exc:
        await db.rollback()
        raise _vtu_error(exc)

    # Peyflex uses "SUCCESS", Bigisub uses success=true
    is_success = result.get("status") == "SUCCESS" or result.get("success") is True
    if not is_success:
        await db.rollback()
        raise HTTPException(status_code=502, detail=f"Purchase failed: {result.get('message', 'Unknown')}")

    # Extract real commission from provider's response.
    discount = result.get("discount") if isinstance(result, dict) else getattr(result, "discount", None)
    charged = result.get("charged") if isinstance(result, dict) else getattr(result, "charged", None)
    commission_kobo = _effective_commission_kobo(
        amount_kobo=amount_kobo,
        service="electricity",
        discount=discount,
        charged=float(charged) if charged else None,
        price_naira=payload.amount_naira,
    )

    # Get full user object for multiplier calculation (Phase 2)
    user_result = await db.execute(select(User).where(User.id == current_user.id))
    full_user = user_result.scalar_one()
    points = _compute_points(commission_kobo, full_user)
    
    logger.info(
        "Bills cashback: user=%d tier=%s service=electricity commission=%d points=%d sv_discount=%d",
        current_user.id, full_user.tier.value, commission_kobo, points, actual_sv_discount
    )

    # Extract customer_name from verify result if available
    customer_name = result.get("customer_name", "")
    if not customer_name and isinstance(result, dict):
        # Try to get it from the verify step that was done in buy_electricity
        verify_result = await _get_vtu_client().verify_meter(
            disco_code=payload.plan_id,
            meter_number=payload.meter_number,
            meter_type=payload.meter_type,
        )
        customer_name = verify_result.get("customer_name", "")
    
    # Get disco name from plan_id
    disco_name = payload.plan_id.replace("-", " ").title()
    
    tx = BillTransaction(
        user_id=current_user.id,
        service="electricity",
        provider=settings.bills_provider,
        meter_number=payload.meter_number,
        amount_naira=payload.amount_naira,
        commission_naira=commission_kobo,
        points_earned=points,
        reference=reference,
        status="success",
        external_ref=result.get("reference", result.get("transaction_id", "")),
        details={
            "disco": payload.plan_id,
            "disco_name": disco_name,
            "meter_number": payload.meter_number,
            "meter_type": payload.meter_type,
            "customer_name": customer_name,
            "phone": payload.phone,
            "amount": str(payload.amount_naira),
            "charged": str(charged) if charged else None,
            "discount": str(discount) if discount else None,
            "token": result.get("token", result.get("units", "")),
            "units": result.get("units", ""),
        },
    )
    db.add(tx)

    # Credit commission as service credits (not cashable)
    if settings.wallet_split_enabled:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(service_credit_balance=User.service_credit_balance + points)
        )
        # Get new balances for response
        user_result = await db.execute(select(User).where(User.id == current_user.id))
        updated_user = user_result.scalar_one()
        new_cashable = updated_user.cashable_balance
        new_sv = updated_user.service_credit_balance
    else:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(points_balance=User.points_balance + points)
        )
        new_cashable = None
        new_sv = None
    await db.commit()

    from app.services.notifications import create_notification_background
    from app.services.fcm import send_push_notification_background

    asyncio.create_task(create_notification_background(
        user_id=current_user.id,
        title="Electricity Purchase Successful",
        body=f"You bought electricity for meter {payload.meter_number} and earned {points} points.",
        category="wallet_updates",
        data={"type": "wallet_update", "service": "electricity", "points": str(points)},
    ))
    asyncio.create_task(send_push_notification_background(
        user_id=current_user.id,
        title="Electricity Purchase Successful",
        body=f"You bought electricity for meter {payload.meter_number} and earned {points} points.",
        data={"type": "wallet_update", "service": "electricity", "points": str(points)},
        category="wallet_updates",
    ))

    # Build payment breakdown for response (Phase 4)
    payment_breakdown = None
    if actual_sv_discount > 0:
        payment_breakdown = {
            "cashable_paid_kobo": cash_payment_kobo,
            "sv_discount_kobo": sv_discount_kobo,
            "sv_discount_pts": actual_sv_discount,
            "commission_earned_sv": points,
        }

    balance_for_calc = user_row.cashable_balance if settings.wallet_split_enabled else user_row.points_balance
    new_balance = balance_for_calc - kobo_to_points(cash_payment_kobo if actual_sv_discount > 0 else amount_kobo) + points

    return {
        "reference": reference,
        "commission_naira": commission_kobo,
        "points_earned": points,
        "new_balance": new_balance,
        "status": "success",
        "meter_number": payload.meter_number,
        "token": result.get("token", ""),
        "units": result.get("units", ""),
        "customer_name": result.get("customer_name", ""),
        "payment_breakdown": payment_breakdown,
        "new_service_credit_balance": new_sv if actual_sv_discount > 0 else None,
        "new_cashable_balance": new_cashable if actual_sv_discount > 0 else None,
    }


# ── Cable TV ────────────────────────────────────────────────────────

@router.get("/tv/providers")
async def list_tv_providers():
    """List cable TV providers available on VTU provider."""
    return await _get_vtu_public_client().get_cable_providers()


@router.get("/tv/plans")
async def list_tv_plans(provider: str = "dstv"):
    """List cable TV plans for a provider."""
    return await _get_vtu_public_client().get_cable_plans(provider)


@router.post("/tv")
async def buy_tv(
    payload: TelevisionPurchaseRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Subscribe cable TV and earn points."""
    # Enforce rate limits (5/hour, 20/day)
    await enforce_rate_limits(current_user.id, "tv")
    
    reference = _generate_reference()

    # Fetch plan price
    try:
        plans = await _get_vtu_public_client().get_cable_plans(payload.provider)
    except (PeyflexError, BigisubError) as exc:
        logger.error("Failed to fetch TV plans for pricing: %s", exc)
        raise HTTPException(status_code=502, detail="Failed to get plan pricing")

    plan = next((p for p in plans if p.get("plan_code") == payload.plan_code), None)
    if not plan:
        raise HTTPException(status_code=400, detail=f"Unknown plan: {payload.plan_code}")

    price_naira = int(float(plan["amount"]))
    amount_kobo = price_naira * 100

    user_row = (
        await db.execute(
            select(User).where(User.id == current_user.id).with_for_update()
        )
    ).scalar_one_or_none()
    if user_row is None:
        raise HTTPException(status_code=404, detail="User not found")

    # SV Discount eligibility check (Phase 4)
    actual_sv_discount = 0
    if payload.apply_sv_discount > 0:
        from app.services.discount import check_discount_eligibility, SvShortfallError
        try:
            actual_sv_discount = await check_discount_eligibility(
                user=user_row,
                product_type="tv",
                price_kobo=amount_kobo,
                sv_requested=payload.apply_sv_discount,
                db=db,
            )
        except SvShortfallError as e:
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "insufficient_sv",
                    "shortfall_sv": e.shortfall_sv,
                    "ads_needed": e.ads_needed,
                    "ads_remaining": e.ads_remaining,
                    "user_balance": e.user_balance,
                    "requested_sv": e.requested_sv,
                    "earn_route": "watch_ads",
                },
            )

    # Calculate cash payment after SV discount
    sv_discount_kobo = actual_sv_discount * 10  # 1 sv = ₦0.10
    cash_payment_kobo = amount_kobo - sv_discount_kobo

    if settings.wallet_split_enabled:
        if user_row.cashable_balance < kobo_to_points(cash_payment_kobo):
            raise HTTPException(status_code=402, detail="Insufficient cashable balance")
        if actual_sv_discount > 0 and user_row.service_credit_balance < actual_sv_discount:
            raise HTTPException(status_code=402, detail="Insufficient service credits")
    else:
        if user_row.points_balance < kobo_to_points(amount_kobo):
            raise HTTPException(status_code=402, detail="Insufficient balance")

    # Debit cashable for cash portion and service credits for discount
    if settings.wallet_split_enabled:
        # Debit cashable balance for cash payment
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(cashable_balance=User.cashable_balance - kobo_to_points(cash_payment_kobo))
        )
        # Debit service credits if discount applied
        if actual_sv_discount > 0:
            await db.execute(
                update(User)
                .where(User.id == current_user.id)
                .values(service_credit_balance=User.service_credit_balance - actual_sv_discount)
            )
    else:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(points_balance=User.points_balance - kobo_to_points(amount_kobo))
        )

    try:
        result = await _get_vtu_client().buy_cable(
            identifier=payload.provider,
            plan=payload.plan_code,
            iuc=payload.smartcard_number,
            phone=payload.phone,
            amount=price_naira,
        )
    except (PeyflexError, BigisubError) as exc:
        await db.rollback()
        raise _vtu_error(exc)

    # Peyflex uses "SUCCESS", Bigisub uses success=true
    is_success = result.get("status") == "SUCCESS" or result.get("success") is True
    if not is_success:
        await db.rollback()
        raise HTTPException(status_code=502, detail=f"Purchase failed: {result.get('message', 'Unknown')}")

    # Extract real commission from provider's response.
    discount = result.get("discount") if isinstance(result, dict) else getattr(result, "discount", None)
    charged = result.get("charged") if isinstance(result, dict) else getattr(result, "charged", None)
    commission_kobo = _effective_commission_kobo(
        amount_kobo=amount_kobo,
        service="tv",
        discount=discount,
        charged=float(charged) if charged else None,
        price_naira=price_naira,
    )

    # Get full user object for multiplier calculation (Phase 2)
    user_result = await db.execute(select(User).where(User.id == current_user.id))
    full_user = user_result.scalar_one()
    points = _compute_points(commission_kobo, full_user)
    
    logger.info(
        "Bills cashback: user=%d tier=%s service=tv commission=%d points=%d sv_discount=%d",
        current_user.id, full_user.tier.value, commission_kobo, points, actual_sv_discount
    )

    tx = BillTransaction(
        user_id=current_user.id,
        service="tv",
        provider=settings.bills_provider,
        smartcard_number=payload.smartcard_number,
        amount_naira=price_naira,
        commission_naira=commission_kobo,
        points_earned=points,
        reference=reference,
        status="success",
        external_ref=result.get("reference", result.get("transaction_id", "")),
    )
    db.add(tx)

    # Credit commission as service credits (not cashable)
    if settings.wallet_split_enabled:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(service_credit_balance=User.service_credit_balance + points)
        )
        # Get new balances for response
        user_result = await db.execute(select(User).where(User.id == current_user.id))
        updated_user = user_result.scalar_one()
        new_cashable = updated_user.cashable_balance
        new_sv = updated_user.service_credit_balance
    else:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(points_balance=User.points_balance + points)
        )
        new_cashable = None
        new_sv = None
    await db.commit()

    from app.services.notifications import create_notification_background
    from app.services.fcm import send_push_notification_background

    asyncio.create_task(create_notification_background(
        user_id=current_user.id,
        title="Cable TV Subscription Successful",
        body=f"You subscribed to {payload.provider} for smartcard {payload.smartcard_number} and earned {points} points.",
        category="wallet_updates",
        data={"type": "wallet_update", "service": "tv", "points": str(points)},
    ))
    asyncio.create_task(send_push_notification_background(
        user_id=current_user.id,
        title="Cable TV Subscription Successful",
        body=f"You subscribed to {payload.provider} for smartcard {payload.smartcard_number} and earned {points} points.",
        data={"type": "wallet_update", "service": "tv", "points": str(points)},
        category="wallet_updates",
    ))

    # Build payment breakdown for response (Phase 4)
    payment_breakdown = None
    if actual_sv_discount > 0:
        payment_breakdown = {
            "cashable_paid_kobo": cash_payment_kobo,
            "sv_discount_kobo": sv_discount_kobo,
            "sv_discount_pts": actual_sv_discount,
            "commission_earned_sv": points,
        }

    balance_for_calc = user_row.cashable_balance if settings.wallet_split_enabled else user_row.points_balance
    new_balance = balance_for_calc - kobo_to_points(cash_payment_kobo if actual_sv_discount > 0 else amount_kobo) + points

    return {
        "reference": reference,
        "commission_naira": commission_kobo,
        "points_earned": points,
        "new_balance": new_balance,
        "status": "success",
        "smartcard_number": payload.smartcard_number,
        "customer_name": result.get("customer_name", ""),
        "payment_breakdown": payment_breakdown,
        "new_service_credit_balance": new_sv if actual_sv_discount > 0 else None,
        "new_cashable_balance": new_cashable if actual_sv_discount > 0 else None,
    }


# ── Validation & Detection Endpoints ────────────────────────────────

# Nigerian phone prefixes by network (updated 2024)
NETWORK_PREFIXES = {
    "mtn": ["0803", "0806", "0810", "0813", "0814", "0816", "0903", "0906", "0913", "07025", "07026"],
    "airtel": ["0802", "0808", "0812", "0901", "0902", "0907", "0912", "0701", "0708"],
    "glo": ["0805", "0807", "0811", "0815", "0905", "0915", "0705"],
    "9mobile": ["0809", "0817", "0818", "0908", "0909"],
}

NETWORK_NAME_TO_ID = {
    "mtn": 1,
    "glo": 2,
    "airtel": 3,
    "9mobile": 4,
}


@router.post("/detect-network")
async def detect_network(payload: dict):
    """Detect network provider from Nigerian phone number.
    
    Uses local prefix matching (instant, no API call needed).
    Returns network identifier for use in airtime/data purchase.
    """
    phone = payload.get("phone", "").strip()
    
    # Normalize: remove spaces, hyphens
    phone_clean = phone.replace(" ", "").replace("-", "")
    
    if len(phone_clean) != 11 or not phone_clean.startswith("0"):
        raise HTTPException(status_code=400, detail="Invalid Nigerian phone number format")
    
    # Check prefixes
    prefix_4 = phone_clean[:4]  # e.g., "0803"
    prefix_5 = phone_clean[:5]  # e.g., "07025"
    
    for network, prefixes in NETWORK_PREFIXES.items():
        if prefix_4 in prefixes or prefix_5 in prefixes:
            network_id = NETWORK_NAME_TO_ID.get(network)
            return {
                "phone": phone_clean,
                "network": network_id,
                "network_name": network.upper(),
                "validated": True,
            }
    
    # Unknown network - could be new prefix or invalid
    return {
        "phone": phone_clean,
        "network": None,
        "network_name": "Unknown",
        "validated": False,
        "message": "Could not detect network from phone number",
    }


@router.post("/validate-meter")
async def validate_meter(payload: dict, current_user: User = Depends(get_current_user)):
    """Validate electricity meter number via Bigisub.
    
    Calls Bigisub's bills/electricity/verify/ endpoint with correct field names:
    - company: DISCO code (e.g. ikeja-electric)
    - meter_no: meter number
    - meter_type: prepaid or postpaid
    
    Returns customer_name and address on success.
    """
    meter_number = payload.get("meter_number", "").strip()
    disco_code = payload.get("plan_id", "ikeja-electric")
    meter_type = payload.get("meter_type", "prepaid")
    
    if len(meter_number) < 10:
        raise HTTPException(status_code=400, detail="Meter number must be at least 10 digits")
    
    try:
        result = await _get_vtu_client().verify_meter(
            disco_code=disco_code,
            meter_number=meter_number,
            meter_type=meter_type,
        )
        customer_name = result.get("customer_name")
        if customer_name:
            return {
                "meter_number": meter_number,
                "customer_name": customer_name,
                "address": result.get("customer_address"),
                "validated": True,
                "message": "Meter verified successfully",
            }
        return {
            "meter_number": meter_number,
            "customer_name": None,
            "address": None,
            "validated": False,
            "message": result.get("message", "Could not verify meter - check number and try again"),
        }
    except (PeyflexError, BigisubError) as exc:
        logger.error("Meter validation failed: %s", exc)
        return {
            "meter_number": meter_number,
            "customer_name": None,
            "address": None,
            "validated": False,
            "message": "Validation temporarily unavailable - proceed with purchase",
        }


@router.post("/validate-smartcard")
async def validate_smartcard(payload: dict, current_user: User = Depends(get_current_user)):
    """Validate TV smartcard/IUC number via Bigisub.
    
    Calls Bigisub's vtu/cable/verify/ endpoint with correct field names:
    - card_no: smartcard/IUC number
    - cable_name: provider (e.g. dstv, gotv)
    
    Returns customer_name on success.
    """
    smartcard = payload.get("smartcard_number", "").strip()
    provider = payload.get("provider", "dstv")
    
    if len(smartcard) < 10:
        raise HTTPException(status_code=400, detail="Smartcard number must be at least 10 digits")
    
    try:
        result = await _get_vtu_client().verify_cable(
            iuc=smartcard,
            cable_name=provider,
        )
        customer_name = result.get("customer_name")
        if customer_name:
            return {
                "smartcard_number": smartcard,
                "customer_name": customer_name,
                "account_status": result.get("account_status", "Active"),
                "validated": True,
                "message": "Smartcard verified successfully",
            }
        return {
            "smartcard_number": smartcard,
            "customer_name": None,
            "account_status": None,
            "validated": False,
            "message": result.get("message", "Could not verify smartcard - check number and try again"),
        }
    except (PeyflexError, BigisubError) as exc:
        logger.error("Smartcard validation failed: %s", exc)
        return {
            "smartcard_number": smartcard,
            "customer_name": None,
            "account_status": None,
            "validated": False,
            "message": "Validation temporarily unavailable - proceed with purchase",
        }


# ── Recharge Pin ────────────────────────────────────────────────────

@router.get("/recharge-pin/plans")
async def list_recharge_pin_plans(network: str | None = None):
    """List recharge pin denominations."""
    plans = await _get_vtu_public_client().get_recharge_pin_plans(network)
    return plans


@router.post("/recharge-pin")
async def buy_recharge_pin(
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Buy recharge pins."""
    reference = _generate_reference()
    network = payload.get("network", "mtn")
    size = payload.get("size")
    quantity = int(payload.get("quantity", 1))

    if not size:
        raise HTTPException(status_code=400, detail="size is required")

    try:
        plans = await _get_vtu_public_client().get_recharge_pin_plans(network)
    except (PeyflexError, BigisubError) as exc:
        raise _vtu_error(exc)

    plan = next((p for p in plans if p["size"] == size), None)
    if not plan:
        raise HTTPException(status_code=400, detail=f"Unknown pin size: {size}")

    price_naira = plan["regular_price"]
    amount_kobo = int(price_naira * 100) * quantity

    user_row = (
        await db.execute(
            select(User).where(User.id == current_user.id).with_for_update()
        )
    ).scalar_one_or_none()
    if user_row is None:
        raise HTTPException(status_code=404, detail="User not found")

    # SV Discount eligibility check (Phase 4)
    actual_sv_discount = 0
    apply_sv_discount = payload.get("apply_sv_discount", 0)
    if apply_sv_discount > 0:
        from app.services.discount import check_discount_eligibility, SvShortfallError
        try:
            actual_sv_discount = await check_discount_eligibility(
                user=user_row,
                product_type="recharge_pin",
                price_kobo=amount_kobo,
                sv_requested=apply_sv_discount,
                db=db,
            )
        except SvShortfallError as e:
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "insufficient_sv",
                    "shortfall_sv": e.shortfall_sv,
                    "ads_needed": e.ads_needed,
                    "ads_remaining": e.ads_remaining,
                    "user_balance": e.user_balance,
                    "requested_sv": e.requested_sv,
                    "earn_route": "watch_ads",
                },
            )

    # Calculate cash payment after SV discount
    sv_discount_kobo = actual_sv_discount * 10
    cash_payment_kobo = amount_kobo - sv_discount_kobo

    if settings.wallet_split_enabled:
        if user_row.cashable_balance < kobo_to_points(cash_payment_kobo):
            raise HTTPException(status_code=402, detail="Insufficient cashable balance")
        if actual_sv_discount > 0 and user_row.service_credit_balance < actual_sv_discount:
            raise HTTPException(status_code=402, detail="Insufficient service credits")
    else:
        if user_row.points_balance < kobo_to_points(amount_kobo):
            raise HTTPException(status_code=402, detail="Insufficient balance")

    # Debit cashable for cash portion and service credits for discount
    if settings.wallet_split_enabled:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(cashable_balance=User.cashable_balance - kobo_to_points(cash_payment_kobo))
        )
        if actual_sv_discount > 0:
            await db.execute(
                update(User)
                .where(User.id == current_user.id)
                .values(service_credit_balance=User.service_credit_balance - actual_sv_discount)
            )
    else:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(points_balance=User.points_balance - kobo_to_points(amount_kobo))
        )

    try:
        result = await _get_vtu_client().buy_recharge_pin(
            network=network, size=size, quantity=quantity,
        )
    except (PeyflexError, BigisubError) as exc:
        await db.rollback()
        raise _vtu_error(exc)

    discount = result.get("discount") if isinstance(result, dict) else getattr(result, "discount", None)
    commission_kobo = _effective_commission_kobo(
        amount_kobo=amount_kobo,
        service="recharge_pin",
        discount=discount,
    )

    # Get full user object for multiplier calculation (Phase 2)
    user_result = await db.execute(select(User).where(User.id == current_user.id))
    full_user = user_result.scalar_one()
    points = _compute_points(commission_kobo, full_user)
    
    logger.info(
        "Bills cashback: user=%d tier=%s service=recharge_pin commission=%d points=%d sv_discount=%d",
        current_user.id, full_user.tier.value, commission_kobo, points, actual_sv_discount
    )

    tx = BillTransaction(
        user_id=current_user.id,
        service="recharge_pin",
        provider=settings.bills_provider,
        amount_naira=int(price_naira * quantity),
        commission_naira=commission_kobo,
        points_earned=points,
        reference=reference,
        status="success",
        external_ref=result.get("reference", result.get("transaction_id", "")),
    )
    db.add(tx)

    # Credit commission as service credits (not cashable)
    if settings.wallet_split_enabled:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(service_credit_balance=User.service_credit_balance + points)
        )
        user_result = await db.execute(select(User).where(User.id == current_user.id))
        updated_user = user_result.scalar_one()
        new_cashable = updated_user.cashable_balance
        new_sv = updated_user.service_credit_balance
    else:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(points_balance=User.points_balance + points)
        )
        new_cashable = None
        new_sv = None
    await db.commit()

    from app.services.notifications import create_notification_background
    from app.services.fcm import send_push_notification_background

    asyncio.create_task(create_notification_background(
        user_id=current_user.id,
        title="Recharge Pin Purchase Successful",
        body=f"You bought {quantity}x {size} recharge pin(s) and earned {points} points.",
        category="wallet_updates",
        data={"type": "wallet_update", "service": "recharge_pin", "points": str(points)},
    ))
    asyncio.create_task(send_push_notification_background(
        user_id=current_user.id,
        title="Recharge Pin Purchase Successful",
        body=f"You bought {quantity}x {size} recharge pin(s) and earned {points} points.",
        data={"type": "wallet_update", "service": "recharge_pin", "points": str(points)},
        category="wallet_updates",
    ))

    # Build payment breakdown for response
    payment_breakdown = None
    if actual_sv_discount > 0:
        payment_breakdown = {
            "cashable_paid_kobo": cash_payment_kobo,
            "sv_discount_kobo": sv_discount_kobo,
            "sv_discount_pts": actual_sv_discount,
            "commission_earned_sv": points,
        }

    balance_for_calc = user_row.cashable_balance if settings.wallet_split_enabled else user_row.points_balance
    new_balance = balance_for_calc - kobo_to_points(cash_payment_kobo if actual_sv_discount > 0 else amount_kobo) + points

    return {
        "reference": reference,
        "commission_naira": commission_kobo,
        "points_earned": points,
        "new_balance": new_balance,
        "status": "success",
        "pins": result.get("pins", []),
        "payment_breakdown": payment_breakdown,
        "new_service_credit_balance": new_sv if actual_sv_discount > 0 else None,
        "new_cashable_balance": new_cashable if actual_sv_discount > 0 else None,
    }


# ── Betting ─────────────────────────────────────────────────────────

@router.get("/betting/billers")
async def list_betting_billers():
    """List supported betting platforms."""
    return await _get_vtu_public_client().get_betting_billers()


@router.get("/betting/products")
async def list_betting_products(biller_code: str):
    """List products for a betting platform."""
    return await _get_vtu_public_client().get_betting_products(biller_code)


@router.post("/betting/validate")
async def validate_betting_account(payload: dict):
    """Validate betting account number."""
    biller_code = payload.get("biller_code", "")
    account_number = payload.get("account_number", "")
    if not biller_code or not account_number:
        raise HTTPException(status_code=400, detail="biller_code and account_number are required")
    result = await _get_vtu_public_client().validate_betting_account(biller_code, account_number)
    return result


@router.post("/betting")
async def fund_betting(
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Fund betting wallet."""
    reference = _generate_reference()
    biller_code = payload.get("biller_code", "")
    account_number = payload.get("account_number", "")
    amount_naira = int(payload.get("amount_naira", 0))
    customer_name = payload.get("customer_name", "")

    if not biller_code or not account_number or amount_naira <= 0:
        raise HTTPException(status_code=400, detail="biller_code, account_number, and amount_naira are required")

    amount_kobo = amount_naira * 100

    user_row = (
        await db.execute(
            select(User).where(User.id == current_user.id).with_for_update()
        )
    ).scalar_one_or_none()
    if user_row is None:
        raise HTTPException(status_code=404, detail="User not found")

    # SV Discount eligibility check (Phase 4)
    actual_sv_discount = 0
    apply_sv_discount = payload.get("apply_sv_discount", 0)
    if apply_sv_discount > 0:
        from app.services.discount import check_discount_eligibility, SvShortfallError
        try:
            actual_sv_discount = await check_discount_eligibility(
                user=user_row,
                product_type="betting",
                price_kobo=amount_kobo,
                sv_requested=apply_sv_discount,
                db=db,
            )
        except SvShortfallError as e:
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "insufficient_sv",
                    "shortfall_sv": e.shortfall_sv,
                    "ads_needed": e.ads_needed,
                    "ads_remaining": e.ads_remaining,
                    "user_balance": e.user_balance,
                    "requested_sv": e.requested_sv,
                    "earn_route": "watch_ads",
                },
            )

    # Calculate cash payment after SV discount
    sv_discount_kobo = actual_sv_discount * 10
    cash_payment_kobo = amount_kobo - sv_discount_kobo

    if settings.wallet_split_enabled:
        if user_row.cashable_balance < kobo_to_points(cash_payment_kobo):
            raise HTTPException(status_code=402, detail="Insufficient cashable balance")
        if actual_sv_discount > 0 and user_row.service_credit_balance < actual_sv_discount:
            raise HTTPException(status_code=402, detail="Insufficient service credits")
    else:
        if user_row.points_balance < kobo_to_points(amount_kobo):
            raise HTTPException(status_code=402, detail="Insufficient balance")

    # Debit cashable for cash portion and service credits for discount
    if settings.wallet_split_enabled:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(cashable_balance=User.cashable_balance - kobo_to_points(cash_payment_kobo))
        )
        if actual_sv_discount > 0:
            await db.execute(
                update(User)
                .where(User.id == current_user.id)
                .values(service_credit_balance=User.service_credit_balance - actual_sv_discount)
            )
    else:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(points_balance=User.points_balance - kobo_to_points(amount_kobo))
        )

    try:
        result = await _get_vtu_client().fund_betting_wallet(
            biller_code=biller_code,
            account_number=account_number,
            amount=amount_naira,
            customer_name=customer_name,
        )
    except (PeyflexError, BigisubError) as exc:
        await db.rollback()
        raise _vtu_error(exc)

    commission_kobo = _effective_commission_kobo(
        amount_kobo=amount_kobo,
        service="betting",
    )
    
    # Get full user object for multiplier calculation (Phase 2)
    user_result = await db.execute(select(User).where(User.id == current_user.id))
    full_user = user_result.scalar_one()
    points = _compute_points(commission_kobo, full_user)
    
    logger.info(
        "Bills cashback: user=%d tier=%s service=betting commission=%d points=%d",
        current_user.id, full_user.tier.value, commission_kobo, points
    )

    tx = BillTransaction(
        user_id=current_user.id,
        service="betting",
        provider=settings.bills_provider,
        amount_naira=amount_naira,
        commission_naira=commission_kobo,
        points_earned=points,
        reference=reference,
        status="success",
        external_ref=result.get("transaction_id", result.get("reference", "")),
    )
    db.add(tx)

    balance_for_calc = user_row.cashable_balance if settings.wallet_split_enabled else user_row.points_balance
    new_balance = balance_for_calc - kobo_to_points(amount_kobo) + points
    if settings.wallet_split_enabled:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(cashable_balance=User.cashable_balance + points)
        )
    else:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(points_balance=User.points_balance + points)
        )
    await db.commit()

    from app.services.notifications import create_notification_background
    from app.services.fcm import send_push_notification_background

    asyncio.create_task(create_notification_background(
        user_id=current_user.id,
        title="Betting Wallet Funded",
        body=f"You funded your {biller_code} wallet with ₦{amount_naira} and earned {points} points.",
        category="wallet_updates",
        data={"type": "wallet_update", "service": "betting", "points": str(points)},
    ))
    asyncio.create_task(send_push_notification_background(
        user_id=current_user.id,
        title="Betting Wallet Funded",
        body=f"You funded your {biller_code} wallet with ₦{amount_naira} and earned {points} points.",
        data={"type": "wallet_update", "service": "betting", "points": str(points)},
        category="wallet_updates",
    ))

    return {
        "reference": reference,
        "commission_naira": commission_kobo,
        "points_earned": points,
        "new_balance": new_balance,
        "status": "success",
        "transaction_id": result.get("transaction_id", ""),
        "status_detail": result.get("status_detail", ""),
    }


# ── ISP ─────────────────────────────────────────────────────────────

@router.get("/isp/smile/plans")
async def list_smile_plans():
    """List Smile ISP plans."""
    return await _get_vtu_public_client().get_smile_plans()


@router.get("/isp/spectranet/plans")
async def list_spectranet_plans():
    """List Spectranet ISP plans."""
    return await _get_vtu_public_client().get_spectranet_plans()


@router.post("/isp/smile/verify")
async def verify_smile_account(payload: dict):
    """Verify Smile ISP account."""
    account_number = payload.get("account_number", "")
    if not account_number:
        raise HTTPException(status_code=400, detail="account_number is required")
    return await _get_vtu_public_client().verify_smile_account(account_number)


@router.post("/isp/smile/topup")
async def topup_smile(
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Top up Smile ISP account."""
    reference = _generate_reference()
    account_number = payload.get("account_number", "")
    plan_id = int(payload.get("plan_id", 0))

    if not account_number or not plan_id:
        raise HTTPException(status_code=400, detail="account_number and plan_id are required")

    try:
        plans = await _get_vtu_public_client().get_smile_plans()
    except (PeyflexError, BigisubError) as exc:
        raise _vtu_error(exc)

    plan = next((p for p in plans if p["id"] == plan_id), None)
    if not plan:
        raise HTTPException(status_code=400, detail=f"Unknown Smile plan: {plan_id}")

    price_naira = int(plan["plan_price"])
    amount_kobo = price_naira * 100

    user_row = (
        await db.execute(
            select(User).where(User.id == current_user.id).with_for_update()
        )
    ).scalar_one_or_none()
    if user_row is None:
        raise HTTPException(status_code=404, detail="User not found")

    if settings.wallet_split_enabled:
        if user_row.cashable_balance < kobo_to_points(amount_kobo):
            raise HTTPException(status_code=402, detail="Insufficient balance")
    else:
        if user_row.points_balance < kobo_to_points(amount_kobo):
            raise HTTPException(status_code=402, detail="Insufficient balance")

    if settings.wallet_split_enabled:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(cashable_balance=User.cashable_balance - kobo_to_points(amount_kobo))
        )
    else:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(points_balance=User.points_balance - kobo_to_points(amount_kobo))
        )

    try:
        result = await _get_vtu_client().topup_smile(account_number, plan_id)
    except (PeyflexError, BigisubError) as exc:
        await db.rollback()
        raise _vtu_error(exc)

    commission_kobo = _effective_commission_kobo(
        amount_kobo=amount_kobo,
        service="isp_smile",
    )
    
    # Get full user object for multiplier calculation (Phase 2)
    user_result = await db.execute(select(User).where(User.id == current_user.id))
    full_user = user_result.scalar_one()
    points = _compute_points(commission_kobo, full_user)
    
    logger.info(
        "Bills cashback: user=%d tier=%s service=isp_smile commission=%d points=%d",
        current_user.id, full_user.tier.value, commission_kobo, points
    )

    tx = BillTransaction(
        user_id=current_user.id,
        service="isp_smile",
        provider=settings.bills_provider,
        amount_naira=price_naira,
        commission_naira=commission_kobo,
        points_earned=points,
        reference=reference,
        status="success",
        external_ref=result.get("reference", result.get("transaction_id", "")),
    )
    db.add(tx)

    balance_for_calc = user_row.cashable_balance if settings.wallet_split_enabled else user_row.points_balance
    new_balance = balance_for_calc - kobo_to_points(amount_kobo) + points
    if settings.wallet_split_enabled:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(cashable_balance=User.cashable_balance + points)
        )
    else:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(points_balance=User.points_balance + points)
        )
    await db.commit()

    from app.services.notifications import create_notification_background
    from app.services.fcm import send_push_notification_background

    asyncio.create_task(create_notification_background(
        user_id=current_user.id,
        title="Smile ISP Top-up Successful",
        body=f"You topped up Smile account {account_number} and earned {points} points.",
        category="wallet_updates",
        data={"type": "wallet_update", "service": "isp_smile", "points": str(points)},
    ))
    asyncio.create_task(send_push_notification_background(
        user_id=current_user.id,
        title="Smile ISP Top-up Successful",
        body=f"You topped up Smile account {account_number} and earned {points} points.",
        data={"type": "wallet_update", "service": "isp_smile", "points": str(points)},
        category="wallet_updates",
    ))

    return {
        "reference": reference,
        "commission_naira": commission_kobo,
        "points_earned": points,
        "new_balance": new_balance,
        "status": "success",
    }


@router.post("/isp/spectranet/topup")
async def topup_spectranet(
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Top up Spectranet ISP account."""
    reference = _generate_reference()
    account_number = payload.get("account_number", "")
    plan_id = int(payload.get("plan_id", 0))

    if not account_number or not plan_id:
        raise HTTPException(status_code=400, detail="account_number and plan_id are required")

    try:
        plans = await _get_vtu_public_client().get_spectranet_plans()
    except (PeyflexError, BigisubError) as exc:
        raise _vtu_error(exc)

    plan = next((p for p in plans if p["id"] == plan_id), None)
    if not plan:
        raise HTTPException(status_code=400, detail=f"Unknown Spectranet plan: {plan_id}")

    price_naira = int(plan["plan_price"])
    amount_kobo = price_naira * 100

    user_row = (
        await db.execute(
            select(User).where(User.id == current_user.id).with_for_update()
        )
    ).scalar_one_or_none()
    if user_row is None:
        raise HTTPException(status_code=404, detail="User not found")

    if settings.wallet_split_enabled:
        if user_row.cashable_balance < kobo_to_points(amount_kobo):
            raise HTTPException(status_code=402, detail="Insufficient balance")
    else:
        if user_row.points_balance < kobo_to_points(amount_kobo):
            raise HTTPException(status_code=402, detail="Insufficient balance")

    if settings.wallet_split_enabled:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(cashable_balance=User.cashable_balance - kobo_to_points(amount_kobo))
        )
    else:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(points_balance=User.points_balance - kobo_to_points(amount_kobo))
        )

    try:
        result = await _get_vtu_client().topup_spectranet(account_number, plan_id)
    except (PeyflexError, BigisubError) as exc:
        await db.rollback()
        raise _vtu_error(exc)

    commission_kobo = _effective_commission_kobo(
        amount_kobo=amount_kobo,
        service="isp_spectranet",
    )
    
    # Get full user object for multiplier calculation (Phase 2)
    user_result = await db.execute(select(User).where(User.id == current_user.id))
    full_user = user_result.scalar_one()
    points = _compute_points(commission_kobo, full_user)
    
    logger.info(
        "Bills cashback: user=%d tier=%s service=isp_spectranet commission=%d points=%d",
        current_user.id, full_user.tier.value, commission_kobo, points
    )

    tx = BillTransaction(
        user_id=current_user.id,
        service="isp_spectranet",
        provider=settings.bills_provider,
        amount_naira=price_naira,
        commission_naira=commission_kobo,
        points_earned=points,
        reference=reference,
        status="success",
        external_ref=result.get("reference", result.get("transaction_id", "")),
    )
    db.add(tx)

    balance_for_calc = user_row.cashable_balance if settings.wallet_split_enabled else user_row.points_balance
    new_balance = balance_for_calc - kobo_to_points(amount_kobo) + points
    if settings.wallet_split_enabled:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(cashable_balance=User.cashable_balance + points)
        )
    else:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(points_balance=User.points_balance + points)
        )
    await db.commit()

    from app.services.notifications import create_notification_background
    from app.services.fcm import send_push_notification_background

    asyncio.create_task(create_notification_background(
        user_id=current_user.id,
        title="Spectranet ISP Top-up Successful",
        body=f"You topped up Spectranet account {account_number} and earned {points} points.",
        category="wallet_updates",
        data={"type": "wallet_update", "service": "isp_spectranet", "points": str(points)},
    ))
    asyncio.create_task(send_push_notification_background(
        user_id=current_user.id,
        title="Spectranet ISP Top-up Successful",
        body=f"You topped up Spectranet account {account_number} and earned {points} points.",
        data={"type": "wallet_update", "service": "isp_spectranet", "points": str(points)},
        category="wallet_updates",
    ))

    return {
        "reference": reference,
        "commission_naira": commission_kobo,
        "points_earned": points,
        "new_balance": new_balance,
        "status": "success",
    }


# ── Education / Result Checker ──────────────────────────────────────

@router.get("/education/prices")
async def list_education_products():
    """List exam result checker prices."""
    return await _get_vtu_public_client().get_result_checker_prices()


@router.post("/education")
async def buy_result_checker(
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Buy exam result checker PIN."""
    reference = _generate_reference()
    exam_code = payload.get("exam_code", "")
    quantity = int(payload.get("quantity", 1))

    if not exam_code:
        raise HTTPException(status_code=400, detail="exam_code is required")

    try:
        products = await _get_vtu_public_client().get_result_checker_prices()
    except (PeyflexError, BigisubError) as exc:
        raise _vtu_error(exc)

    product = next((p for p in products if p["code"] == exam_code), None)
    if not product:
        raise HTTPException(status_code=400, detail=f"Unknown exam: {exam_code}")

    price_naira = product["amount"]
    amount_kobo = price_naira * 100 * quantity

    user_row = (
        await db.execute(
            select(User).where(User.id == current_user.id).with_for_update()
        )
    ).scalar_one_or_none()
    if user_row is None:
        raise HTTPException(status_code=404, detail="User not found")

    if settings.wallet_split_enabled:
        if user_row.cashable_balance < kobo_to_points(amount_kobo):
            raise HTTPException(status_code=402, detail="Insufficient balance")
    else:
        if user_row.points_balance < kobo_to_points(amount_kobo):
            raise HTTPException(status_code=402, detail="Insufficient balance")

    if settings.wallet_split_enabled:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(cashable_balance=User.cashable_balance - kobo_to_points(amount_kobo))
        )
    else:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(points_balance=User.points_balance - kobo_to_points(amount_kobo))
        )

    try:
        result = await _get_vtu_client().buy_result_checker(exam_code, quantity)
    except (PeyflexError, BigisubError) as exc:
        await db.rollback()
        raise _vtu_error(exc)

    commission_kobo = _effective_commission_kobo(
        amount_kobo=amount_kobo,
        service="education",
    )
    
    # Get full user object for multiplier calculation (Phase 2)
    user_result = await db.execute(select(User).where(User.id == current_user.id))
    full_user = user_result.scalar_one()
    points = _compute_points(commission_kobo, full_user)
    
    logger.info(
        "Bills cashback: user=%d tier=%s service=education commission=%d points=%d",
        current_user.id, full_user.tier.value, commission_kobo, points
    )

    tx = BillTransaction(
        user_id=current_user.id,
        service="education",
        provider=settings.bills_provider,
        amount_naira=price_naira * quantity,
        commission_naira=commission_kobo,
        points_earned=points,
        reference=reference,
        status="success",
        external_ref=result.get("reference", result.get("transaction_id", "")),
    )
    db.add(tx)

    balance_for_calc = user_row.cashable_balance if settings.wallet_split_enabled else user_row.points_balance
    new_balance = balance_for_calc - kobo_to_points(amount_kobo) + points
    if settings.wallet_split_enabled:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(cashable_balance=User.cashable_balance + points)
        )
    else:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(points_balance=User.points_balance + points)
        )
    await db.commit()

    from app.services.notifications import create_notification_background
    from app.services.fcm import send_push_notification_background

    asyncio.create_task(create_notification_background(
        user_id=current_user.id,
        title="Result Checker Purchase Successful",
        body=f"You bought {quantity}x {exam_code} result checker PIN(s) and earned {points} points.",
        category="wallet_updates",
        data={"type": "wallet_update", "service": "education", "points": str(points)},
    ))
    asyncio.create_task(send_push_notification_background(
        user_id=current_user.id,
        title="Result Checker Purchase Successful",
        body=f"You bought {quantity}x {exam_code} result checker PIN(s) and earned {points} points.",
        data={"type": "wallet_update", "service": "education", "points": str(points)},
        category="wallet_updates",
    ))

    return {
        "reference": reference,
        "commission_naira": commission_kobo,
        "points_earned": points,
        "new_balance": new_balance,
        "status": "success",
        "pins": result.get("pins", []),
    }


# ── SMS ─────────────────────────────────────────────────────────────

@router.get("/sms/pricing")
async def get_sms_pricing():
    """Get SMS pricing."""
    return await _get_vtu_public_client().get_sms_pricing()


@router.post("/sms/send")
async def send_sms(
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Send bulk SMS."""
    reference = _generate_reference()
    sender_name = payload.get("sender_name", "")
    recipients = payload.get("recipients", [])
    message = payload.get("message", "")

    if not sender_name or not recipients or not message:
        raise HTTPException(status_code=400, detail="sender_name, recipients, and message are required")

    try:
        pricing = await _get_vtu_public_client().get_sms_pricing()
        cost_per_page = pricing.get("cost_per_page", 5)
        normal_chars = pricing.get("normal_chars_per_page", 160)
        pages = max(1, (len(message) + normal_chars - 1) // normal_chars)
        total_cost = cost_per_page * pages * len(recipients)
    except (PeyflexError, BigisubError):
        total_cost = 5 * len(recipients)

    amount_kobo = total_cost * 100

    user_row = (
        await db.execute(
            select(User).where(User.id == current_user.id).with_for_update()
        )
    ).scalar_one_or_none()
    if user_row is None:
        raise HTTPException(status_code=404, detail="User not found")

    if settings.wallet_split_enabled:
        if user_row.cashable_balance < kobo_to_points(amount_kobo):
            raise HTTPException(status_code=402, detail="Insufficient balance")
    else:
        if user_row.points_balance < kobo_to_points(amount_kobo):
            raise HTTPException(status_code=402, detail="Insufficient balance")

    if settings.wallet_split_enabled:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(cashable_balance=User.cashable_balance - kobo_to_points(amount_kobo))
        )
    else:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(points_balance=User.points_balance - kobo_to_points(amount_kobo))
        )

    try:
        result = await _get_vtu_client().send_sms(sender_name, recipients, message)
    except (PeyflexError, BigisubError) as exc:
        await db.rollback()
        raise _vtu_error(exc)

    commission_kobo = _effective_commission_kobo(
        amount_kobo=amount_kobo,
        service="sms",
    )
    
    # Get full user object for multiplier calculation (Phase 2)
    user_result = await db.execute(select(User).where(User.id == current_user.id))
    full_user = user_result.scalar_one()
    points = _compute_points(commission_kobo, full_user)
    
    logger.info(
        "Bills cashback: user=%d tier=%s service=sms commission=%d points=%d",
        current_user.id, full_user.tier.value, commission_kobo, points
    )

    tx = BillTransaction(
        user_id=current_user.id,
        service="sms",
        provider=settings.bills_provider,
        amount_naira=total_cost,
        commission_naira=commission_kobo,
        points_earned=points,
        reference=reference,
        status="success",
        external_ref=result.get("job_id", ""),
    )
    db.add(tx)

    balance_for_calc = user_row.cashable_balance if settings.wallet_split_enabled else user_row.points_balance
    new_balance = balance_for_calc - kobo_to_points(amount_kobo) + points
    if settings.wallet_split_enabled:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(cashable_balance=User.cashable_balance + points)
        )
    else:
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(points_balance=User.points_balance + points)
        )
    await db.commit()

    from app.services.notifications import create_notification_background
    from app.services.fcm import send_push_notification_background

    asyncio.create_task(create_notification_background(
        user_id=current_user.id,
        title="Bulk SMS Sent Successfully",
        body=f"You sent bulk SMS to {len(recipients)} recipients and earned {points} points.",
        category="wallet_updates",
        data={"type": "wallet_update", "service": "sms", "points": str(points)},
    ))
    asyncio.create_task(send_push_notification_background(
        user_id=current_user.id,
        title="Bulk SMS Sent Successfully",
        body=f"You sent bulk SMS to {len(recipients)} recipients and earned {points} points.",
        data={"type": "wallet_update", "service": "sms", "points": str(points)},
        category="wallet_updates",
    ))

    return {
        "reference": reference,
        "commission_naira": commission_kobo,
        "points_earned": points,
        "new_balance": new_balance,
        "status": "success",
        "job_id": result.get("job_id", ""),
        "total_pages": result.get("total_pages", 0),
        "total_cost": total_cost,
    }


@router.get("/history", response_model=BillsHistoryResponse)
async def get_bills_history(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: str | None = Query(default=None, description="Filter by service type: airtime, data, electricity, tv, recharge_pin, betting, isp, education, sms"),
    status: str | None = Query(default=None, description="Filter by status: success, failed, pending"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
) -> BillsHistoryResponse:
    """List user's bill transaction history with pagination."""
    query = (
        select(BillTransaction)
        .where(BillTransaction.user_id == current_user.id)
        .order_by(BillTransaction.created_at.desc())
    )

    if service:
        query = query.where(BillTransaction.service == service)
    if status:
        query = query.where(BillTransaction.status == status)

    count_query = select(BillTransaction.id).where(BillTransaction.user_id == current_user.id)
    if service:
        count_query = count_query.where(BillTransaction.service == service)
    if status:
        count_query = count_query.where(BillTransaction.status == status)

    total_result = await db.execute(count_query)
    total = len(total_result.scalars().all())

    offset = (page - 1) * limit
    paginated_query = query.offset(offset).limit(limit)
    result = await db.execute(paginated_query)
    items = result.scalars().all()

    return BillsHistoryResponse(
        items=[BillTransactionOut.model_validate(item) for item in items],
        total=total,
        page=page,
        limit=limit,
        service=service,
    )


# ── Beneficiaries ────────────────────────────────────────────────────

@router.get("/beneficiaries", response_model=list[BeneficiaryOut])
async def list_beneficiaries(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    q: str | None = Query(default=None, description="Search by name or phone"),
) -> list[BeneficiaryOut]:
    """List saved beneficiaries for the current user, optionally filtered by search query."""
    query = select(Beneficiary).where(Beneficiary.user_id == current_user.id)
    if q:
        like = f"%{q.strip()}%"
        query = query.where(
            (Beneficiary.name.ilike(like)) | (Beneficiary.phone.ilike(like))
        )
    query = query.order_by(Beneficiary.created_at.desc())
    result = await db.execute(query)
    rows = result.scalars().all()
    return [BeneficiaryOut.model_validate(row) for row in rows]


@router.post("/beneficiaries", response_model=BeneficiaryOut)
async def create_beneficiary(
    payload: BeneficiaryCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BeneficiaryOut:
    """Save a new beneficiary for quick-repeat purchases."""
    existing = (
        await db.execute(
            select(Beneficiary).where(
                Beneficiary.user_id == current_user.id,
                Beneficiary.phone == payload.phone,
            )
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Beneficiary already exists")

    beneficiary = Beneficiary(
        user_id=current_user.id,
        name=payload.name.strip(),
        phone=payload.phone.strip(),
        network=payload.network.strip().lower(),
    )
    db.add(beneficiary)
    await db.commit()
    await db.refresh(beneficiary)
    return BeneficiaryOut.model_validate(beneficiary)


@router.put("/beneficiaries/{beneficiary_id}", response_model=BeneficiaryOut)
async def update_beneficiary(
    beneficiary_id: int,
    payload: BeneficiaryCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BeneficiaryOut:
    """Update an existing beneficiary."""
    row = (
        await db.execute(
            select(Beneficiary).where(
                Beneficiary.id == beneficiary_id,
                Beneficiary.user_id == current_user.id,
            )
        )
    ).first()
    
    if not row:
        raise HTTPException(status_code=404, detail="Beneficiary not found")
    
    beneficiary = row[0]
    beneficiary.name = payload.name
    beneficiary.phone = payload.phone
    beneficiary.network = payload.network
    
    await db.commit()
    await db.refresh(beneficiary)
    return BeneficiaryOut.model_validate(beneficiary)


@router.delete("/beneficiaries/{beneficiary_id}", response_model=BeneficiaryDeleteResponse)
async def delete_beneficiary(
    beneficiary_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BeneficiaryDeleteResponse:
    """Remove a saved beneficiary."""
    row = (
        await db.execute(
            select(Beneficiary).where(
                Beneficiary.id == beneficiary_id,
                Beneficiary.user_id == current_user.id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Beneficiary not found")

    await db.delete(row)
    await db.commit()
    return BeneficiaryDeleteResponse(deleted=True)


# ── Receipt PDF Generation ──────────────────────────────────────────

@router.get("/receipt/{reference}")
async def download_receipt_pdf(
    reference: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Download PDF receipt for a bill transaction.
    
    Returns a downloadable PDF file with transaction details, QR code,
    and PagePay branding.
    """
    # Find transaction by reference
    result = await db.execute(
        select(BillTransaction).where(
            BillTransaction.reference == reference,
            BillTransaction.user_id == current_user.id,
        )
    )
    transaction = result.scalar_one_or_none()
    
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    # Generate PDF
    try:
        pdf_bytes = generate_receipt_pdf(transaction)
    except Exception as exc:
        logger.error("Failed to generate PDF receipt: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to generate receipt")
    
    # Return PDF as downloadable file
    filename = f"pagepay-receipt-{reference}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Type": "application/pdf",
        },
    )


# ── VTU Dispute/Refund System ───────────────────────────────────────

@router.post("/disputes", response_model=BillDisputeOut)
async def create_dispute(
    payload: BillDisputeCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BillDisputeOut:
    """Open a dispute for a failed VTU transaction.
    
    If airtime/data/electricity wasn't delivered despite wallet debit,
    user can open a dispute. Auto-refund triggers after 24 hours if
    VTU provider doesn't confirm delivery.
    """
    # Find the transaction
    result = await db.execute(
        select(BillTransaction).where(
            BillTransaction.reference == payload.transaction_reference,
            BillTransaction.user_id == current_user.id,
        )
    )
    transaction = result.scalar_one_or_none()
    
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    # Only allow disputes for transactions that appeared to succeed
    # but user claims weren't delivered
    if transaction.status != "success":
        raise HTTPException(
            status_code=400,
            detail="Can only dispute successful transactions that weren't delivered"
        )
    
    # Check if dispute already exists
    existing = await db.execute(
        select(BillDispute).where(
            BillDispute.transaction_id == transaction.id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Dispute already exists for this transaction")
    
    # Create dispute with auto-refund timer (24 hours from now)
    from datetime import timedelta
    auto_refund_at = datetime.utcnow() + timedelta(hours=24)
    
    dispute = BillDispute(
        user_id=current_user.id,
        transaction_id=transaction.id,
        transaction_reference=transaction.reference,
        reason=payload.reason,
        status="open",
        auto_refund_at=auto_refund_at,
    )
    
    db.add(dispute)
    await db.commit()
    await db.refresh(dispute)
    
    # Send notification
    from app.services.notifications import create_notification_background
    from app.services.fcm import send_push_notification_background
    
    asyncio.create_task(create_notification_background(
        user_id=current_user.id,
        title="Dispute Opened",
        body=f"Your dispute for {transaction.reference} has been opened. We'll investigate and respond within 24 hours.",
        category="wallet_updates",
        data={"type": "dispute", "dispute_id": str(dispute.id), "reference": transaction.reference},
    ))
    asyncio.create_task(send_push_notification_background(
        user_id=current_user.id,
        title="Dispute Opened",
        body=f"Your dispute for {transaction.reference} has been opened. We'll investigate and respond within 24 hours.",
        data={"type": "dispute", "dispute_id": str(dispute.id), "reference": transaction.reference},
        category="wallet_updates",
    ))
    
    return BillDisputeOut.model_validate(dispute)


@router.get("/disputes", response_model=BillDisputeListResponse)
async def list_disputes(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    status: str | None = Query(default=None, description="Filter by status: open, investigating, refunded, rejected"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
) -> BillDisputeListResponse:
    """List user's bill disputes with pagination."""
    query = (
        select(BillDispute)
        .where(BillDispute.user_id == current_user.id)
        .order_by(BillDispute.created_at.desc())
    )
    
    if status:
        query = query.where(BillDispute.status == status)
    
    count_query = select(BillDispute.id).where(BillDispute.user_id == current_user.id)
    if status:
        count_query = count_query.where(BillDispute.status == status)
    
    total_result = await db.execute(count_query)
    total = len(total_result.scalars().all())
    
    offset = (page - 1) * limit
    paginated_query = query.offset(offset).limit(limit)
    result = await db.execute(paginated_query)
    items = result.scalars().all()
    
    return BillDisputeListResponse(
        items=[BillDisputeOut.model_validate(item) for item in items],
        total=total,
        page=page,
        limit=limit,
    )


@router.get("/disputes/{dispute_id}", response_model=BillDisputeOut)
async def get_dispute(
    dispute_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BillDisputeOut:
    """Get details of a specific dispute."""
    result = await db.execute(
        select(BillDispute).where(
            BillDispute.id == dispute_id,
            BillDispute.user_id == current_user.id,
        )
    )
    dispute = result.scalar_one_or_none()
    
    if not dispute:
        raise HTTPException(status_code=404, detail="Dispute not found")
    
    return BillDisputeOut.model_validate(dispute)




# ── Scheduled/Recurring Purchases ───────────────────────────────────

@router.post("/schedule", response_model=ScheduledBillOut)
async def create_scheduled_bill(
    payload: ScheduledBillCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ScheduledBillOut:
    """Schedule a future or recurring bill purchase.
    
    Supported services: airtime, data
    Schedule types: once, daily, weekly, monthly
    
    The background job checks every minute and executes due schedules.
    """
    # Validate service-specific fields
    if payload.service == "airtime" and not payload.amount_naira:
        raise HTTPException(status_code=400, detail="amount_naira is required for airtime")
    if payload.service == "data" and not payload.plan_code:
        raise HTTPException(status_code=400, detail="plan_code is required for data")
    
    # Validate next_run_at is in future
    if payload.next_run_at <= datetime.utcnow():
        raise HTTPException(status_code=400, detail="next_run_at must be in the future")
    
    # Create schedule
    schedule = ScheduledBill(
        user_id=current_user.id,
        service=payload.service,
        phone=payload.phone,
        network=payload.network,
        amount_naira=payload.amount_naira or 0,
        plan_code=payload.plan_code,
        schedule_type=payload.schedule_type,
        next_run_at=payload.next_run_at,
        status="active",
    )
    
    db.add(schedule)
    await db.commit()
    await db.refresh(schedule)
    
    # Register with APScheduler
    from app.services.scheduled_bills import scheduler
    if scheduler:
        if payload.schedule_type == "once":
            scheduler.add_job(
                execute_scheduled_purchase,
                'date',
                run_date=payload.next_run_at,
                args=[schedule.id],
                id=f"schedule_{schedule.id}",
            )
        elif payload.schedule_type == "daily":
            scheduler.add_job(
                execute_scheduled_purchase,
                'interval',
                days=1,
                start_date=payload.next_run_at,
                args=[schedule.id],
                id=f"schedule_{schedule.id}",
            )
        elif payload.schedule_type == "weekly":
            scheduler.add_job(
                execute_scheduled_purchase,
                'interval',
                weeks=1,
                start_date=payload.next_run_at,
                args=[schedule.id],
                id=f"schedule_{schedule.id}",
            )
        elif payload.schedule_type == "monthly":
            scheduler.add_job(
                execute_scheduled_purchase,
                'interval',
                days=30,
                start_date=payload.next_run_at,
                args=[schedule.id],
                id=f"schedule_{schedule.id}",
            )
    
    logger.info("Created scheduled %s purchase for user %d", payload.service, current_user.id)
    
    return ScheduledBillOut.model_validate(schedule)


@router.get("/schedules", response_model=ScheduledBillListResponse)
async def list_scheduled_bills(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    status: str | None = Query(default=None, description="Filter by status: active, completed, cancelled, failed"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
) -> ScheduledBillListResponse:
    """List user's scheduled bills with pagination."""
    query = (
        select(ScheduledBill)
        .where(ScheduledBill.user_id == current_user.id)
        .order_by(ScheduledBill.next_run_at.asc())
    )
    
    if status:
        query = query.where(ScheduledBill.status == status)
    
    count_query = select(ScheduledBill.id).where(ScheduledBill.user_id == current_user.id)
    if status:
        count_query = count_query.where(ScheduledBill.status == status)
    
    total_result = await db.execute(count_query)
    total = len(total_result.scalars().all())
    
    offset = (page - 1) * limit
    paginated_query = query.offset(offset).limit(limit)
    result = await db.execute(paginated_query)
    items = result.scalars().all()
    
    return ScheduledBillListResponse(
        items=[ScheduledBillOut.model_validate(item) for item in items],
        total=total,
        page=page,
        limit=limit,
    )


@router.delete("/schedules/{schedule_id}", response_model=ScheduledBillCancelResponse)
async def cancel_scheduled_bill(
    schedule_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ScheduledBillCancelResponse:
    """Cancel a scheduled bill purchase."""
    result = await db.execute(
        select(ScheduledBill).where(
            ScheduledBill.id == schedule_id,
            ScheduledBill.user_id == current_user.id,
        )
    )
    schedule = result.scalar_one_or_none()
    
    if not schedule:
        raise HTTPException(status_code=404, detail="Scheduled bill not found")
    
    if schedule.status != "active":
        raise HTTPException(status_code=400, detail="Can only cancel active schedules")
    
    await db.execute(
        update(ScheduledBill)
        .where(ScheduledBill.id == schedule_id)
        .values(status="cancelled", updated_at=datetime.utcnow())
    )
    await db.commit()
    
    # Remove from APScheduler
    from app.services.scheduled_bills import scheduler
    if scheduler:
        try:
            scheduler.remove_job(f"schedule_{schedule_id}")
        except Exception:
            pass  # Job might not exist
    
    logger.info("Cancelled scheduled bill %d for user %d", schedule_id, current_user.id)
    
    return ScheduledBillCancelResponse(cancelled=True, id=schedule_id)
