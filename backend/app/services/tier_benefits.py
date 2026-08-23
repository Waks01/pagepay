"""
Tier Benefits Loader Service

Loads and caches tier_benefits.json configuration file.
Provides helper functions to retrieve tier-specific settings.

All values come from either tier_benefits.json or .env - zero hardcoding.
"""

import json
import logging
from pathlib import Path
from typing import Any
from functools import lru_cache

from app.config import settings
from app.models import UserTier

logger = logging.getLogger("uvicorn.error")


class TierBenefitsConfig:
    """Singleton configuration loader for tier benefits."""
    
    _instance = None
    _config: dict[str, Any] | None = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    def __init__(self):
        if self._config is None:
            self._load_config()
    
    def _load_config(self) -> None:
        """Load tier_benefits.json from path specified in settings."""
        try:
            json_path = Path(settings.tier_benefits_json_path)
            
            # Support both absolute and relative paths
            if not json_path.is_absolute():
                # Relative to backend/app directory
                base_path = Path(__file__).parent.parent
                json_path = base_path / settings.tier_benefits_json_path
            
            if not json_path.exists():
                logger.error(
                    "Tier benefits JSON not found at %s. Using defaults.",
                    json_path
                )
                self._config = self._get_default_config()
                return
            
            with open(json_path, 'r', encoding='utf-8') as f:
                self._config = json.load(f)
            
            logger.info(
                "Loaded tier benefits config v%s from %s",
                self._config.get('version', 'unknown'),
                json_path
            )
        
        except Exception as e:
            logger.error(
                "Failed to load tier benefits JSON: %s. Using defaults.",
                str(e)
            )
            self._config = self._get_default_config()
    
    def _get_default_config(self) -> dict[str, Any]:
        """Fallback configuration if JSON fails to load."""
        return {
            "version": "1.0.0-fallback",
            "tiers": {
                "free": {"multipliers": {"points_earning": 1.0}},
                "premium_monthly": {"multipliers": {"points_earning": 1.0}},
                "premium_yearly": {"multipliers": {"points_earning": 1.0}},
            }
        }
    
    @property
    def config(self) -> dict[str, Any]:
        """Get the loaded configuration."""
        if self._config is None:
            self._load_config()
        return self._config or self._get_default_config()
    
    def reload(self) -> None:
        """Reload configuration from disk."""
        self._config = None
        self._load_config()


# Global singleton instance
_tier_config = TierBenefitsConfig()


def reload_tier_benefits() -> None:
    """Reload tier benefits configuration from disk.
    
    Useful for hot-reloading config changes without restarting the server.
    """
    _tier_config.reload()


def get_tier_config(tier: UserTier) -> dict[str, Any]:
    """Get configuration for a specific tier.
    
    Args:
        tier: UserTier enum value (FREE, PREMIUM_MONTHLY, PREMIUM_YEARLY)
        
    Returns:
        Dict containing all config for that tier
        
    Example:
        >>> config = get_tier_config(UserTier.PREMIUM_MONTHLY)
        >>> print(config['display_name'])
        'Premium Monthly'
    """
    tier_key = tier.value.lower()
    tiers = _tier_config.config.get('tiers', {})
    
    if tier_key not in tiers:
        logger.warning(
            "Tier %s not found in config. Using free tier defaults.",
            tier_key
        )
        return tiers.get('free', {})
    
    return tiers[tier_key]


def get_multiplier(tier: UserTier, activity_type: str) -> float:
    """Get points multiplier for a specific activity and tier.
    
    Args:
        tier: UserTier enum value
        activity_type: Type of activity (reading, ad, task, daily, bills)
        
    Returns:
        Multiplier to apply to base points (1.0 for free, 1.5-2.0 for premium)
        
    Fallback priority:
        1. tier_benefits.json multiplier
        2. .env multiplier (PREMIUM_*_MULTIPLIER)
        3. 1.0 (no multiplier)
        
    Example:
        >>> get_multiplier(UserTier.PREMIUM_MONTHLY, 'reading')
        2.0
        >>> get_multiplier(UserTier.FREE, 'reading')
        1.0
    """
    tier_config = get_tier_config(tier)
    multipliers = tier_config.get('multipliers', {})
    
    # Map activity types to multiplier keys
    multiplier_key_map = {
        'reading': 'reading_points',
        'ad': 'ad_rewards',
        'task': 'task_rewards',
        'daily': 'daily_rewards',
        'bills': 'bills_cashback',
    }
    
    multiplier_key = multiplier_key_map.get(activity_type, 'points_earning')
    multiplier = multipliers.get(multiplier_key)
    
    # Fallback to .env settings if not in JSON
    if multiplier is None:
        env_multiplier_map = {
            'reading': settings.premium_reading_multiplier,
            'ad': settings.premium_ad_multiplier,
            'task': settings.premium_task_multiplier,
            'daily': settings.premium_daily_multiplier,
            'bills': settings.premium_bills_multiplier,
        }
        multiplier = env_multiplier_map.get(activity_type, 1.0)
    
    return float(multiplier)


def get_feature_config(tier: UserTier, feature: str) -> dict[str, Any]:
    """Get feature configuration for a specific tier.
    
    Args:
        tier: UserTier enum value
        feature: Feature name (reading, ads, study_materials, etc.)
        
    Returns:
        Dict containing feature configuration
        
    Example:
        >>> config = get_feature_config(UserTier.PREMIUM_MONTHLY, 'reading')
        >>> print(config['novels']['points_per_slice'])
        4
    """
    tier_config = get_tier_config(tier)
    features = tier_config.get('features', {})
    
    if feature not in features:
        logger.warning(
            "Feature %s not found in tier %s config. Returning empty dict.",
            feature, tier.value
        )
        return {}
    
    return features[feature]


