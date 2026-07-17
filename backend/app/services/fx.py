"""Live USD→NGN exchange rate lookup.

Why this exists: ad networks (AdMob, AppLovin MAX) report revenue in USD.
Our reward math is denominated in NGN and points (10 pts = ₦1). We must
not hardcode an FX rate — NGN/USD fluctuates daily and the user (operator)
must not lose money to stale rates.

We use open.er-api.com (free, no API key, supports ~150 currencies). The
endpoint is `GET https://open.er-api.com/v6/latest/USD` and returns
`{"result": "success", "rates": {"NGN": 1379.45, ...}, ...}`.

We cache the rate for 60s. The TTL balances two concerns:
  - Too short: we hammer the public endpoint.
  - Too long: a market move during the TTL silently under/over-credits.

On any network/parse failure we raise — the caller (ads router) MUST
handle the failure by rejecting the credit rather than crediting at a
stale or zero rate.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import httpx


# open.er-api.com — public, no key. Returns latest rates keyed off base USD.
_FX_URL = "https://open.er-api.com/v6/latest/USD"
_CACHE_TTL_SECONDS = 60
_HTTP_TIMEOUT_SECONDS = 5.0


@dataclass
class FxRate:
    """Snapshot of the USD→NGN rate at the moment we fetched it.

    `fetched_at` is a monotonic-clock timestamp so the TTL check is
    robust to wall-clock skew (system time changes won't make a stale
    rate look fresh).
    """
    rate: float              # multiplier: USD × rate = NGN
    fetched_at: float        # time.monotonic()
    source: str              # upstream URL, for audit logs


_cache: FxRate | None = None


async def get_usd_to_ngn() -> FxRate:
    """Return the current USD→NGN rate, fetching from upstream if the
    cache is stale.

    Raises httpx.HTTPError or ValueError on upstream failure — callers
    MUST NOT swallow these silently; they should reject the credit.
    """
    global _cache
    now = time.monotonic()
    if _cache is not None and (now - _cache.fetched_at) < _CACHE_TTL_SECONDS:
        return _cache

    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_SECONDS) as client:
        resp = await client.get(_FX_URL)
        resp.raise_for_status()
        body = resp.json()

    if body.get("result") != "success":
        raise ValueError(f"FX endpoint returned non-success: {body}")
    rates = body.get("rates") or {}
    ngn_raw = rates.get("NGN")
    if ngn_raw is None:
        raise ValueError("FX response missing NGN rate")
    rate = float(ngn_raw)
    if rate <= 0:
        raise ValueError(f"FX returned non-positive NGN rate: {rate}")

    _cache = FxRate(rate=rate, fetched_at=now, source=_FX_URL)
    return _cache


def reset_cache_for_tests() -> None:
    """Test hook: clear the in-process cache so the next call re-fetches.

    Not exposed to production callers — pytest uses this to assert against
    a fresh rate between cases.
    """
    global _cache
    _cache = None
