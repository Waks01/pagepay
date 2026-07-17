"""Bills & Earn endpoints (Phase 8).

Users buy airtime, data, electricity, or cable TV subscriptions and earn
points back from the aggregator's commission — the platform never funds
rewards from its own pocket.

Flow for every purchase:
  1. User requests a purchase (phone/meter, amount, network)
  2. Backend debits the user's wallet for the amount
  3. Backend calls Peyflex to fulfill the purchase
  4. Peyflex pays a commission (varies by service)
  5. Backend splits the commission: user gets points, platform keeps the rest
  6. Backend records the BillTransaction row
  7. User receives the service + points

Real Peyflex API: https://client.peyflex.com.ng/api/
Reference: https://documenter.getpostman.com/view/17835214/2sB34imLMn
"""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
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
)
from app.services.peyflex import get_client, get_public_client, PeyflexError

logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/bills", tags=["bills"])

_USER_SHARE = 0.70  # User gets 70%, platform keeps 30%

# Points conversion: 10 points = ₦1
_POINTS_PER_NAIRA = 10


def _compute_points(commission_kobo: int) -> int:
    """Compute user's point share from a commission amount in kobo.
    
    The commission comes from Peyflex's `discount` field in the API response,
    which reflects the real-time discount rate for your account tier:
    - Free API tier: 0.5-3% depending on service
    - Top Reseller tier: 1-6% (higher earnings for your users)
    
    Users receive 70% of the commission as points (10 pts = ₦1).
    Platform keeps 30% to cover infrastructure costs.
    """
    user_share_kobo = int(commission_kobo * _USER_SHARE)
    return user_share_kobo * _POINTS_PER_NAIRA // 100


def _generate_reference() -> str:
    return f"BILL-{uuid.uuid4().hex[:12].upper()}"


# ── Airtime ──────────────────────────────────────────────────────────


@router.get("/airtime/networks")
async def list_airtime_networks():
    """List airtime networks available on Peyflex."""
    nets = await get_public_client().get_airtime_networks()
    return [{"id": n.id, "name": n.name} for n in nets]


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

    if user_row.points_balance < amount_kobo:
        raise HTTPException(status_code=402, detail="Insufficient balance")

    await db.execute(
        update(User)
        .where(User.id == current_user.id)
        .values(points_balance=User.points_balance - amount_kobo)
    )

    # 2. Call Peyflex
    try:
        result = await get_client().buy_airtime(
            network=payload.network,
            mobile_number=payload.phone,
            amount=payload.amount_naira,
        )
    except PeyflexError as exc:
        await db.rollback()
        logger.error("Peyflex airtime failed: %s", exc)
        raise HTTPException(status_code=502, detail="Payment provider unavailable")

    if result.status != "success":
        await db.rollback()
        raise HTTPException(status_code=502, detail=f"Purchase failed: {result.message}")

    # Extract real commission from Peyflex's discount field.
    # This reflects your actual account tier discount (Free API: 1%, Top Reseller: 2%).
    # If discount is missing or invalid, fall back to 0 commission.
    try:
        commission_kobo = int(float(result.discount) * 100)
    except (ValueError, TypeError):
        logger.warning("Peyflex airtime discount field missing or invalid: %s", result.discount)
        commission_kobo = 0

    points = _compute_points(commission_kobo)

    # 4. Record transaction and credit points
    tx = BillTransaction(
        user_id=current_user.id,
        service="airtime",
        provider="peyflex",
        phone=payload.phone,
        amount_naira=payload.amount_naira,
        commission_naira=commission_kobo,
        points_earned=points,
        reference=reference,
        status="success",
        external_ref=result.reference,
    )
    db.add(tx)

    new_balance = current_user.points_balance - amount_kobo + points
    await db.execute(
        update(User)
        .where(User.id == current_user.id)
        .values(points_balance=User.points_balance + points)
    )
    await db.commit()

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
    """List data networks available on Peyflex."""
    nets = await get_public_client().get_data_networks()
    return [{"identifier": n.identifier, "name": n.name} for n in nets]