def is_content_ad_free(content_source: str | None) -> bool:
    """Check if a content source is ad-free (study materials).
    
    Args:
        content_source: Source identifier (gutenberg, openstax, gnews, etc.)
        
    Returns:
        True if content should never show ads, False otherwise
        
    Uses .env configuration:
        - AD_FREE_CONTENT_SOURCES: comma-separated list of ad-free sources
        - DEFAULT_CONTENT_AD_BEHAVIOR: fallback behavior (ad_free or ad_supported)
        
    Example:
        >>> is_content_ad_free('openstax')
        True
        >>> is_content_ad_free('gutenberg')
        False
    """
    if not content_source:
        # Unknown source - use default behavior from .env
        return settings.default_content_ad_behavior == 'ad_free'
    
    source_lower = content_source.lower().strip()
    
    # Check if source is in ad-free list from .env
    ad_free_sources = [s.lower() for s in settings.ad_free_sources_list]
    if source_lower in ad_free_sources:
        return True
    
    # Check if source is explicitly ad-supported
    ad_supported_sources = [s.lower() for s in settings.ad_supported_sources_list]
    if source_lower in ad_supported_sources:
        return False
    
    # Unknown source - use default from .env
    return settings.default_content_ad_behavior == 'ad_free'


def can_skip_ads(tier: UserTier, content_source: str | None) -> dict[str, bool]:
    """Check which ads a user can skip based on tier and content type.
    
    Args:
        tier: UserTier enum value
        content_source: Source identifier of the content
        
    Returns:
        Dict with skip permissions for different ad types
        
    Example:
        >>> can_skip_ads(UserTier.PREMIUM_MONTHLY, 'gutenberg')
        {
            'pre_read': True,
            'post_read': True,
            'feed': True,
            'is_ad_free_content': False
        }
    """
    # Study materials are ad-free for everyone
    if is_content_ad_free(content_source):
        return {
            'pre_read': True,  # No ad to skip - content is ad-free
            'post_read': True,
            'feed': True,
            'is_ad_free_content': True,
        }
    
    # Free users cannot skip ads on novels
    if tier == UserTier.FREE:
        return {
            'pre_read': False,
            'post_read': False,
            'feed': False,
            'is_ad_free_content': False,
        }
    
    # Premium users can skip ads based on .env settings
    return {
        'pre_read': settings.premium_can_skip_pre_read_ads,
        'post_read': settings.premium_can_skip_post_read_ads,
        'feed': settings.premium_can_skip_feed_ads,
        'is_ad_free_content': False,
    }


def calculate_points_for_activity(
    tier: UserTier,
    activity_type: str,
    base_points: int,
) -> int:
    """Calculate final points after applying tier multiplier.
    
    Args:
        tier: UserTier enum value
        activity_type: Type of activity (reading, ad, task, daily, bills)
        base_points: Base points before multiplier
        
    Returns:
        Final points after multiplier applied
        
    Example:
        >>> calculate_points_for_activity(UserTier.PREMIUM_MONTHLY, 'reading', 2)
        4
        >>> calculate_points_for_activity(UserTier.FREE, 'reading', 2)
        2
    """
    multiplier = get_multiplier(tier, activity_type)
    return int(base_points * multiplier)


def get_benefits_display(tier: UserTier) -> list[str]:
    """Get list of benefit descriptions for a tier (for UI display).
    
    Args:
        tier: UserTier enum value
        
    Returns:
        List of benefit description strings
        
    Example:
        >>> benefits = get_benefits_display(UserTier.PREMIUM_MONTHLY)
        >>> print(benefits[0])
        'Novels: Optional ads - Skip (4 pts) or Watch (34 pts)'
    """
    tier_config = get_tier_config(tier)
    return tier_config.get('benefits_display', [])


def get_tier_comparison() -> dict[str, Any]:
    """Get comparison table of all tiers (for pricing page).
    
    Returns:
        Dict with comparison data for free vs premium tiers
        
    Example:
        >>> comparison = get_tier_comparison()
        >>> print(comparison['reading_novels']['premium_with_ads'])
        '34 points (4 reading + 30 ad)'
    """
    return _tier_config.config.get('comparison', {})


@lru_cache(maxsize=128)
def get_expected_points_for_reading(
    tier: UserTier,
    content_source: str | None,
    watch_ads: bool,
) -> dict[str, int]:
    """Calculate expected points for reading session.
    
    Args:
        tier: UserTier enum value
        content_source: Source of content being read
        watch_ads: Whether user will watch ads
        
    Returns:
        Dict with points breakdown
        
    Example:
        >>> get_expected_points_for_reading(
        ...     UserTier.PREMIUM_MONTHLY,
        ...     'gutenberg',
        ...     watch_ads=True
        ... )
        {
            'reading_points': 4,
            'ad_points': 30,
            'total_points': 34,
            'breakdown': '4 reading + 30 ad'
        }
    """
    ad_free = is_content_ad_free(content_source)
    
    # Calculate reading points
    base_reading = settings.reading_slice_bonus_points
    reading_points = calculate_points_for_activity(tier, 'reading', base_reading)
    
    # Calculate ad points if applicable
    ad_points = 0
    if not ad_free and watch_ads:
        base_ad = settings.rewarded_ad_payout_points
        ad_points = calculate_points_for_activity(tier, 'ad', base_ad)
    
    breakdown = f"{reading_points} reading"
    if ad_points > 0:
        breakdown += f" + {ad_points} ad"
    
    return {
        'reading_points': reading_points,
        'ad_points': ad_points,
        'total_points': reading_points + ad_points,
        'breakdown': breakdown,
        'is_ad_free_content': ad_free,
    }
