"""AdMob rewarded-ad Server-Side Verification (SSV).

This is the authority for "the user actually watched the ad, credit
them". Without it, crediting per ad is trivially farmable — a script
POSTs to the credit endpoint in a loop. Everything below follows the
algorithm in the AdMob SSV docs (and admob.md §4.6):

1. Fetch the verifier public keys, cache them for at most 24h because
   they rotate.
2. Build the signed content: the raw query string with the last two
   parameters (signature, key_id — appended last by Google) removed,
   URL-decoding nothing, as UTF-8 bytes in order.
3. Verify ECDSA P-256 / SHA-256 / DER with the key named by key_id.
4. Confirm the caller's origin by reverse DNS is Google-owned.
5. Respond 200, and treat a replayed callback as a no-op.

Two PagePay rules layered on top:

- The credit lands in `service_credit_balance`, never the withdrawable
  side. An ad reward that becomes withdrawable cash is a payout we have
  not earned the margin on — the same guard as bills commission and the
  premium allowance.
- The amount is `settings.rewarded_ad_payout_points`, which is *derived*
  from `rewarded_ad_gross_points` and `platform_ad_revenue_percent`.
  The client's claim, and the `reward_amount` AdMob echoes back, are
  both ignored: AdMob's own reward label on the unit is cosmetic and
  was configured as "1 Point", which is not what we pay.
"""

from __future__ import annotations

import base64
import binascii
import logging
import socket
import time
from functools import lru_cache
from urllib.parse import parse_qsl, unquote

import httpx
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

from app.config import settings

logger = logging.getLogger("uvicorn.error")

_KEYS_URL = "https://gstatic.com/admob/reward/verifier-keys.json"
_KEYS_TTL_SECONDS = 24 * 60 * 60  # rotate; the docs cap the cache at 24h

# Reverse-DNS suffixes that identify a Google-owned host.
#
# These were taken from live reverse lookups of the addresses Google
# actually calls from, not guessed. The first version of this file
# allowed only `googlebot.com` and `google.com`, which would have
# rejected every real AdMob callback:
#
#   8.8.8.8            -> dns.google
#   74.125.24.34        -> sf-in-f34.1e100.net
#   142.250.185.78      -> fra16s48-in-f14.1e100.net
#   216.58.200.49       -> tsa01s08-in-f17.1e100.net
#   173.255.112.1       -> .bc.googleusercontent.com
#
# `1e100.net` is Google Front End - the range AdMob's SSV calls come
# from - so excluding it would have silently lost every ad credit.
_GOOGLE_DOMAINS = (
    "googlebot.com",
    "google.com",
    "1e100.net",
    "dns.google",
    "googleusercontent.com",
)

_keys_cache: dict | None = None
_keys_fetched_at: float = 0.0


class SSVError(Exception):
    """Verification failed. Never a partial credit."""


# ── keys ──────────────────────────────────────────────────────────


async def fetch_verifier_keys(force: bool = False) -> dict[int, ec.EllipticCurvePublicKey]:
    """Return {keyId: public key}, cached for at most 24h.

    Raises SSVError on a transport failure or a payload we cannot use,
    so a caller cannot accidentally treat "no keys" as verified.
    """
    global _keys_cache, _keys_fetched_at

    if not force and _keys_cache is not None and (time.time() - _keys_fetched_at) < _KEYS_TTL_SECONDS:
        return _keys_cache

    try:
        # gstatic.com answers 301 to www.gstatic.com, and httpx does
        # not follow redirects by default - without this the key fetch
        # failed on every single call.
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.get(_KEYS_URL)
            if resp.status_code != 200:
                raise SSVError(f"verifier-keys HTTP {resp.status_code}")
            payload = resp.json()
    except SSVError:
        raise
    except Exception as exc:
        raise SSVError(f"verifier-keys unreachable: {exc}") from exc

    entries = payload.get("keys")
    if not isinstance(entries, list) or not entries:
        raise SSVError("verifier-keys payload has no keys")

    keys: dict[int, ec.EllipticCurvePublicKey] = {}
    for entry in entries:
        try:
            key_id = int(entry["keyId"])
            pem = entry["pem"]
        except (KeyError, TypeError, ValueError):
            continue
        try:
            keys[key_id] = serialization.load_pem_public_key(pem.encode())
        except Exception:
            continue

    if not keys:
        raise SSVError("verifier-keys contained no usable keys")

    _keys_cache = keys
    _keys_fetched_at = time.time()
    return keys