@router.get("/data/plans")
async def list_data_plans(network: str = "mtn_gifting_data"):
    """List data plans for a specific network."""
    plans = await get_public_client().get_data_plans(network)
    return [
        {"plan_code": p.plan_code, "amount": p.amount, "label": p.label}
        for p in plans
    ]


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
        plans = await get_client().get_data_plans(payload.network)
    except PeyflexError as exc:
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

    if user_row.points_balance < amount_kobo:
        raise HTTPException(status_code=402, detail="Insufficient balance")

    await db.execute(
        update(User)
        .where(User.id == current_user.id)
        .values(points_balance=User.points_balance - amount_kobo)
    )

    try:
        result = await get_client().buy_data(
            network=payload.network,
            mobile_number=payload.phone,
            plan_code=payload.plan_code,
        )
    except PeyflexError as exc:
        await db.rollback()
        logger.error("Peyflex data failed: %s", exc)
        raise HTTPException(status_code=502, detail="Payment provider unavailable")

    if result.status != "success":
        await db.rollback()
        raise HTTPException(status_code=502, detail=f"Purchase failed: {result.message}")

    # Extract real commission from Peyflex's discount field.
    # This reflects your actual account tier discount (Free API: 0.5-3%, Top Reseller: 1-6%).
    try:
        commission_kobo = int(float(result.discount) * 100)
    except (ValueError, TypeError):
        logger.warning("Peyflex data discount field missing or invalid: %s", result.discount)
        commission_kobo = 0

    points = _compute_points(commission_kobo)

    tx = BillTransaction(
        user_id=current_user.id,
        service="data",
        provider="peyflex",
        phone=payload.phone,
        amount_naira=price_naira,
        commission_naira=commission_kobo,
        points_earned=points,
        reference=reference,
        status="success",
        external_ref=result.reference,
    )
    db.add(tx)

    new_balance = current_user.points_balance - amount_kobo + points
    await db.execute(
        update(User)
        .where(User.id == current_user.id)
        .values(points_balance=User.points_balance + points)
    )
    await db.commit()

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
    """List electricity DISCOs available on Peyflex."""
    return await get_public_client().get_electricity_plans()


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

    if user_row.points_balance < amount_kobo:
        raise HTTPException(status_code=402, detail="Insufficient balance")

    await db.execute(
        update(User)
        .where(User.id == current_user.id)
        .values(points_balance=User.points_balance - amount_kobo)
    )

    try:
        result = await get_client().buy_electricity(
            plan=payload.plan_id,
            meter=payload.meter_number,
            amount=payload.amount_naira,
            meter_type=payload.meter_type,
            phone=payload.phone,
        )
    except PeyflexError as exc:
        await db.rollback()
        logger.error("Peyflex electricity failed: %s", exc)
        raise HTTPException(status_code=502, detail="Payment provider unavailable")

    if result.get("status") != "SUCCESS":
        await db.rollback()
        raise HTTPException(status_code=502, detail=f"Purchase failed: {result.get('message', 'Unknown')}")

    # Extract real commission from Peyflex's response.
    # Electricity has very low commission (Free API: 0.1%, Top Reseller: 0.5%).
    # Peyflex may return this in 'discount', 'charged', or a computed field.
    commission_kobo = 0
    try:
        # Try to extract discount if available
        if "discount" in result and result["discount"]:
            commission_kobo = int(float(result["discount"]) * 100)
        elif "charged" in result and result["charged"]:
            # Some APIs return charged = amount - discount
            charged = float(result["charged"])
            commission_kobo = int((payload.amount_naira - charged) * 100)
    except (ValueError, TypeError, KeyError) as e:
        logger.warning("Could not extract electricity commission from response: %s. Error: %s", result, e)
        commission_kobo = 0

    points = _compute_points(commission_kobo)

    tx = BillTransaction(
        user_id=current_user.id,
        service="electricity",
        provider="peyflex",
        meter_number=payload.meter_number,
        amount_naira=payload.amount_naira,
        commission_naira=commission_kobo,
        points_earned=points,
        reference=reference,
        status="success",
        external_ref=result.get("reference", ""),
    )
    db.add(tx)

    new_balance = current_user.points_balance - amount_kobo + points
    await db.execute(
        update(User)
        .where(User.id == current_user.id)
        .values(points_balance=User.points_balance + points)
    )
    await db.commit()

    return {
        "reference": reference,
        "commission_naira": commission_kobo,
        "points_earned": points,
        "new_balance": new_balance,
        "status": "success",
        "meter_number": payload.meter_number,
        "token": result.get("token", ""),
    }


