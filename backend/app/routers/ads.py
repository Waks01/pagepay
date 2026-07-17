"""Ad reward credit + Phase 2 ad-infrastructure endpoints.

POST /api/v1/ads/credit            — DEPRECATED 410 Gone (legacy client-revenue path)
POST /api/v1/ads/impression        — DEPRECATED 410 Gone (legacy pending-impression log)
POST /api/v1/ads/reward-claim      — DEPRECATED 410 Gone (legacy SDK-callback credit)
POST /api/v1/ads/request-token     — NEW: issue one-time ad-request token
GET  /api/v1/ads/recent-credits    — NEW: poll for credited ad events
GET  /api/v1/ads/google/callback   — AdMob SSV webhook (ECDSA verified)
POST /api/v1/ads/applovin/callback — AppLovin SSV webhook (stub)

The /ads/credit and /ads/reward-claim endpoints accepted a client-
supplied `revenue_usd` value and credited points based on it. They
were attack surfaces: an authenticated client could mint arbitrary
NGN-equivalent points by fabricating a transaction_id and a
revenue_usd. They are now 410 Gone stubs — new code uses
/ads/request-token + the SSV callback flow (see
`create_ad_request` and `mark_ad_request_credited` in
app/services/ads.py).

Adding a new ad network (AppLovin MAX) is a matter of writing its
callback handler and pointing it at the same `mark_ad_request_*`
helpers — the credit/audit path is already network-agnostic.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.limiter import limiter
from app.models import AdEvent, AdRequest, ReadingSession, User
from app.routers.auth import get_current_user
from app.schemas import (
    AdCreditRequest,
    AdCreditResponse,
    AdImpressionRequest,
    AdImpressionResponse,
    AdRecentCredit,
    AdRequestTokenRequest,
    AdRequestTokenResponse,
    AdRewardClaimRequest,
    AdRewardClaimResponse,
)
from app.services import ads as ads_service


logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/ads", tags=["ads"])


# Platform revenue share is read from settings so ops can change it
# without a deploy. Default is set in config.py
# (platform_ad_revenue_percent, default 0.15 = 15% platform, 85% user).
PLATFORM_SHARE = settings.platform_ad_revenue_percent
USER_SHARE = 1.0 - PLATFORM_SHARE

# 10 points = ₦1 (NGN). All point math goes through this constant so
# the conversion rate lives in exactly one place.
POINTS_PER_NAIRA = 10


# ── POST /ads/request-token — NEW: SSV-only credit flow entry ─────


@router.post("/credit", response_model=AdCreditResponse)  # legacy: removed body, kept stub
async def credit_ad_reward(
    payload: AdCreditRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AdCreditResponse:
    """DEPRECATED — returns 410. Use POST /ads/request-token + SSV."""
    raise HTTPException(  # pragma: no cover
        status_code=410,
        detail=(
            "This endpoint is deprecated and will be removed. "
            "Use POST /api/v1/ads/request-token + the AdMob SSV "
            "callback to credit ad rewards."
        ),
    )


@router.post("/impression", response_model=AdImpressionResponse)  # legacy
async def log_ad_impression(
    payload: AdImpressionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AdImpressionResponse:
    """DEPRECATED — returns 410. Use POST /ads/request-token + SSV."""
    raise HTTPException(  # pragma: no cover
        status_code=410,
        detail=(
            "This endpoint is deprecated and will be removed. "
            "Use POST /api/v1/ads/request-token + the AdMob SSV "
            "callback to track ad impressions."
        ),
    )


@router.post("/reward-claim", response_model=AdRewardClaimResponse)  # legacy
async def claim_ad_reward(
    payload: AdRewardClaimRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AdRewardClaimResponse:
    """DEPRECATED — returns 410. Use POST /ads/request-token + SSV."""
    raise HTTPException(  # pragma: no cover
        status_code=410,
        detail=(
            "This endpoint is deprecated and will be removed. "
            "Use POST /api/v1/ads/request-token + the AdMob SSV "
            "callback to credit rewarded ad views."
        ),
    )


# ── POST /ads/request-token — NEW: SSV-only credit flow entry ─────
# The client calls this just before showing a rewarded ad. The server
# issues a one-time AdRequest row, returns the token wrapped in
# `custom_data` for the client to pass to AdMob. The AdMob-signed
# SSV callback later consumes this row to credit the user. See the
# module docstring for the full flow.


@limiter.limit(f"{settings.ad_request_rate_limit_per_minute}/minute")
@router.post("/request-token", response_model=AdRequestTokenResponse, status_code=201)
async def issue_ad_request_token(
    request: Request,
    payload: AdRequestTokenRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AdRequestTokenResponse:
    """Issue a one-time ad-request token for the authenticated user.

    The client must:
      1. Read ad unit IDs from GET /api/v1/ads/config (no hardcoding).
      2. Pick a rewarded_* unit (in-feed / interstitial earn zero).
      3. POST here with that unit name to get a `token` + `custom_data`.
      4. Pass `custom_data` to AdMob's ad request (`customData` on
         Android, `request.customData` on iOS).
      5. After the ad closes, poll GET /api/v1/ads/recent-credits
         with the timestamp from before the ad to see if the credit
         landed.

    Rate-limited at `settings.ad_request_rate_limit_per_minute`
    requests per minute per IP (slowapi key is the remote address).
    This caps attacker token-stuffing without blocking a heavy
    legit user (heavy users watch 10-20 ads/day, well under 30/min).
    """
    if not payload.ad_unit.startswith("rewarded_"):
        # The SSV handler will also reject non-rewarded units, but
        # fail fast here so the client gets a clear 400 instead of
        # a token that will never be honored.
        raise HTTPException(
            status_code=400,
            detail=(
                "Only rewarded_* ad units earn points. "
                f"Got '{payload.ad_unit}'; expected a unit starting with 'rewarded_'."
            ),
        )

    req = await ads_service.create_ad_request(
        db=db, user_id=current_user.id, ad_unit=payload.ad_unit, session_id=payload.session_id
    )

    # `custom_data` is the single piece of state the client carries
    # into the AdMob SDK. AdMob signs it as part of the SSV payload,
    # so the server can trust it on the way back.
    custom_data = f"{current_user.id}:{req.token}"

    logger.info(
        "Issued ad-request token user=%s unit=%s id=%s expires_at=%s",
        current_user.id, req.ad_unit, req.id, req.expires_at,
    )

    return AdRequestTokenResponse(
        token=req.token,
        custom_data=custom_data,
        ad_unit=req.ad_unit,
        expires_at=req.expires_at,
        # The actual ad unit ID (e.g. "ca-app-pub-.../...") is resolved
        # by the client from /api/v1/ads/config; we don't echo it back
        # here because the /request-token endpoint is unit-name-keyed
        # and the config endpoint is the single source of truth for
        # unit IDs. Returning it would be a duplication risk.
        ad_unit_id=None,
    )


# ── GET /ads/recent-credits — NEW: poll for credited ad events ─────
# After the client shows a rewarded ad, it polls this endpoint with
# the timestamp from before the ad opened. The endpoint returns the
# AdEvent rows that have been credited since then, including the
# updated wallet balance. The client uses this to update the wallet
# display without trusting any client-side value.


@router.get("/recent-credits", response_model=list[AdRecentCredit])
async def list_recent_credits(
    since: datetime = Query(..., description="ISO 8601 timestamp. Returns credits created at or after this time."),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[AdRecentCredit]:
    """Return the authenticated user's credited ad events since `since`.

    `since` is required (not optional with a default) so a client
    bug that omits the parameter fails loudly instead of returning
    the full history. The client should pass the timestamp captured
    just before showing the ad.

    `new_balance` on each row is the user's points_balance at the
    time the row was credited (re-read from `AdEvent.created_at` so
    it's consistent even if other credits have arrived in the
    meantime). The client should treat the LAST row's `new_balance`
    as the freshest value and re-render the wallet.
    """
    rows = await ads_service.list_recent_credits_for_user(
        db, current_user.id, since=since, limit=limit
    )

    if not rows:
        return []

    # Fetch the user's CURRENT balance once, not per row. The
    # per-row `new_balance` is computed at credit time and stored
    # in the AdEvent row's created_at ordering; the LAST row's
    # value is the freshest authoritative balance, but for client
    # display we also surface the live balance.
    me = (
        await db.execute(select(User.points_balance).where(User.id == current_user.id))
    ).scalar_one()

    out: list[AdRecentCredit] = []
    for event in rows:
        out.append(
            AdRecentCredit(
                ad_event_id=event.id,
                ad_unit=event.ad_unit or "",
                points_credited=event.user_points_credited or 0,
                credited_at=event.created_at,
                new_balance=me,
            )
        )

    return out


# ── POST /ads/fill-rate-event — Track ad lifecycle for fill rate analytics ───


@router.post("/fill-rate-event", status_code=201)
async def log_fill_rate_event(
    ad_request_id: str = Query(..., description="Client-generated UUID tracking this ad through its lifecycle"),
    ad_unit: str = Query(..., description="Ad unit name (e.g., rewarded_android)"),
    stage: str = Query(..., description="Stage: requested, loaded, shown, completed, failed"),
    error_code: str | None = Query(None, description="Error code if stage=failed"),
    error_message: str | None = Query(None, description="Error message if stage=failed"),
    session_id: int | None = Query(None, description="Reading session ID if applicable"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Log ad lifecycle events for fill rate tracking and analytics.
    
    Client should call this at each stage of the ad lifecycle:
    1. 'requested' - User tapped "Watch Ad" button
    2. 'loaded' - Ad finished loading (AdEventType.LOADED)
    3. 'shown' - Ad started playing
    4. 'completed' - User finished watching (rewarded ad only)
    5. 'failed' - Ad failed to load/show (AdEventType.ERROR)
    
    The same ad_request_id should be used across all stages for one ad.
    Admin dashboard uses this to calculate fill rate funnel metrics.
    """
    from app.models import AdFillRateEvent
    
    # Validate stage
    valid_stages = {"requested", "loaded", "shown", "completed", "failed"}
    if stage not in valid_stages:
        raise HTTPException(status_code=400, detail=f"Invalid stage. Must be one of: {valid_stages}")
    
    event = AdFillRateEvent(
        user_id=current_user.id,
        session_id=session_id,
        ad_request_id=ad_request_id,
        ad_unit=ad_unit,
        stage=stage,
        error_code=error_code,
        error_message=error_message,
    )
    
    db.add(event)
    await db.commit()
    
    logger.debug(
        "Fill rate event: user=%s ad_request=%s unit=%s stage=%s",
        current_user.id, ad_request_id, ad_unit, stage,
    )
    
    return {"status": "logged", "ad_request_id": ad_request_id, "stage": stage}


