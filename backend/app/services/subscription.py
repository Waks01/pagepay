"""Subscription & Premium Tier Service

Helpers for checking premium status, calculating benefits, and managing subscriptions.
All multipliers come from tier_benefits.json or .env - zero hardcoding.
"""

from datetime import datetime, timedelta
from typing import Optional

from app.config import settings
from app.models import User, UserTier


GRACE_PERIOD = timedelta(days=settings.premium_grace_period_days)


def is_premium(user: User) -> bool:
    """Check if user has an active premium subscription.

    Includes a grace period after subscription_expires_at so users keep
    premium benefits for `premium_grace_period_days` after expiry.

    Args:
        user: User model instance

    Returns:
        True if user has active premium subscription (including grace), False otherwise
    """
    if user.tier == UserTier.FREE:
        return False

    if user.subscription_expires_at is None:
        return False

    # Check if subscription is still valid (including grace period)
    return user.subscription_expires_at + GRACE_PERIOD > datetime.utcnow()


def get_points_multiplier(user: User, activity_type: str = "reading") -> float:
    """Get the points earning multiplier for a user based on activity type.

    Uses tier_benefits.json for multipliers with .env as fallback.
    Free users always get 1.0 multiplier.

    Args:
        user: User model instance
        activity_type: Type of activity (reading, ad, task, daily, bills)
            - reading: Reading slice completion bonus
            - ad: Ad reward points (1.5x for premium)
            - task: Task completion rewards
            - daily: Daily reward claims
            - bills: Bills/VTU cashback

    Returns:
        Multiplier to apply to base points (1.0 for free, 1.5-2.0 for premium)

    Example:
        >>> get_points_multiplier(premium_user, "reading")
        2.0
        >>> get_points_multiplier(premium_user, "ad")
        1.5
        >>> get_points_multiplier(free_user, "reading")
        1.0
    """
    if not is_premium(user):
        return 1.0

    # Import here to avoid circular dependency
    try:
        from app.services.tier_benefits import get_multiplier
        return get_multiplier(user.tier, activity_type)
    except Exception:
        # Fallback to .env settings if tier_benefits fails
        multiplier_map = {
            'reading': settings.premium_reading_multiplier,
            'ad': settings.premium_ad_multiplier,
            'task': settings.premium_task_multiplier,
            'daily': settings.premium_daily_multiplier,
            'bills': settings.premium_bills_multiplier,
        }
        return multiplier_map.get(activity_type, settings.premium_points_multiplier)


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
        UserTier.STUDY_PLUS_MONTHLY: settings.study_plus_monthly_price_kobo,
        UserTier.STUDY_PLUS_YEARLY: settings.study_plus_yearly_price_kobo,
        UserTier.COMPLETE_PLUS_MONTHLY: settings.complete_plus_monthly_price_kobo,
        UserTier.COMPLETE_PLUS_YEARLY: settings.complete_plus_yearly_price_kobo,
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
        UserTier.STUDY_PLUS_MONTHLY: "Study+ Monthly",
        UserTier.STUDY_PLUS_YEARLY: "Study+ Yearly",
        UserTier.COMPLETE_PLUS_MONTHLY: "Complete+ Monthly",
        UserTier.COMPLETE_PLUS_YEARLY: "Complete+ Yearly",
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
        "in_grace_period": is_active and user.subscription_expires_at is not None and user.subscription_expires_at <= datetime.utcnow(),
        "expires_at": user.subscription_expires_at.isoformat() if user.subscription_expires_at else None,
        "days_remaining": days_remaining,
        "grace_period_days": settings.premium_grace_period_days,
        "points_multiplier": get_points_multiplier(user),
        "benefits": {
            "ad_free_study": is_active,
            "double_points": is_active,
            "priority_ai": is_active,
        }
    }
