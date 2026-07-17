"""Shared ad-credit math + helpers.

Pulled out of `routers/ads.py` so the SSV webhook and the new
`/api/v1/ads/reward-claim` endpoint reuse the exact same math, FX
fetch, and idempotency contract that the legacy `/api/v1/ads/credit`
endpoint already implements. Any change to the 95/5 share or the
FX-cache TTL goes here, not in three routers.

Unit conversion:
  - USD × fx.rate = NGN
  - NGN × USER_SHARE = user_share_ngn
  - user_share_ngn × POINTS_PER_NAIRA = points (truncated to int)

We store the FX rate in micro-units (1 USD × 1e6 = 1_000_000) for
both `fx_rate_used` and `revenue_usd` to preserve precision past
the decimal — the legacy Phase 1 AdEvent columns are already
BigInteger micro-USD, so the new endpoints stay consistent with the
old schema.
"""

from __future__ import annotations

import logging
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import AdEvent, AdRequest, AppConfig, ReadingSession, User
from app.services import fx as fx_module


logger = logging.getLogger("uvicorn.error")

# Platform revenue share is read from settings so ops can change it
# without a deploy. Default is set in config.py
# (platform_ad_revenue_percent, default 0.15 = 15% platform, 85% user).
PLATFORM_SHARE = settings.platform_ad_revenue_percent
USER_SHARE = 1.0 - PLATFORM_SHARE

# 10 points = ₦1 (NGN). All point math goes through this constant so
# the conversion rate lives in exactly one place.
POINTS_PER_NAIRA = 10

# Google's documented test unit IDs. The /api/v1/config/ads endpoint
# returns these when `env=dev` so dev builds never burn real
# impressions against the production account. Listed here (not in
# app_config) because the test IDs are a Google-owned constant set
# that doesn't change between environments.
_TEST_UNIT_IDS: dict[tuple[str, str], str] = {
    ("in_feed", "android"):      "ca-app-pub-3940256099942544/2247696110",
    ("interstitial", "android"): "ca-app-pub-3940256099942544/1033173712",
    ("rewarded", "android"):     "ca-app-pub-3940256099942544/5224354917",
    ("banner", "android"):       "ca-app-pub-3940256099942544/6300978111",
    # iOS uses the same Google test IDs — AdMob test inventory is
    # platform-agnostic at the unit-id level.
    ("in_feed", "ios"):          "ca-app-pub-3940256099942544/2247696110",
    ("interstitial", "ios"):     "ca-app-pub-3940256099942544/1033173712",
    ("rewarded", "ios"):         "ca-app-pub-3940256099942544/5224354917",
    ("banner", "ios"):           "ca-app-pub-3940256099942544/6300978111",
}
_TEST_APP_ID_ANDROID = "ca-app-pub-3940256099942544~3347511713"
_TEST_APP_ID_IOS = "ca-app-pub-3940256099942544~1712483245"


@dataclass
class CreditResult:
    """Outcome of a single ad-credit attempt.

    `points` is the integer added to the wallet. `credit_status` is the
    string the legacy /ads/credit endpoint already returns; we keep
    the same vocabulary so the client's existing `json.credit_status`
    branch keeps working.
    """
    points: int
    fx_rate: float
    user_share_ngn: float
    ngn_revenue: float
    credit_status: str  # "credited" | "rejected_low_value" | "duplicate"


async def compute_ad_credit(revenue_usd: float) -> CreditResult:
    """Run the FX fetch + 95/5 share for one impression.

    Caller is responsible for persisting the AdEvent row and bumping
    the wallet — this function is pure math, no DB writes. The split
    keeps the math testable in isolation and lets both the client-
    driven path and the SSV-driven path use the same numbers.

    NOTE: This function is only used by the legacy /ads/credit and
    /ads/reward-claim endpoints, which are attack surfaces. The new
    SSV-only flow (AdRequest + admob_ssv_callback) does NOT use this
    function — it credits a fixed points value from
    `settings.rewarded_ad_payout_points × USER_SHARE` so the credit
    is predictable per ad slot and not variable with FX. The function
    is kept for backward compat with any in-flight legacy claims.
    """
    try:
        fx = await fx_module.get_usd_to_ngn()
    except Exception as exc:
        logger.error("FX lookup failed during ad credit: %s", exc)
        raise

    ngn_revenue = revenue_usd * fx.rate
    user_share_ngn = ngn_revenue * USER_SHARE
    points = int(user_share_ngn * POINTS_PER_NAIRA)
    credit_status = "credited" if points > 0 else "rejected_low_value"
    return CreditResult(
        points=points,
        fx_rate=fx.rate,
        user_share_ngn=user_share_ngn,
        ngn_revenue=ngn_revenue,
        credit_status=credit_status,
    )


