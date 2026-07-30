"""Subscription & Premium Tier Service

Helpers for checking premium status, calculating benefits, and managing subscriptions.
"""

from datetime import datetime, timedelta
from typing import Optional

from app.config import settings
from app.models import User, UserTier


def is_premium(user: User) -> bool:
    """Check if user has an active premium subscription.

    Args:
        user: User model instance

    Returns:
        True if user has active premium subscription, False otherwise
    """
    if user.tier == UserTier.FREE:
        return False

    if user.subscription_expires_at is None:
        return False

    # Check if subscription is still valid
    return user.subscription_expires_at > datetime.utcnow()


def get_points_multiplier(user: User) -> float:
    """Get the points earning multiplier for a user.

    Reads `settings.premium_points_multiplier` so ops can tune the
    premium benefit without a deploy. The setting's default is 2.0
    ("earn double on every credit"); override via env
    `PREMIUM_POINTS_MULTIPLIER`. Free users always get 1.0 — we never
    make the base rate worse than the published "earn points" pitch.
    """
    return settings.premium_points_multiplier if is_premium(user) else 1.0


def calculate_subscription_end_date(tier: UserTier, start_date: Optional[datetime] = None) -> datetime:
    """Calculate when a subscription should expire.
    
    Args:
        tier: The subscription tier
        start_date: When subscription starts (defaults to now)
        
    Returns:
        Expiration datetime
    """
    if start_date is None:
        start_date = datetime.utcnow()
    
    if tier == UserTier.PREMIUM_MONTHLY:
        return start_date + timedelta(days=30)
    elif tier == UserTier.PREMIUM_YEARLY:
        return start_date + timedelta(days=365)
    else:
        raise ValueError(f"Cannot calculate end date for tier: {tier}")


def get_tier_price_kobo(tier: UserTier) -> int:
    """Get the price in kobo for a subscription tier.

    Reads from `settings.premium_monthly_price_kobo` and
    `settings.premium_yearly_price_kobo` so ops can A/B test price
    points without a deploy. Both are in kobo (₦1 = 100 kobo). The
    FREE tier has no price — Paystack charges are skipped for free users.

    Args:
        tier: The subscription tier

    Returns:
        Price in kobo (₦1 = 100 kobo)

    Raises:
        ValueError: if `tier` is FREE — PREVENTED, you can't price a
            free tier, callers should branch on `tier == UserTier.FREE`
            before charging.
    """
    prices = {
        UserTier.PREMIUM_MONTHLY: settings.premium_monthly_price_kobo,
        UserTier.PREMIUM_YEARLY: settings.premium_yearly_price_kobo,
    }

    if tier not in prices:
        raise ValueError(f"No price defined for tier: {tier}")

    return prices[tier]


def format_tier_name(tier: UserTier) -> str:
    """Get user-friendly tier name.
    
    Args:
        tier: The subscription tier
        
    Returns:
        Formatted tier name
    """
    names = {
        UserTier.FREE: "Free",
        UserTier.PREMIUM_MONTHLY: "Premium Monthly",
        UserTier.PREMIUM_YEARLY: "Premium Yearly",
    }
    return names.get(tier, str(tier))


def get_subscription_status(user: User) -> dict:
    """Get detailed subscription status for a user.
    
    Args:
        user: User model instance
        
    Returns:
        Dictionary with subscription details
    """
    is_active = is_premium(user)
    
    days_remaining = None
    if is_active and user.subscription_expires_at:
        delta = user.subscription_expires_at - datetime.utcnow()
        days_remaining = max(0, delta.days)
    
    return {
        "tier": user.tier.value,
        "tier_name": format_tier_name(user.tier),
        "is_premium": is_active,
        "expires_at": user.subscription_expires_at.isoformat() if user.subscription_expires_at else None,
        "days_remaining": days_remaining,
        "points_multiplier": get_points_multiplier(user),
        "benefits": {
            "ad_free_study": is_active,
            "double_points": is_active,
            "priority_ai": is_active,
        }
    }