def _reset_key_cache_for_tests() -> None:
    """Test-only: drop the key cache so each test fetches fresh."""
    global _keys_cache, _keys_fetched_at
    _keys_cache = None
    _keys_fetched_at = 0.0


# ── verification ──────────────────────────────────────────────────

_SIGNATURE_PARAM = "signature="
_KEY_ID_PARAM = "key_id="


def build_signed_content(raw_query: str) -> str:
    """The bytes AdMob actually signed: the query up to `signature=`.

    This follows Google's reference implementation exactly rather than
    assuming a parameter order. Google takes the query string, finds the
    first literal `signature=`, and keeps everything before the `&` that
    precedes it:

        i = queryString.indexOf("signature=")
        content = queryString.substring(0, i - 1)

    The docs also state that the last two parameters are always
    `signature` and `key_id` in that order, so the two agree for a
    well-formed callback - but following the reference implementation
    means an unusual-but-valid callback is still verified against the
    bytes that were signed, rather than being rejected outright.

    Nothing is URL-decoded: the signature covers the bytes as sent, so
    decoding first would verify a different string.
    """
    i = raw_query.find(_SIGNATURE_PARAM)
    if i == -1:
        raise SSVError("query has no signature parameter")
    if i == 0:
        raise SSVError("signature is the first parameter")
    # i - 1 drops the '&' that separates the content from `signature=`.
    return raw_query[: i - 1]


def split_signature_and_key_id(raw_query: str) -> tuple[str, str]:
    """Extract (signature, key_id) the way Google's reference code does.

    The signature runs from `signature=` to the `&` before `key_id=`.

    The signature is returned percent-decoded, because that is the
    base64 payload itself - the *content* that was signed stays in its
    encoded form, and it is the signature bytes that need decoding
    before they can be verified.
    """
    i = raw_query.find(_SIGNATURE_PARAM)
    if i == -1:
        raise SSVError("query has no signature parameter")
    sig_and_key = raw_query[i:]
    j = sig_and_key.find(_KEY_ID_PARAM)
    if j == -1:
        raise SSVError("query has no key_id parameter")
    signature = sig_and_key[len(_SIGNATURE_PARAM) : j - 1]
    key_id = sig_and_key[j + len(_KEY_ID_PARAM) :]
    if not signature:
        raise SSVError("empty signature")
    if not key_id:
        raise SSVError("empty key_id")
    # The signature travels as a base64 string in a URL, so its '+' and
    # '/' arrive percent-encoded. Unquote before base64-decoding.
    return unquote(signature), unquote(key_id)


