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
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.config import settings
from app.database import get_db
from app.models import BillTransaction, User
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
)
from app.services.money import kobo_to_points
from app.services.peyflex import get_client as get_peyflex_client, get_public_client as get_peyflex_public_client, PeyflexError
from app.services.bigisub import get_client as get_bigisub_client, BigisubError

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


def _compute_points(commission_kobo: int) -> int:
    """Compute user's point share from a commission amount in kobo.
    
    The commission comes from the VTU provider's `discount` field in the API response,
    which reflects the real-time discount/margin rate:
    - Peyflex: discount percentage (Free API: 0.5-3%, Top Reseller: 1-6%)
    - Bigisub: computed as (plan_amount - charged) / plan_amount * 100
    
    Users receive 67% of the commission as points (10 pts = ₦1).
    Platform keeps 33% to cover infrastructure costs.
    """
    user_share_kobo = int(commission_kobo * _USER_SHARE)
    return user_share_kobo * _POINTS_PER_NAIRA // 100


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
    reference = _generate_reference()
    amount_kobo = payload.amount_naira * 100

    user_row = (
        await db.execute(
            select(User).where(User.id == current_user.id).with_for_update()
        )
    ).scalar_one_or_none()
    if user_row is None:
        raise HTTPException(status_code=404, detail="User not found")

    if user_row.points_balance < kobo_to_points(amount_kobo):
        raise HTTPException(status_code=402, detail="Insufficient balance")

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

    # Extract real commission from provider's discount field.
    # Peyflex: discount is a percentage (e.g. "2.5").
    # Bigisub: discount is computed as (plan_amount - charged) / plan_amount * 100.
    try:
        commission_kobo = int(float(result.discount) * 100)
    except (ValueError, TypeError):
        logger.warning("VTU airtime discount field missing or invalid: %s", result.discount)
        commission_kobo = 0

    points = _compute_points(commission_kobo)

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
    )
    db.add(tx)

    new_balance = user_row.points_balance - kobo_to_points(amount_kobo) + points
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

    return AirtimePurchaseResponse(
        reference=reference,
        phone=payload.phone,
        amount_naira=payload.amount_naira,
        network=payload.network,
        commission_naira=commission_kobo,
        points_earned=points,
        new_balance=new_balance,
        status="success",
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

    if user_row.points_balance < kobo_to_points(amount_kobo):
        raise HTTPException(status_code=402, detail="Insufficient balance")

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

    # Extract real commission from provider's discount field.
    # Peyflex: discount is a percentage (e.g. "2.5").
    # Bigisub: discount is computed as (plan_amount - charged) / plan_amount * 100.
    try:
        commission_kobo = int(float(result.discount) * 100)
    except (ValueError, TypeError):
        logger.warning("VTU data discount field missing or invalid: %s", result.discount)
        commission_kobo = 0

    points = _compute_points(commission_kobo)

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
    )
    db.add(tx)

    new_balance = user_row.points_balance - kobo_to_points(amount_kobo) + points
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

    return BillsPurchaseResponse(
        reference=reference,
        commission_naira=commission_kobo,
        points_earned=points,
        new_balance=new_balance,
        status="success",
        phone=payload.phone,
        customer_name=result.plan,
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
    reference = _generate_reference()
    amount_kobo = payload.amount_naira * 100

    user_row = (
        await db.execute(
            select(User).where(User.id == current_user.id).with_for_update()
        )
    ).scalar_one_or_none()
    if user_row is None:
        raise HTTPException(status_code=404, detail="User not found")

    if user_row.points_balance < kobo_to_points(amount_kobo):
        raise HTTPException(status_code=402, detail="Insufficient balance")

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
    # Electricity typically has low or zero commission.
    commission_kobo = 0
    try:
        if "discount" in result and result["discount"]:
            commission_kobo = int(float(result["discount"]) * 100)
        elif "charged" in result and result["charged"]:
            charged = float(result["charged"])
            commission_kobo = int((payload.amount_naira - charged) * 100)
    except (ValueError, TypeError, KeyError) as e:
        logger.warning("Could not extract electricity commission from response: %s. Error: %s", result, e)
        commission_kobo = 0

    points = _compute_points(commission_kobo)

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
    )
    db.add(tx)

    new_balance = user_row.points_balance - kobo_to_points(amount_kobo) + points
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

    if user_row.points_balance < kobo_to_points(amount_kobo):
        raise HTTPException(status_code=402, detail="Insufficient balance")

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
    commission_kobo = 0
    try:
        if "discount" in result and result["discount"]:
            commission_kobo = int(float(result["discount"]) * 100)
        elif "charged" in result and result["charged"]:
            charged = float(result["charged"])
            commission_kobo = int((price_naira - charged) * 100)
    except (ValueError, TypeError, KeyError) as e:
        logger.warning("Could not extract TV commission from response: %s. Error: %s", result, e)
        commission_kobo = 0

    points = _compute_points(commission_kobo)

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

    new_balance = user_row.points_balance - kobo_to_points(amount_kobo) + points
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

    return {
        "reference": reference,
        "commission_naira": commission_kobo,
        "points_earned": points,
        "new_balance": new_balance,
        "status": "success",
        "smartcard_number": payload.smartcard_number,
        "customer_name": result.get("customer_name", ""),
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
                "address": result.get("address"),
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

    if user_row.points_balance < kobo_to_points(amount_kobo):
        raise HTTPException(status_code=402, detail="Insufficient balance")

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

    commission_kobo = 0
    try:
        if "discount" in result and result["discount"]:
            commission_kobo = int(float(result["discount"]) * 100)
    except (ValueError, TypeError):
        commission_kobo = 0

    points = _compute_points(commission_kobo)

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

    new_balance = user_row.points_balance - kobo_to_points(amount_kobo) + points
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

    return {
        "reference": reference,
        "commission_naira": commission_kobo,
        "points_earned": points,
        "new_balance": new_balance,
        "status": "success",
        "pins": result.get("pins", []),
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

    if user_row.points_balance < kobo_to_points(amount_kobo):
        raise HTTPException(status_code=402, detail="Insufficient balance")

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

    commission_kobo = 0
    points = _compute_points(commission_kobo)

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

    new_balance = user_row.points_balance - kobo_to_points(amount_kobo) + points
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

    if user_row.points_balance < kobo_to_points(amount_kobo):
        raise HTTPException(status_code=402, detail="Insufficient balance")

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

    commission_kobo = 0
    points = _compute_points(commission_kobo)

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

    new_balance = user_row.points_balance - kobo_to_points(amount_kobo) + points
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

    if user_row.points_balance < kobo_to_points(amount_kobo):
        raise HTTPException(status_code=402, detail="Insufficient balance")

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

    commission_kobo = 0
    points = _compute_points(commission_kobo)

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

    new_balance = user_row.points_balance - kobo_to_points(amount_kobo) + points
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

    if user_row.points_balance < kobo_to_points(amount_kobo):
        raise HTTPException(status_code=402, detail="Insufficient balance")

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

    commission_kobo = 0
    points = _compute_points(commission_kobo)

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

    new_balance = user_row.points_balance - kobo_to_points(amount_kobo) + points
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

    if user_row.points_balance < kobo_to_points(amount_kobo):
        raise HTTPException(status_code=402, detail="Insufficient balance")

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

    commission_kobo = 0
    points = _compute_points(commission_kobo)

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

    new_balance = user_row.points_balance - kobo_to_points(amount_kobo) + points
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