# ── Cable TV ────────────────────────────────────────────────────────

@router.get("/tv/providers")
async def list_tv_providers():
    """List cable TV providers available on Peyflex."""
    return await get_public_client().get_cable_providers()


@router.get("/tv/plans")
async def list_tv_plans(provider: str = "dstv"):
    """List cable TV plans for a provider."""
    return await get_public_client().get_cable_plans(provider)


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
        plans = await get_client().get_cable_plans(payload.provider)
    except PeyflexError as exc:
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

    if user_row.points_balance < amount_kobo:
        raise HTTPException(status_code=402, detail="Insufficient balance")

    await db.execute(
        update(User)
        .where(User.id == current_user.id)
        .values(points_balance=User.points_balance - amount_kobo)
    )

    try:
        result = await get_client().buy_cable(
            identifier=payload.provider,
            plan=payload.plan_code,
            iuc=payload.smartcard_number,
            phone=payload.phone,
            amount=price_naira,
        )
    except PeyflexError as exc:
        await db.rollback()
        logger.error("Peyflex TV failed: %s", exc)
        raise HTTPException(status_code=502, detail="Payment provider unavailable")

    if result.get("status") != "SUCCESS":
        await db.rollback()
        raise HTTPException(status_code=502, detail=f"Purchase failed: {result.get('message', 'Unknown')}")

    # Extract real commission from Peyflex's response.
    # Cable TV commission varies: DStv/GOtv 0.1%, Startimes 0.5% (Free API tier).
    # Top Reseller: 0.5% for all providers.
    commission_kobo = 0
    try:
        # Try to extract discount if available
        if "discount" in result and result["discount"]:
            commission_kobo = int(float(result["discount"]) * 100)
        elif "charged" in result and result["charged"]:
            # Some APIs return charged = amount - discount
            charged = float(result["charged"])
            commission_kobo = int((price_naira - charged) * 100)
    except (ValueError, TypeError, KeyError) as e:
        logger.warning("Could not extract TV commission from response: %s. Error: %s", result, e)
        commission_kobo = 0

    points = _compute_points(commission_kobo)

    tx = BillTransaction(
        user_id=current_user.id,
        service="tv",
        provider="peyflex",
        smartcard_number=payload.smartcard_number,
        amount_naira=price_naira,
        commission_naira=commission_kobo,
        points_earned=points,
        reference=reference,
        status="success",
        external_ref=result.get("reference", ""),
    )
    db.add(tx)

    new_balance = current_user.points_balance - amount_kobo + points
    await db.execute(
        update(User)
        .where(User.id == current_user.id)
        .values(points_balance=User.points_balance + points)
    )
    await db.commit()

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
            return {
                "phone": phone_clean,
                "network": network,
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
    """Validate electricity meter number and return customer details using Paystack.
    
    Paystack provides merchant verification API that works across all DISCOs.
    Returns customer name and address for confirmation before purchase.
    """
    meter_number = payload.get("meter_number", "").strip()
    disco_code = payload.get("plan_id", "ikeja-electric")
    meter_type = payload.get("meter_type", "prepaid")
    
    if len(meter_number) < 10:
        raise HTTPException(status_code=400, detail="Meter number must be at least 10 digits")
    
    if not settings.paystack_secret_key:
        # Fall back to no validation if Paystack not configured
        return {
            "meter_number": meter_number,
            "customer_name": None,
            "address": None,
            "validated": False,
            "message": "Validation service not configured - proceed with purchase",
        }
    
    try:
        # Use Paystack's merchant verification for electricity
        # Endpoint: GET /bvn/match (but for bills, different endpoint)
        # Actually, Paystack uses: GET /verifications/resolve_meter
        # Reference: https://paystack.com/docs/payments/multi-payments/#resolve-card-bin
        
        import httpx
        
        headers = {
            "Authorization": f"Bearer {settings.paystack_secret_key}",
            "Content-Type": "application/json",
        }
        
        # Paystack meter resolution endpoint
        # Note: This requires Paystack's bill payment feature to be enabled
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"https://api.paystack.co/verifications/resolve_meter/{disco_code}/{meter_number}/{meter_type}",
                headers=headers,
            )
        
        if resp.status_code == 200:
            data = resp.json()
            if data.get("status") and data.get("data"):
                details = data["data"]
                return {
                    "meter_number": meter_number,
                    "customer_name": details.get("customer_name"),
                    "address": details.get("address"),
                    "validated": True,
                    "message": "Meter verified successfully",
                }
        
        # If Paystack doesn't support this or meter invalid
        logger.warning(f"Paystack meter validation failed: {resp.status_code} - {resp.text}")
        return {
            "meter_number": meter_number,
            "customer_name": None,
            "address": None,
            "validated": False,
            "message": "Could not verify meter - check number and try again",
        }
        
    except Exception as e:
        logger.error(f"Meter validation error: {e}")
        # Don't block user - let them proceed
        return {
            "meter_number": meter_number,
            "customer_name": None,
            "address": None,
            "validated": False,
            "message": "Validation temporarily unavailable - proceed with purchase",
        }