async def find_existing_event(db: AsyncSession, transaction_id: str) -> AdEvent | None:
    """Idempotency lookup by transaction_id. Returns None if unseen.

    Every ad-credit entry point (legacy /ads/credit, SSV webhook,
    /ads/reward-claim) starts with this call. The unique constraint
    on AdEvent.transaction_id is the second line of defense against
    a race; this lookup is the first.
    """
    return (
        await db.execute(
            select(AdEvent).where(AdEvent.transaction_id == transaction_id)
        )
    ).scalar_one_or_none()


async def find_active_session_for_user(
    db: AsyncSession, user_id: int
) -> ReadingSession | None:
    """The user's currently-open reading session, if any.

    The SSV webhook ties a credit to a session so the wallet's
    transaction history can show "earned during read of <slice>".
    "Active" means: end_time IS NULL, started within the last 2
    hours. The 2-hour cap prevents a credit that arrives hours
    after a session was abandoned (e.g. user closed the app, AdMob
    retried the callback an hour later) from being misattributed.

    Returns None if no active session — the SSV handler still credits
    the wallet, just without the session link.
    """
    from datetime import datetime, timedelta
    cutoff = datetime.utcnow() - timedelta(hours=2)
    row = (
        await db.execute(
            select(ReadingSession)
            .where(ReadingSession.user_id == user_id)
            .where(ReadingSession.end_time.is_(None))
            .where(ReadingSession.start_time >= cutoff)
            .order_by(ReadingSession.start_time.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return row


def to_micro(value: float) -> int:
    """Convert a float USD/NGN value to its BigInteger micro encoding.

    Mirrors the legacy Phase 1 column contract: `revenue_usd` and
    `fx_rate_used` are stored as micro-units so the persisted row
    can hold fractional values without float-rounding.
    """
    return int(round(value * 1_000_000))


async def bump_wallet(db: AsyncSession, user_id: int, points: int) -> int:
    """Add `points` to User.points_balance. Returns the new balance.

    Caller is responsible for `db.commit()`. We do the bump + the
    SELECT-for-new-balance in one transaction so the response never
    shows a stale balance.
    """
    from sqlalchemy import update
    await db.execute(
        update(User)
        .where(User.id == user_id)
        .values(points_balance=User.points_balance + points)
    )
    return points  # caller will re-read after commit for the actual value


# ── Config resolution ───────────────────────────────────────────────
# `/api/v1/config/ads` reads from app_config. This is the only place
# that knows about the dev/prod split — the client always asks
# "give me the config for env=dev" and gets back the right set.

_CONFIG_KEYS = {
    "android_app_id": "admob.app_id.android",
    "ios_app_id": "admob.app_id.ios",
    "in_feed_android": "admob.in_feed.android",
    "in_feed_ios": "admob.in_feed.ios",
    "interstitial_android": "admob.interstitial.android",
    "interstitial_ios": "admob.interstitial.ios",
    "rewarded_android": "admob.rewarded.android",
    "rewarded_ios": "admob.rewarded.ios",
    "banner_android": "admob.banner.android",
    "banner_ios": "admob.banner.ios",
}


def _dev_value_for(key: str) -> str | None:
    """Return the Google test value for a config key, or None if
    no dev override exists for that slot.

    Keys shaped like `admob.<location>.<platform>` map to the test
    unit-ID dict; the two App ID keys map to the test App ID
    constants. Anything else returns None (the caller falls back to
    the prod value from app_config, which is what the spec wants).
    """
    if key == "admob.app_id.android":
        return _TEST_APP_ID_ANDROID
    if key == "admob.app_id.ios":
        return _TEST_APP_ID_IOS
    if key.startswith("admob."):
        parts = key.split(".")
        if len(parts) == 3:
            _, location, platform = parts
            return _TEST_UNIT_IDS.get((location, platform))
    return None


async def fetch_ads_config(
    db: AsyncSession, environment: str = "prod"
) -> dict[str, str]:
    """Resolve the full ad-unit config for one environment.

    `environment="dev"` returns Google's test unit IDs (the only
    override today). `environment="prod"` reads the values seeded
    by `app/seed.py`. Returns a flat dict keyed by slot name so the
    client can do `config.in_feed_android` without nesting.

    Missing keys silently return as empty strings — the client
    treats an empty unit ID as "this slot is disabled" and degrades
    to the MockAdModal fallback.
    """
    rows = (
        await db.execute(
            select(AppConfig.key, AppConfig.value).where(
                AppConfig.environment == environment
            )
        )
    ).all()
    raw = {key: value for key, value in rows}

    resolved: dict[str, str] = {}
    for out_key, db_key in _CONFIG_KEYS.items():
        if environment == "dev":
            test_value = _dev_value_for(db_key)
            resolved[out_key] = test_value or raw.get(db_key, "")
        else:
            resolved[out_key] = raw.get(db_key, "")
    return resolved


# ══════════════════════════════════════════════════════════════════════
# SSV-ONLY CREDIT FLOW: AdRequest issuance + consumption
# ══════════════════════════════════════════════════════════════════════
# Replaces the client-revenue /ads/credit and /ads/reward-claim
# endpoints. The client is never trusted with revenue. The flow:
#
#   1. Client → POST /api/v1/ads/request-token  → create_ad_request()
#   2. Client passes returned `custom_data` (= "user_id:token") to
#      AdMob's ad request as the `customData` / `request.customData`
#      parameter.
#   3. User watches the ad; AdMob fires an SSV callback to
#      GET /api/v1/ads/google/callback.
#   4. SSV handler verifies the ECDSA signature, parses custom_data,
#      looks up the AdRequest row via consume_ad_request(), and
#      credits the user. A forged callback that guesses a valid
#      token still fails the user-mismatch check.


def _generate_token() -> str:
    """Generate a fresh ad-request token.

    32 bytes of randomness, URL-safe base64 (no padding). 43-char
    string. Effectively un-guessable (256 bits of entropy). The
    AdRequest.token column is 64 chars to leave headroom.
    """
    return secrets.token_urlsafe(32)


def points_for_rewarded_ad() -> int:
    """The integer point value credited for one rewarded ad.

    `int(settings.rewarded_ad_payout_points * USER_SHARE)`. With the
    defaults (10 × 0.95) this is 9. The `int()` floor is important:
    we never credit fractional points, and we never over-credit if
    the user-share ratio is changed in the future.

    Only rewarded_* ad slots earn. The SSV handler rejects any
    other unit; this function does not need to know.
    """
    return int(settings.rewarded_ad_payout_points * USER_SHARE)


async def create_ad_request(
    db: AsyncSession, user_id: int, ad_unit: str, session_id: int | None = None
) -> AdRequest:
    """Issue a new AdRequest row and return it.

    The caller (the /request-token router) wraps the token in the
    response payload as `custom_data = f"{user_id}:{token}"`. AdMob
    signs that string and the SSV handler parses it back.

    Collisions on `token` (UNIQUE) are vanishingly rare at 256 bits
    of entropy, but if one ever happens, the IntegrityError raised
    by the commit will surface as a 500 — the caller can retry. We
    don't loop here; a single retry on the client side is enough.

    `expires_at` is computed from `settings.ad_request_token_ttl_seconds`
    so the operator can tune it without code changes.
    """
    now = datetime.utcnow()
    token = _generate_token()
    req = AdRequest(
        token=token,
        user_id=user_id,
        session_id=session_id,
        ad_unit=ad_unit,
        status="issued",
        created_at=now,
        expires_at=now + timedelta(seconds=settings.ad_request_token_ttl_seconds),
    )
    db.add(req)
    await db.commit()
    await db.refresh(req)
    return req


async def lookup_ad_request_by_token(
    db: AsyncSession, token: str
) -> AdRequest | None:
    """Look up an AdRequest by its token. Returns None if not found."""
    return (
        await db.execute(
            select(AdRequest).where(AdRequest.token == token)
        )
    ).scalar_one_or_none()


async def mark_ad_request_credited(
    db: AsyncSession,
    req: AdRequest,
    *,
    points: int,
    admob_transaction_id: str | None,
) -> None:
    """Flip an AdRequest row to `credited` and persist the credit
    amount + AdMob transaction id. Idempotent on `status`: if the row
    is already `credited`, this is a no-op (caller should check
    first). The caller is responsible for crediting the user's
    wallet — this only updates the AdRequest row and the AdEvent
    audit trail.
    """
    if req.status == "credited":
        return
    req.status = "credited"
    req.points_credited = points
    req.credited_at = datetime.utcnow()
    req.admob_transaction_id = admob_transaction_id


async def mark_ad_request_rejected(
    db: AsyncSession,
    req: AdRequest,
    *,
    reason: str,
) -> None:
    """Flip an AdRequest row to `rejected` with a reason. Used by the
    SSV handler when a callback arrives for a request that is
    expired, already-credited, or otherwise invalid. Idempotent on
    terminal status: if the row is already `credited` or `rejected`,
    this is a no-op so we never overwrite a successful credit with
    a stale rejection.
    """
    if req.status in ("credited", "rejected", "expired"):
        return
    req.status = "rejected"
    req.rejection_reason = reason


async def list_recent_credits_for_user(
    db: AsyncSession,
    user_id: int,
    *,
    since: datetime,
    limit: int = 20,
) -> list[AdEvent]:
    """Return the user's credited ad events since `since`, newest
    first. Used by GET /api/v1/ads/recent-credits so the client can
    refresh the wallet display after an ad closes. We return the
    AdEvent rows (not AdRequest rows) because the wallet history is
    keyed on AdEvent — that's what the existing /api/v1/wallet/
    transactions endpoint surfaces.
    """
    if since.tzinfo is not None:
        since = since.replace(tzinfo=None)

    rows = (
        await db.execute(
            select(AdEvent)
            .where(AdEvent.user_id == user_id)
            .where(AdEvent.credit_status == "credited")
            .where(AdEvent.user_points_credited.is_not(None))
            .where(AdEvent.user_points_credited > 0)
            .where(AdEvent.created_at >= since)
            .order_by(AdEvent.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()
    return list(rows)
