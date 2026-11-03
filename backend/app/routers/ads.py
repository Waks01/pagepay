"""AdMob ads endpoints: request tokens, SSV callback, recent credits, config."""
import json
import logging
import socket
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlencode

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, padding
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.services.auth import get_current_user
from app.models import AdRequest, AdSsvLog, User

logger = logging.getLogger(__name__)

router = APIRouter()

KEYS_URL = "https://gstatic.com/admob/reward/verifier-keys.json"
_keys_cache: dict = {"fetched_at": None, "keys": []}


async def _fetch_keys() -> list[dict]:
    now = datetime.now(timezone.utc)
    if _keys_cache["fetched_at"] and (now - _keys_cache["fetched_at"]).total_seconds() < 86400:
        return _keys_cache["keys"]
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=10.0) as client:
            resp = await client.get(KEYS_URL)
            resp.raise_for_status()
            data = resp.json()
            keys = data.get("keys", [])
            _keys_cache["keys"] = keys
            _keys_cache["fetched_at"] = now
            return keys
    except Exception as exc:
        logger.warning("Failed to fetch AdMob verifier keys: %s", exc)
        return _keys_cache["keys"]


def _origin_is_google(ip: str) -> bool | None:
    try:
        host = socket.gethostbyaddr(ip)[0]
    except Exception:
        return None
    google_suffixes = (".google.com", ".1e100.net", ".googleusercontent.com", "dns.google")
    return any(host.endswith(s) or host == s.lstrip(".") for s in google_suffixes)


def _verify_signature(query_string: str, signature_b64: str, key_id: int, keys: list[dict]) -> bool:
    key_entry = next((k for k in keys if k.get("keyId") == key_id), None)
    if not key_entry:
        return False
    try:
        public_key = serialization.load_pem_public_key(key_entry["pem"].encode())
        # drop last two params (signature, key_id)
        parts = query_string.split("&")
        if len(parts) >= 2:
            parts = parts[:-2]
        message = "&".join(parts).encode("utf-8")
        import base64
        sig = base64.b64decode(signature_b64)
        public_key.verify(sig, message, ec.ECDSA(hashes.SHA256()))
        return True
    except Exception as exc:
        logger.warning("SSV signature verification failed: %s", exc)
        return False


@router.get("/config/ads")
async def config_ads():
    return {
        "environment": settings.environment,
        "rewarded_ad_payout_points": settings.rewarded_ad_payout_points,
        "units": {
            "rewarded": "ca-app-pub-3898064484524772/4958048285",
            "banner": "ca-app-pub-3898064484524772/7400111898",
            "native": "ca-app-pub-3898064484524772/6538723260",
        },
    }


@router.post("/ads/request-token")
async def request_token(
    payload: dict,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    token = str(uuid.uuid4())
    ad_unit = payload.get("ad_unit", "rewarded")
    session_id = payload.get("session_id")
    use_case = payload.get("use_case")
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=settings.ad_request_token_ttl_seconds)
    req = AdRequest(
        token=token,
        user_id=current_user.id,
        session_id=session_id,
        ad_unit=ad_unit,
        status="pending",
        created_at=datetime.now(timezone.utc),
        expires_at=expires_at,
        use_case=use_case,
    )
    db.add(req)
    await db.commit()
    return {"token": token, "custom_data": token, "expires_at": expires_at.isoformat()}


@router.get("/ads/google/callback")
async def google_ssv_callback(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    params = dict(request.query_params)
    signature = params.get("signature")
    key_id = params.get("key_id")
    if not signature or not key_id:
        raise HTTPException(status_code=400, detail="missing signature/key_id")

    query_string = request.url.query
    keys = await _fetch_keys()

    # origin check
    client_ip = request.client.host if request.client else ""
    origin_ok = _origin_is_google(client_ip)
    if origin_ok is False:
        logger.warning("SSV origin not Google: %s", client_ip)
        raise HTTPException(status_code=403, detail="invalid origin")

    try:
        key_id_int = int(key_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="bad key_id")

    if not _verify_signature(query_string, signature, key_id_int, keys):
        # log rejection
        log = AdSsvLog(
            user_id=None,
            token=params.get("custom_data"),
            transaction_id=params.get("transaction_id"),
            ad_unit=params.get("ad_unit"),
            status="rejected",
            rejection_reason="signature_verification_failed",
            raw_query_params=params,
            created_at=datetime.now(timezone.utc),
        )
        db.add(log)
        await db.commit()
        raise HTTPException(status_code=400, detail="invalid signature")

    transaction_id = params.get("transaction_id")
    # dedupe
    if transaction_id:
        existing = await db.execute(
            select(AdSsvLog).where(AdSsvLog.transaction_id == transaction_id, AdSsvLog.status == "credited")
        )
        if existing.scalar_one_or_none():
            return {"status": "already_credited"}

    user_id_raw = params.get("user_id")
    try:
        user_id = int(user_id_raw) if user_id_raw is not None else None
    except (ValueError, TypeError):
        user_id = None

    token = params.get("custom_data")
    ad_unit = params.get("ad_unit")

    points = settings.rewarded_ad_payout_points
    if user_id is not None:
        user_result = await db.execute(select(User).where(User.id == user_id))
        user = user_result.scalar_one_or_none()
        if user is not None:
            user.service_credit_balance = (user.service_credit_balance or 0) + points
            db.add(user)

    log = AdSsvLog(
        user_id=user_id,
        token=token,
        transaction_id=transaction_id,
        ad_unit=ad_unit,
        status="credited",
        points_credited=points,
        raw_query_params=params,
        created_at=datetime.now(timezone.utc),
    )
    db.add(log)

    # update AdRequest if token matches
    if token:
        req_result = await db.execute(select(AdRequest).where(AdRequest.token == token))
        req = req_result.scalar_one_or_none()
        if req is not None:
            req.status = "credited"
            req.points_credited = points
            req.credited_at = datetime.now(timezone.utc)
            req.admob_transaction_id = transaction_id
            db.add(req)

    await db.commit()
    return {"status": "ok"}


@router.get("/ads/recent-credits")
async def recent_credits(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=5)
    result = await db.execute(
        select(AdSsvLog).where(
            AdSsvLog.user_id == current_user.id,
            AdSsvLog.status == "credited",
            AdSsvLog.created_at >= cutoff,
        ).order_by(AdSsvLog.created_at.desc())
    )
    rows = result.scalars().all()
    return {
        "credits": [
            {
                "transaction_id": r.transaction_id,
                "points_credited": r.points_credited,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]
    }