# ── POST /ads/google/callback — AdMob SSV webhook ──────────────────
# AdMob Server-Side Verification callback. AdMob sends a GET request
# with query parameters containing the reward data and an ECDSA P-256
# signature. We verify the signature against Google's published public
# keys, then credit the user's wallet.
#
# Reference: https://developers.google.com/admob/ios/rewarded-video-ssv
#            https://developers.google.com/admob/android/rewarded-video-ssv
#
# AdMob retries on non-2xx, so we return 200 in all cases except
# signature failure (401). Idempotent on transaction_id.


import json as _json

import httpx


# Cache Google's SSV public keys so we don't fetch them on every callback.
# Keys are rotated rarely — a 24-hour cache is safe.
_GOOGLE_VERIFIER_KEYS: dict[str, str] | None = None
_VERIFIER_KEYS_URL = "https://www.gstatic.com/admob/reward/verifier-keys.json"
_VERIFIER_KEYS_TTL_SECONDS = 86400
_last_keys_fetch: float = 0


def _invalidate_verifier_keys() -> None:
    """Force a fresh key fetch on the next callback."""
    global _GOOGLE_VERIFIER_KEYS, _last_keys_fetch
    _GOOGLE_VERIFIER_KEYS = None
    _last_keys_fetch = 0


async def _fetch_verifier_keys() -> dict[str, str]:
    """Fetch and cache Google's ECDSA P-256 public keys for AdMob SSV.

    Returns a dict mapping key_id → PEM-encoded public key string.
    Cached in memory for 24 hours. Falls back to stale cache on failure.
    """
    global _GOOGLE_VERIFIER_KEYS, _last_keys_fetch
    now = __import__('time').time()
    if _GOOGLE_VERIFIER_KEYS is not None and (now - _last_keys_fetch) < _VERIFIER_KEYS_TTL_SECONDS:
        return _GOOGLE_VERIFIER_KEYS

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(_VERIFIER_KEYS_URL)
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("Failed to fetch AdMob verifier keys: %s", exc)
        if _GOOGLE_VERIFIER_KEYS is not None:
            return _GOOGLE_VERIFIER_KEYS
        raise

    keys: dict[str, str] = {}
    try:
        # Response shape: {"keys": [{"keyId": 3335741209, "pem": "...", "base64": "..."}, ...]}
        # keyId is an integer from Google but AdMob sends it as a string — store as string.
        for entry in data.get("keys", []):
            kid = str(entry.get("keyId", ""))
            pem = entry.get("pem")
            if kid and pem:
                keys[kid] = pem
    except Exception as exc:
        logger.error("Failed to parse AdMob verifier keys: %s", exc)
        raise

    if not keys:
        logger.error("No valid AdMob verifier keys found in response")
        raise ValueError("No valid keys")

    _GOOGLE_VERIFIER_KEYS = keys
    _last_keys_fetch = now
    return keys