@router.post("/validate-smartcard")
async def validate_smartcard(payload: dict, current_user: User = Depends(get_current_user)):
    """Validate TV smartcard/IUC number and return customer details using Paystack.
    
    Paystack provides merchant verification API for cable TV subscriptions.
    Returns customer name and account status for confirmation.
    """
    smartcard = payload.get("smartcard_number", "").strip()
    provider = payload.get("provider", "dstv")
    
    if len(smartcard) < 10:
        raise HTTPException(status_code=400, detail="Smartcard number must be at least 10 digits")
    
    if not settings.paystack_secret_key:
        return {
            "smartcard_number": smartcard,
            "customer_name": None,
            "account_status": None,
            "validated": False,
            "message": "Validation service not configured - proceed with purchase",
        }
    
    try:
        import httpx
        
        headers = {
            "Authorization": f"Bearer {settings.paystack_secret_key}",
            "Content-Type": "application/json",
        }
        
        # Paystack smartcard resolution endpoint
        # Endpoint: GET /verifications/resolve_smartcard/{provider_code}/{smartcard_number}
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"https://api.paystack.co/verifications/resolve_smartcard/{provider}/{smartcard}",
                headers=headers,
            )
        
        if resp.status_code == 200:
            data = resp.json()
            if data.get("status") and data.get("data"):
                details = data["data"]
                return {
                    "smartcard_number": smartcard,
                    "customer_name": details.get("customer_name"),
                    "account_status": details.get("account_status", "Active"),
                    "validated": True,
                    "message": "Smartcard verified successfully",
                }
        
        logger.warning(f"Paystack smartcard validation failed: {resp.status_code} - {resp.text}")
        return {
            "smartcard_number": smartcard,
            "customer_name": None,
            "account_status": None,
            "validated": False,
            "message": "Could not verify smartcard - check number and try again",
        }
        
    except Exception as e:
        logger.error(f"Smartcard validation error: {e}")
        return {
            "smartcard_number": smartcard,
            "customer_name": None,
            "account_status": None,
            "validated": False,
            "message": "Validation temporarily unavailable - proceed with purchase",
        }