async def verify_signature(content: str, signature_b64: str, key_id: int) -> None:
    """ECDSA P-256 / SHA-256 / DER. Raises SSVError on any failure."""
    keys = await fetch_verifier_keys()
    if key_id not in keys:
        raise SSVError(f"unknown key_id {key_id}")
    try:
        signature = base64.b64decode(signature_b64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise SSVError("signature is not valid base64") from exc
    try:
        keys[key_id].verify(
            signature, content.encode("utf-8"), ec.ECDSA(hashes.SHA256())
        )
    except InvalidSignature as exc:
        raise SSVError("signature did not verify") from exc


def origin_is_google(ip: str) -> bool | None:
    """Reverse-DNS the caller and check for a Google-owned suffix.

    Returns True for Google, False for a resolvable non-Google host, and
    None when the lookup itself failed.

    None is deliberately distinct from False. The ECDSA signature is the
    real gate - only Google holds the private key - so a DNS timeout or
    an unresolvable PTR must not cost the revenue: Google re-sends a
    callback five times and then gives up, so a blocked-but-valid
    callback is a permanently lost credit. A host that *does* resolve to
    something non-Google is genuinely suspicious and is refused.
    """
    if not ip:
        return False
    try:
        hostname = socket.gethostbyaddr(ip)[0]
    except Exception:
        return None
    hostname = hostname.lower().rstrip(".")
    return any(
        hostname == domain or hostname.endswith("." + domain)
        for domain in _GOOGLE_DOMAINS
    )


async def verify_callback(raw_query: str, client_ip: str) -> dict:
    """Verify one SSV callback. Returns the parsed params.

    Raises SSVError on any failure. Performs the signature check first
    (needs no DNS) and the origin check last (slow, best-effort), so an
    obvious forgery is refused without a reverse lookup.
    """
    params = dict(parse_qsl(raw_query, keep_blank_values=True))
    for field in ("user_id", "reward_amount", "transaction_id", "ad_unit"):
        if field not in params:
            raise SSVError(f"missing {field}")

    content = build_signed_content(raw_query)
    # Pull the signature and key_id out of the raw query the way Google's
    # reference code does, rather than trusting the decoded params -
    # the signature is over the encoded bytes.
    signature_b64, key_id_raw = split_signature_and_key_id(raw_query)
    try:
        key_id = int(key_id_raw)
    except ValueError as exc:
        raise SSVError("key_id not an integer") from exc

    await verify_signature(content, signature_b64, key_id)

    # The callback must be for an ad unit we own. The signing key is
    # shared across every AdMob publisher, so without this a rogue
    # publisher could point their own ad unit at this URL and mint SV
    # for arbitrary PagePay accounts.
    if not ad_unit_is_allowed(params["ad_unit"]):
        raise SSVError(f"ad_unit {params['ad_unit']!r} is not ours")

    origin = origin_is_google(client_ip)
    if origin is False:
        # The host resolved to something that is not Google's. Refuse.
        raise SSVError("caller did not resolve to a Google domain")
    if origin is None:
        # The lookup itself failed. The signature already proved this is
        # Google, and Google only retries five times - so log it and
        # let the credit through rather than losing the revenue to a
        # transient DNS failure.
        logger.warning(
            "AdMob SSV from %s: reverse DNS failed, allowing on the "
            "strength of the verified signature",
            client_ip,
        )

    return params


def payout_points() -> int:
    """SV to credit per verified view. Server-owned, never the client's."""
    amount = int(settings.rewarded_ad_payout_points)
    if amount <= 0:
        raise SSVError("rewarded_ad_payout_points is not configured")
    return amount


def allowed_ad_units() -> set[str]:
    """Ad unit ids we accept a callback for.

    The SSV endpoint is public and the signing key is shared by every
    AdMob publisher, so without this check any developer could point
    their own ad unit's callback URL at ours and have their users
    credited with PagePay SV - a minting vector, not a theft one, but
    still unbounded free balance.

    Google's own guidance is to check the `ad_unit` in the callback
    against the ad unit you expect.
    """
    from app.config import settings as _settings

    units = {
        u.strip()
        for u in str(_settings.rewarded_ad_unit_ids or "").split(",")
        if u.strip()
    }
    return units


def ad_unit_is_allowed(ad_unit: str) -> bool:
    """True when the callback is for an ad unit we own.

    An empty allowlist means "not configured", which is treated as
    refusing rather than allowing - a fail-open check here would
    reinstate the minting vector.
    """
    allowed = allowed_ad_units()
    if not allowed:
        return False
    return ad_unit in allowed