async def _verify_admob_ssv_signature(
    query_params: dict[str, str],
    raw_query_string: str,
) -> bool:
    """Verify the ECDSA P-256 signature on an AdMob SSV callback.

    Per Google's official docs:
    - The signed content is the query parameters EXCEPT `signature`
      and `key_id`, sorted alphabetically by key, then URL-encoded.
    - The signature is base64url-encoded DER format.
    """
    signature_b64 = query_params.get("signature")
    key_id = query_params.get("key_id")
    if not signature_b64 or not key_id:
        return False

    # Decode signature: base64url, pad to multiple of 4.
    import base64
    padded_sig = signature_b64 + "==="
    try:
        signature = base64.urlsafe_b64decode(padded_sig)
    except Exception:
        return False

    # Reconstruct the signed content: all query params except
    # `signature` and `key_id`, sorted alphabetically and URL-encoded.
    try:
        query_data = {}
        for k, v in query_params.items():
            if k in ("signature", "key_id"):
                continue
            query_data[k] = v

        sorted_items = sorted(query_data.items())
        sorted_query_string = "&".join(
            f"{k}={v}" for k, v in sorted_items
        )
        signed_data = sorted_query_string
    except Exception:
        return False

    try:
        keys = await _fetch_verifier_keys()
        if key_id not in keys:
            logger.warning("AdMob SSV: unknown key_id=%s", key_id)
            logger.debug("AdMob SSV available key_ids: %s", list(keys.keys())[:10])
            return False

        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.primitives import serialization, hashes
        from cryptography.hazmat.backends import default_backend

        pem_data = keys[key_id].encode("utf-8")
        public_key = serialization.load_pem_public_key(pem_data, backend=default_backend())

        logger.debug(
            "AdMob SSV verifying: key_id=%s, signed_data=%r, signature_len=%d",
            key_id,
            signed_data[:200],
            len(signature),
        )

        try:
            public_key.verify(
                signature,
                signed_data.encode("utf-8"),
                ec.ECDSA(hashes.SHA256()),
            )
            logger.info("AdMob SSV: verification succeeded for key_id=%s tx=%s", key_id, query_params.get("transaction_id"))
            return True
        except Exception as first_exc:
            logger.warning(
                "AdMob SSV: first verification attempt failed for key_id=%s: %s. "
                "Refreshing verifier keys and retrying...",
                key_id,
                first_exc,
            )
            _invalidate_verifier_keys()
            fresh_keys = await _fetch_verifier_keys()
            if key_id not in fresh_keys:
                logger.error("AdMob SSV: key_id %s still missing after refresh", key_id)
                raise
            fresh_pem = fresh_keys[key_id].encode("utf-8")
            fresh_key = serialization.load_pem_public_key(fresh_pem, backend=default_backend())
            try:
                fresh_key.verify(
                    signature,
                    signed_data.encode("utf-8"),
                    ec.ECDSA(hashes.SHA256()),
                )
                logger.info("AdMob SSV: verification succeeded after key refresh for key_id=%s tx=%s", key_id, query_params.get("transaction_id"))
                return True
            except Exception as retry_exc:
                logger.error(
                    "AdMob SSV: verification still failed after key refresh for key_id=%s: %s",
                    key_id,
                    retry_exc,
                )
                raise
    except Exception as exc:
        logger.error(
            "AdMob SSV signature verification failed: %s: %s",
            type(exc).__name__,
            exc,
        )
        logger.debug(
            "AdMob SSV signed data (key_id=%s): %r",
            key_id,
            signed_data[:500],
        )
        return False


