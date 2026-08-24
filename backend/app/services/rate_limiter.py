"""Redis-based rate limiter for bill purchases.

Enforces daily and hourly caps per user per service to prevent abuse,
fraud, and accidental over-spending. Throttle limits are configurable
via environment variables.

Default limits per service (airtime, data, electricity, etc.):
- Hourly: 10 purchases
- Daily: 50 purchases

Returns 429 Too Many Requests with reset time when exceeded.
"""

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Literal

import redis.asyncio as redis
from fastapi import HTTPException

from app.config import settings

logger = logging.getLogger("uvicorn.error")

# Redis client (lazy-initialized)
_redis_client: redis.Redis | None = None


async def get_redis() -> redis.Redis:
    """Get or create Redis client for rate limiting."""
    global _redis_client
    if _redis_client is None:
        redis_url = getattr(settings, 'redis_url', 'redis://localhost:6379/0')
        _redis_client = redis.from_url(redis_url, encoding="utf-8", decode_responses=True)
    return _redis_client


# Service-specific rate limits (purchases per period)
RATE_LIMITS = {
    "airtime": {"hourly": 10, "daily": 50},
    "data": {"hourly": 10, "daily": 50},
    "electricity": {"hourly": 5, "daily": 20},
    "tv": {"hourly": 5, "daily": 20},
    "recharge_pin": {"hourly": 5, "daily": 30},
    "betting": {"hourly": 10, "daily": 40},
    "isp_smile": {"hourly": 5, "daily": 15},
    "isp_spectranet": {"hourly": 5, "daily": 15},
    "education": {"hourly": 10, "daily": 40},
    "sms": {"hourly": 3, "daily": 10},
}


async def check_rate_limit(
    user_id: int,
    service: str,
    period: Literal["hourly", "daily"] = "hourly"
) -> tuple[bool, int | None]:
    """Check if user has exceeded rate limit for a service.
    
    Args:
        user_id: User ID
        service: Service type (airtime, data, etc.)
        period: Rate limit period (hourly or daily)
        
    Returns:
        (allowed, reset_seconds): allowed=True if under limit, 
        reset_seconds=time until limit resets (None if allowed)
    """
    # Get limits for this service
    limits = RATE_LIMITS.get(service, {"hourly": 10, "daily": 50})
    limit = limits.get(period, 10)
    
    # Redis key: rate_limit:user:{user_id}:{service}:{period}
    key = f"rate_limit:user:{user_id}:{service}:{period}"
    
    # TTL for key (1 hour or 24 hours)
    ttl_seconds = 3600 if period == "hourly" else 86400
    
    try:
        r = await get_redis()
        
        # Get current count
        count_str = await r.get(key)
        count = int(count_str) if count_str else 0
        
        if count >= limit:
            # Rate limit exceeded
            ttl = await r.ttl(key)
            reset_seconds = ttl if ttl > 0 else ttl_seconds
            return False, reset_seconds
        
        # Increment counter
        pipe = r.pipeline()
        pipe.incr(key)
        pipe.expire(key, ttl_seconds)
        await pipe.execute()
        
        return True, None
        
    except Exception as exc:
        logger.error("Rate limiter Redis error: %s", exc)
        # Fail open - allow request if Redis is down
        return True, None


async def enforce_rate_limits(user_id: int, service: str):
    """Enforce both hourly and daily rate limits for a purchase.
    
    Raises HTTPException(429) if either limit is exceeded.
    """
    # Check hourly limit
    allowed_hourly, reset_hourly = await check_rate_limit(user_id, service, "hourly")
    if not allowed_hourly:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "Rate limit exceeded",
                "message": f"You've reached the hourly {service} purchase limit. Try again in {reset_hourly // 60} minutes.",
                "reset_seconds": reset_hourly,
                "limit_type": "hourly"
            }
        )
    
    # Check daily limit
    allowed_daily, reset_daily = await check_rate_limit(user_id, service, "daily")
    if not allowed_daily:
        hours = reset_daily // 3600
        raise HTTPException(
            status_code=429,
            detail={
                "error": "Rate limit exceeded",
                "message": f"You've reached the daily {service} purchase limit. Try again in {hours} hours.",
                "reset_seconds": reset_daily,
                "limit_type": "daily"
            }
        )


async def get_remaining_quota(user_id: int, service: str) -> dict:
    """Get remaining purchase quota for a service.
    
    Returns:
        {
            "hourly_remaining": int,
            "hourly_limit": int,
            "daily_remaining": int,
            "daily_limit": int,
            "hourly_reset_seconds": int,
            "daily_reset_seconds": int,
        }
    """
    limits = RATE_LIMITS.get(service, {"hourly": 10, "daily": 50})
    
    try:
        r = await get_redis()
        
        # Get hourly count
        hourly_key = f"rate_limit:user:{user_id}:{service}:hourly"
        hourly_count_str = await r.get(hourly_key)
        hourly_count = int(hourly_count_str) if hourly_count_str else 0
        hourly_ttl = await r.ttl(hourly_key)
        hourly_ttl = hourly_ttl if hourly_ttl > 0 else 3600
        
        # Get daily count
        daily_key = f"rate_limit:user:{user_id}:{service}:daily"
        daily_count_str = await r.get(daily_key)
        daily_count = int(daily_count_str) if daily_count_str else 0
        daily_ttl = await r.ttl(daily_key)
        daily_ttl = daily_ttl if daily_ttl > 0 else 86400
        
        return {
            "hourly_remaining": max(0, limits["hourly"] - hourly_count),
            "hourly_limit": limits["hourly"],
            "daily_remaining": max(0, limits["daily"] - daily_count),
            "daily_limit": limits["daily"],
            "hourly_reset_seconds": hourly_ttl,
            "daily_reset_seconds": daily_ttl,
        }
        
    except Exception as exc:
        logger.error("Rate limiter Redis error: %s", exc)
        # Return default values if Redis fails
        return {
            "hourly_remaining": limits["hourly"],
            "hourly_limit": limits["hourly"],
            "daily_remaining": limits["daily"],
            "daily_limit": limits["daily"],
            "hourly_reset_seconds": 3600,
            "daily_reset_seconds": 86400,
        }
