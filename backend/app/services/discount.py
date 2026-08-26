"""
SV Discount Service

Handles service credit (sv) discounts for bill purchases, study unlocks,
and fee waivers. Enforces 25% cap on bill discounts per AdMob policy.
"""

from typing import Literal
import math
from datetime import datetime, timezone
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User, AdEvent
from app.services.wallet import kobo_to_points
from app.core.config import settings


# Constants
DISCOUNT_CAP_PERCENT = 0.25  # 25% max discount (AdMob compliance)
DAILY_AD_IMPRESSION_CAP = 200
SV_PER_AD_FREE_TIER = 16
SV_PER_AD_PREMIUM_TIER = 24


class SvShortfallError(Exception):
    """
    Raised when user doesn't have enough sv and can earn more via ads.
    
    This signals to the client that they should watch ads to bridge the gap.
    """
    def __init__(
        self,
        shortfall_sv: int,
        ads_needed: int,
        ads_remaining: int,
        user_balance: int,
        requested_sv: int,
    ):
        self.shortfall_sv = shortfall_sv
        self.ads_needed = ads_needed
        self.ads_remaining = ads_remaining
        self.user_balance = user_balance
        self.requested_sv = requested_sv
        super().__init__(
            f"Need {shortfall_sv} more sv. Watch {ads_needed} ads to earn it."
        )


def max_discount_sv(price_kobo: int) -> int:
    """
    Calculate max sv discount for a product (25% of full price).
    
    Args:
        price_kobo: Product price in kobo
        
    Returns:
        Maximum sv that can be applied as discount (rounded up)
        
    Example:
        >>> max_discount_sv(10000)  # ₦100
        250  # 25% = ₦25 = 250 sv
    """
    full_price_sv = kobo_to_points(price_kobo)
    return math.ceil(full_price_sv * DISCOUNT_CAP_PERCENT)


async def get_ads_watched_today(user_id: int, db: AsyncSession) -> int:
    """
    Count rewarded ads watched by user today (UTC day).
    
    Args:
        user_id: User ID
        db: Database session
        
    Returns:
        Number of ads watched today
    """
    today_start = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    
    result = await db.execute(
        select(func.count(AdEvent.id))
        .where(AdEvent.user_id == user_id)
        .where(AdEvent.ad_type == "rewarded")
        .where(AdEvent.credit_status == "credited")
        .where(AdEvent.created_at >= today_start)
    )
    
    return result.scalar() or 0


async def check_discount_eligibility(
    user: User,
    product_type: Literal[
        "airtime",
        "data",
        "electricity",
        "tv",
        "recharge_pin",
        "betting",
        "isp",
        "education",
        "bulk_sms",
    ],
    price_kobo: int,
    sv_requested: int,
    db: AsyncSession,
) -> int:
    """
    Validate and return the actual sv to apply as discount.
    
    Raises SvShortfallError if:
    - User doesn't have enough sv
    - User CAN earn more via ads (hasn't hit 200/day cap)
    
    Returns actual sv to apply if:
    - User has enough sv
    - User doesn't have enough but has hit ad cap (partial discount applied)
    
    Args:
        user: User object
        product_type: Type of product being purchased
        price_kobo: Product price in kobo
        sv_requested: SV amount user wants to apply
        db: Database session
        
    Returns:
        Actual sv to apply (may be less than requested if capped or insufficient)
        
    Raises:
        SvShortfallError: User needs to watch ads to get enough sv
    """
    # Cap at 25% for bills
    max_sv = max_discount_sv(price_kobo)
    requested = min(sv_requested, max_sv)
    
    # User has enough sv → proceed
    if user.service_credit_balance >= requested:
        return requested
    
    # Calculate shortfall
    shortfall = requested - user.service_credit_balance
    
    # Determine sv per ad based on user tier
    sv_per_ad = (
        SV_PER_AD_PREMIUM_TIER
        if user.tier in ("premium_monthly", "premium_yearly")
        else SV_PER_AD_FREE_TIER
    )
    
    ads_needed = math.ceil(shortfall / sv_per_ad)
    
    # Check if user has ad-budget remaining
    ads_watched_today = await get_ads_watched_today(user.id, db)
    ads_remaining = DAILY_AD_IMPRESSION_CAP - ads_watched_today
    
    # User can earn the shortfall → raise error with earn_route
    if ads_needed <= ads_remaining:
        raise SvShortfallError(
            shortfall_sv=shortfall,
            ads_needed=ads_needed,
            ads_remaining=ads_remaining,
            user_balance=user.service_credit_balance,
            requested_sv=requested,
        )
    
    # User hit ad cap → apply what they have (partial discount, no error)
    return user.service_credit_balance


async def check_full_sv_payment_eligibility(
    user: User,
    sv_cost: int,
    db: AsyncSession,
) -> None:
    """
    Check if user can pay full sv cost (study unlocks, fees, premium trials).
    
    Unlike bill discounts, these are 100% sv payments with no 25% cap.
    
    Args:
        user: User object
        sv_cost: Required sv amount
        db: Database session
        
    Raises:
        SvShortfallError: User needs to watch ads to get enough sv
    """
    if user.service_credit_balance >= sv_cost:
        return  # User has enough
    
    # Calculate shortfall
    shortfall = sv_cost - user.service_credit_balance
    
    sv_per_ad = (
        SV_PER_AD_PREMIUM_TIER
        if user.tier in ("premium_monthly", "premium_yearly")
        else SV_PER_AD_FREE_TIER
    )
    
    ads_needed = math.ceil(shortfall / sv_per_ad)
    
    # Check ad budget
    ads_watched_today = await get_ads_watched_today(user.id, db)
    ads_remaining = DAILY_AD_IMPRESSION_CAP - ads_watched_today
    
    if ads_needed <= ads_remaining:
        raise SvShortfallError(
            shortfall_sv=shortfall,
            ads_needed=ads_needed,
            ads_remaining=ads_remaining,
            user_balance=user.service_credit_balance,
            requested_sv=sv_cost,
        )
    
    # User hit ad cap and still doesn't have enough → hard fail
    # (Different from bill discounts where we apply partial)
    raise ValueError(
        f"Insufficient service credits. Need {sv_cost} sv, "
        f"have {user.service_credit_balance} sv. "
        f"Daily ad cap reached ({DAILY_AD_IMPRESSION_CAP}/day)."
    )


def calculate_withdrawal_fee_sv(amount_naira: int) -> dict:
    """
    Calculate withdrawal fee and sv waiver cost based on amount tier.
    
    Args:
        amount_naira: Withdrawal amount in naira
        
    Returns:
        Dict with standard_fee, sv_waiver_cost, ads_needed
    """
    if amount_naira < 5000:
        return {
            "standard_fee_naira": 15,
            "sv_waiver_cost": 50,
            "ads_needed": 1,
        }
    elif amount_naira <= 20000:
        return {
            "standard_fee_naira": 35,
            "sv_waiver_cost": 100,
            "ads_needed": 2,
        }
    else:
        return {
            "standard_fee_naira": 70,
            "sv_waiver_cost": 200,
            "ads_needed": 4,
        }