@router.get("/google/callback")
async def admob_ssv_callback(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """AdMob SSV webhook — GET request with query parameters.

    AdMob sends a GET to this URL with the reward data as query params:
      ?ad_network=...&ad_unit=...&reward_amount=...&user_id=...&transaction_id=...
       &signature=...&key_id=...&custom_data=<f"{user_id}:{token}">

    This is the ONLY path that credits points. The flow is:

      1. Client got a `custom_data` value from POST /api/v1/ads/request-token.
      2. Client passed that custom_data to AdMob's ad request.
      3. AdMob echoes the custom_data back in this callback, signed.
      4. We verify the signature (401 on failure — never proceed with
         a callback that doesn't prove it's from AdMob).
      5. We parse custom_data to get (user_id, token), look up the
         AdRequest row, validate user_id matches and ad_unit is
         rewarded, and credit the user.

    Returns:
      - 200 `{"status": "verification_success"}` on empty GET (AdMob
        connectivity test, no signature to verify)
      - 200 `{"status": "credited", ...}` on successful credit
      - 200 `{"status": "duplicate", ...}` if the AdRequest was
        already credited
      - 200 `{"status": "ignored", "reason": ...}` for benign
        rejections (unknown token, expired, malformed custom_data)
      - 401 on signature failure
      
    Every callback attempt (success or failure) is logged to ad_ssv_logs
    for admin monitoring and debugging.
    """
    from app.models import AdSsvLog
    
    # Get both decoded params (for reading values) and raw query string (for
    # signature verification — AdMob signs the URL-encoded form, not decoded).
    raw_query_bytes = request.scope.get("query_string", b"") or b""
    raw_query_string = raw_query_bytes.decode("utf-8", errors="replace")
    query_params = {k: v for k, v in request.query_params.items()}

    if not query_params:
        return {"status": "verification_success"}

    # Helper to log SSV attempts to database
    async def log_ssv_attempt(
        user_id: int | None,
        token: str | None,
        status: str,
        rejection_reason: str | None = None,
        points_credited: int | None = None,
    ):
        log_entry = AdSsvLog(
            user_id=user_id,
            token=token,
            transaction_id=query_params.get("transaction_id"),
            ad_unit=query_params.get("ad_unit"),
            status=status,
            rejection_reason=rejection_reason,
            raw_query_params=query_params,
            points_credited=points_credited,
        )
        db.add(log_entry)
        # Don't await commit here — we'll commit with the main transaction

    # ── 1. Signature verification ─────────────────────────────────
    # CRITICAL: bad signature → 401, do NOT continue.
    is_valid = await _verify_admob_ssv_signature(query_params, raw_query_string)
    if not is_valid:
        logger.warning(
            "AdMob SSV: signature verification failed for tx=%s. Params: %s",
            query_params.get("transaction_id", "unknown"),
            query_params,
        )
        await log_ssv_attempt(
            user_id=None,
            token=None,
            status="signature_failed",
            rejection_reason="ECDSA P-256 signature verification failed",
        )
        await db.commit()
        raise HTTPException(status_code=401, detail="Invalid SSV signature")

    # ── 2. Parse custom_data = "user_id:token" ─────────────────────
    custom_data = query_params.get("custom_data", "")
    if ":" not in custom_data:
        logger.warning("AdMob SSV: missing or malformed custom_data: %r", custom_data)
        await log_ssv_attempt(
            user_id=None,
            token=None,
            status="malformed_custom_data",
            rejection_reason=f"custom_data missing or invalid: {custom_data!r}",
        )
        await db.commit()
        return {"status": "ignored", "reason": "missing_custom_data"}
    
    try:
        user_id_str, token = custom_data.split(":", 1)
        user_id = int(user_id_str)
    except (ValueError, AttributeError) as e:
        logger.warning("AdMob SSV: malformed custom_data: %r", custom_data)
        await log_ssv_attempt(
            user_id=None,
            token=None,
            status="malformed_custom_data",
            rejection_reason=f"Failed to parse custom_data: {e}",
        )
        await db.commit()
        return {"status": "ignored", "reason": "malformed_custom_data"}

    transaction_id = query_params.get("transaction_id", "")
    ad_unit_from_callback = query_params.get("ad_unit", "")

    # ── 3. Look up AdRequest by token ──────────────────────────────
    req = await ads_service.lookup_ad_request_by_token(db, token)
    if req is None:
        logger.warning("AdMob SSV: unknown token (user=%s, tx=%s)", user_id, transaction_id)
        await log_ssv_attempt(
            user_id=user_id,
            token=token,
            status="unknown_token",
            rejection_reason=f"No AdRequest found for token {token}",
        )
        await db.commit()
        return {"status": "ignored", "reason": "unknown_token"}

    # ── 4. Validate the callback matches what we issued ───────────
    if req.user_id != user_id:
        logger.warning(
            "AdMob SSV: user mismatch (token_user=%s, custom_data_user=%s, tx=%s)",
            req.user_id, user_id, transaction_id,
        )
        await log_ssv_attempt(
            user_id=user_id,
            token=token,
            status="user_mismatch",
            rejection_reason=f"Token issued to user {req.user_id}, callback claims user {user_id}",
        )
        await db.commit()
        return {"status": "ignored", "reason": "user_mismatch"}

    # Already-credited: idempotent no-op
    if req.status == "credited":
        await log_ssv_attempt(
            user_id=user_id,
            token=token,
            status="duplicate",
            rejection_reason="AdRequest already credited",
            points_credited=req.points_credited or 0,
        )
        await db.commit()
        return {
            "status": "duplicate",
            "points_credited": req.points_credited or 0,
        }

    # Expired or already rejected
    if req.status != "issued" or req.expires_at < datetime.utcnow():
        await ads_service.mark_ad_request_rejected(db, req, reason="expired_or_invalid")
        await log_ssv_attempt(
            user_id=user_id,
            token=token,
            status="expired",
            rejection_reason=f"AdRequest status={req.status}, expired={req.expires_at < datetime.utcnow()}",
        )
        await db.commit()
        return {"status": "ignored", "reason": "expired_or_invalid"}

    # ── 5. Validate ad_unit is rewarded-only ──────────────────────
    if not req.ad_unit.startswith("rewarded_"):
        await ads_service.mark_ad_request_rejected(db, req, reason="non_rewarded_unit")
        await log_ssv_attempt(
            user_id=user_id,
            token=token,
            status="non_rewarded_unit",
            rejection_reason=f"ad_unit {req.ad_unit} is not a rewarded unit",
        )
        await db.commit()
        logger.info(
            "AdMob SSV: non-rewarded ad_unit=%s (user=%s, tx=%s) — no credit",
            req.ad_unit, user_id, transaction_id,
        )
        return {"status": "ignored", "reason": "non_rewarded_unit"}

    # Optional sanity check
    if ad_unit_from_callback and ad_unit_from_callback != req.ad_unit:
        logger.warning(
            "AdMob SSV: ad_unit mismatch (issued=%s, callback=%s, user=%s, tx=%s)",
            req.ad_unit, ad_unit_from_callback, user_id, transaction_id,
        )

    # ── 6. Credit the user or session ────────────────────────────────
    raw_reward = query_params.get("reward_amount")
    try:
        reward_amount = int(raw_reward) if raw_reward is not None else 0
    except (TypeError, ValueError):
        reward_amount = 0

    if reward_amount <= 0:
        logger.warning(
            "AdMob SSV: non-positive reward_amount=%r for tx=%s user=%s",
            raw_reward, transaction_id, user_id,
        )
        await ads_service.mark_ad_request_rejected(db, req, reason="invalid_reward_amount")
        await log_ssv_attempt(
            user_id=user_id,
            token=token,
            status="invalid_reward_amount",
            rejection_reason=f"reward_amount={raw_reward!r} is not positive",
        )
        await db.commit()
        return {"status": "ignored", "reason": "invalid_reward_amount"}

    points = int(reward_amount * USER_SHARE)

    # Mark the AdRequest as credited (audit trail)
    await ads_service.mark_ad_request_credited(
        db, req, points=points, admob_transaction_id=transaction_id or None
    )

    if req.session_id:
        # Bundle reward into the reading session instead of global balance
        session_claimed = False
        if req.session_id:
            session_row = await db.execute(
                select(ReadingSession.claimed_at).where(ReadingSession.id == req.session_id)
            )
            session_claimed = session_row.scalar_one_or_none() is not None

        if session_claimed:
            await db.execute(
                update(User)
                .where(User.id == user_id)
                .values(points_balance=User.points_balance + points)
            )
            logger.info(
                "AdMob SSV: late credit -> wallet user=%s session=%s pts=%d",
                user_id, req.session_id, points,
            )
        else:
            await db.execute(
                update(ReadingSession)
                .where(ReadingSession.id == req.session_id)
                .values(pending_points=ReadingSession.pending_points + points)
            )
            logger.info(
                "AdMob SSV: session credit user=%s session=%s pts=%d",
                user_id, req.session_id, points,
            )
    else:
        # Fallback: credit the global wallet immediately
        await db.execute(
            update(User)
            .where(User.id == user_id)
            .values(points_balance=User.points_balance + points)
        )
        logger.info(
            "AdMob SSV: global credit user=%s pts=%d",
            user_id, points,
        )

    # Insert the AdEvent row for audit trail and wallet history
    event = AdEvent(
        user_id=user_id,
        session_id=req.session_id,
        ad_unit=req.ad_unit,
        ad_type="rewarded",
        provider="admob",
        watched_fully=True,
        reward_granted=True,
        transaction_id=transaction_id or None,
        revenue_usd=None,
        fx_rate_used=None,
        user_points_credited=points,
        credit_status="credited",
    )
    db.add(event)
    
    # Log successful SSV callback
    await log_ssv_attempt(
        user_id=user_id,
        token=token,
        status="success",
        rejection_reason=None,
        points_credited=points,
    )
    
    await db.commit()

    me = (
        await db.execute(select(User.points_balance).where(User.id == user_id))
    ).scalar_one()

    logger.info(
        "AdMob SSV credit: user=%s unit=%s tx=%s pts=%d balance=%d",
        user_id, req.ad_unit, transaction_id, points, me,
    )

    return {
        "status": "credited",
        "points_credited": points,
        "new_balance": me,
    }


# ── POST /ads/applovin/callback — AppLovin SSV webhook (stub) ──────
# AppLovin MAX uses a different secret and a different payload
# shape (server-to-server postback with `currency` and `revenue`
# fields). When AppLovin integration is wired, this endpoint will
# mirror the AdMob one with the matching signature scheme. Until
# then, return 501 so AppLovin's dashboard doesn't silently
# swallow failures.


@router.post("/applovin/callback")
async def applovin_ssv_callback() -> dict:
    """AppLovin MAX SSV webhook — not yet implemented.

    Returns 501 so the AppLovin dashboard shows the endpoint is
    reachable but unwired. The contract (idempotency on
    transaction_id, FX-fetched credit math) is already in
    place via the shared `ads_service` — adding the AppLovin
    payload parser + signature scheme is the only work left.
    """
    raise HTTPException(
        status_code=501,
        detail="AppLovin SSV not yet implemented. Wire the postback secret in app/config.py and add the payload parser.",
    )
