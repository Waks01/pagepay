"""AdMob rewarded-ad SSV.

This is the only thing standing between "watch an ad, get SV" and a
loop that credits itself. The tests below forge signatures with a real
EC key pair so the crypto path is actually exercised rather than
mocked, and they cover the ways it must refuse: bad signature, wrong
key, unknown caller, and a replayed callback.

The shapes here follow the official SSV spec rather than what is
convenient: `transaction_id` is a hex string, and Google calls from
addresses whose reverse DNS ends in 1e100.net / dns.google /
googleusercontent.com, not googlebot.com.
"""

import base64
import os
import time
from urllib.parse import quote

import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec

_ENV = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    ".env",
)
if os.path.exists(_ENV):
    with open(_ENV) as _fh:
        for _line in _fh:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _v = _line.split("=", 1)
                os.environ.setdefault(_k.strip(), _v.strip())

from httpx import AsyncClient  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.models import StudyTransaction, User, UserTier  # noqa: E402
from app.services import admob_ssv  # noqa: E402

KEY_ID = 987654321

# AdMob's documented example transaction id: a hex string.
HEX_TRANSACTION_ID = "18fa792de1bca816048293fc71035638"

# Captured before the autouse fixture patches it, so the DNS-failure
# test can exercise the real reverse-lookup path.
_REAL_ORIGIN_IS_GOOGLE = admob_ssv.origin_is_google


@pytest.fixture
def signed():
    """A real EC key pair, the signed-content builder, and the cache."""
    private = ec.generate_private_key(ec.SECP256R1())
    admob_ssv._keys_cache = {KEY_ID: private.public_key()}
    admob_ssv._keys_fetched_at = time.time()

    def sign(content: str) -> str:
        sig = private.sign(content.encode("utf-8"), ec.ECDSA(hashes.SHA256()))
        return quote(base64.b64encode(sig).decode(), safe="")

    def build(user_id: int, txn_id: str = HEX_TRANSACTION_ID, **over) -> str:
        params = {
            "ad_network": "5450213213286189855",
            "ad_unit": "ca-app-pub-3898064484524772/4958048285",
            "custom_data": "pagepay_rewarded",
            "reward_amount": "1",
            "reward_item": "1 Point",
            "timestamp": "1791587482000",
            "transaction_id": txn_id,
            "user_id": str(user_id),
        }
        params.update(over)
        # Percent-encode every value, as AdMob does. Signing the encoded
        # form also makes the round-trip through an HTTP client
        # idempotent, so a re-encode cannot alter the signed bytes.
        pairs = [f"{k}={quote(str(v), safe='')}" for k, v in params.items()]
        content = "&".join(pairs)
        return f"{content}&signature={sign(content)}&key_id={KEY_ID}"

    yield build
    admob_ssv._keys_cache = None
    admob_ssv._keys_fetched_at = 0.0


@pytest.fixture(autouse=True)
def google_origin(monkeypatch):
    """The SSV tests use a test client, so bypass reverse DNS."""
    monkeypatch.setattr(admob_ssv, "origin_is_google", lambda ip: True)


def _auth(user_id: int) -> dict:
    from app.services.auth import create_access_token

    return {"Authorization": f"Bearer {create_access_token(user_id)}"}


# ── content construction ──────────────────────────────────────────


def test_signed_content_drops_the_trailing_two_params():
    raw = "user_id=1&reward_amount=1&ad_network=55&signature=ABC&key_id=99"
    assert admob_ssv.build_signed_content(raw) == (
        "user_id=1&reward_amount=1&ad_network=55"
    )


def test_signature_and_key_id_must_both_be_present():
    """A callback missing key_id cannot be verified.

    The content builder no longer checks this - it only finds where the
    signed content ends - so the check lives with the parser.
    """
    with pytest.raises(admob_ssv.SSVError):
        admob_ssv.split_signature_and_key_id("user_id=1&signature=ABC")


# ── the origin check ──────────────────────────────────────────────


def test_origin_accepts_the_domains_google_actually_calls_from():
    """Regression: the allowlist was googlebot.com/google.com only.

    Google's own addresses reverse-resolve to 1e100.net (Google Front
    End, which is what AdMob calls from), dns.google and
    googleusercontent.com. With the original list, every legitimate
    callback would have been rejected and no ad credit would ever have
    landed.
    """
    for host in (
        "sf-in-f34.1e100.net",
        "dns.google",
        "1.112.255.173.bc.googleusercontent.com",
        "crawl-74-125-24-34.googlebot.com",
    ):
        assert any(
            host == d or host.endswith("." + d)
            for d in admob_ssv._GOOGLE_DOMAINS
        ), f"{host} would be rejected"


def test_origin_rejects_a_non_google_host():
    assert not any(
        "evil.example.com" == d or "evil.example.com".endswith("." + d)
        for d in admob_ssv._GOOGLE_DOMAINS
    )


def test_origin_returns_none_when_dns_fails(monkeypatch):
    """A DNS failure is not the same as a non-Google host.

    The signature already proved the callback is genuine, and Google
    only retries five times - so a transient DNS failure must not cost
    the revenue permanently.
    """
    import socket

    def boom(*_a, **_k):
        raise socket.herror("no PTR record")

    monkeypatch.setattr(socket, "gethostbyaddr", boom)
    assert _REAL_ORIGIN_IS_GOOGLE("1.2.3.4") is None


# ── verification ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_valid_callback_verifies(signed):
    raw = signed(7)
    params = await admob_ssv.verify_callback(raw, "8.8.8.8")
    assert params["user_id"] == "7"
    assert params["transaction_id"] == HEX_TRANSACTION_ID


@pytest.mark.asyncio
async def test_tampered_payload_is_refused(signed):
    """Changing a value after signing must break the signature."""
    raw = signed(7)
    tampered = raw.replace("user_id=7", "user_id=8", 1)
    with pytest.raises(admob_ssv.SSVError):
        await admob_ssv.verify_callback(tampered, "8.8.8.8")


@pytest.mark.asyncio
async def test_foreign_signature_is_refused(signed):
    """A signature from a key AdMob does not publish must not verify."""
    attacker = ec.generate_private_key(ec.SECP256R1())
    content = "user_id=7&reward_amount=1&transaction_id=abc"
    sig = quote(
        base64.b64encode(
            attacker.sign(content.encode(), ec.ECDSA(hashes.SHA256()))
        ).decode(),
        safe="",
    )
    raw = f"{content}&signature={sig}&key_id={KEY_ID}"
    with pytest.raises(admob_ssv.SSVError):
        await admob_ssv.verify_callback(raw, "8.8.8.8")


@pytest.mark.asyncio
async def test_unknown_key_id_is_refused(signed):
    raw = signed(7).replace(f"key_id={KEY_ID}", "key_id=111", 1)
    with pytest.raises(admob_ssv.SSVError):
        await admob_ssv.verify_callback(raw, "8.8.8.8")


@pytest.mark.asyncio
async def test_non_google_origin_is_refused(signed, monkeypatch):
    monkeypatch.setattr(admob_ssv, "origin_is_google", lambda ip: False)
    with pytest.raises(admob_ssv.SSVError):
        await admob_ssv.verify_callback(signed(7), "1.2.3.4")


@pytest.mark.asyncio
async def test_missing_field_is_refused(signed):
    raw = signed(7)
    without_user = raw.replace("user_id=7&", "", 1)
    assert "user_id" not in without_user.split("&signature=")[0]
    with pytest.raises(admob_ssv.SSVError):
        await admob_ssv.verify_callback(without_user, "8.8.8.8")


# ── the endpoint ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_valid_callback_credits_sv(client, db_session, signed):
    user = User(email="ssv1@test.com", password_hash="h")
    user.service_credit_balance = 0
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    res = await client.get(f"/api/v1/study/ads/complete?{signed(user.id)}")
    assert res.status_code == 200

    await db_session.refresh(user)
    assert user.service_credit_balance == admob_ssv.payout_points()
    rows = (await db_session.execute(select(StudyTransaction))).scalars().all()
    assert len(rows) == 1 and rows[0].method == "ad"
    # The hex transaction id is stored verbatim - it does not fit an
    # integer column, and it is the dedupe key.
    assert rows[0].external_id == HEX_TRANSACTION_ID


@pytest.mark.asyncio
async def test_hex_transaction_id_is_accepted(client, db_session, signed):
    """Regression: the id was parsed as an int.

    AdMob's transaction_id is a hex string, so `int(...)` raised and the
    endpoint answered 400 - meaning no ad credit ever landed.
    """
    user = User(email="ssvhex@test.com", password_hash="h")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    res = await client.get(
        f"/api/v1/study/ads/complete?{signed(user.id, HEX_TRANSACTION_ID)}"
    )
    assert res.status_code == 200
    await db_session.refresh(user)
    assert user.service_credit_balance == admob_ssv.payout_points()


@pytest.mark.asyncio
async def test_callback_is_idempotent(client, db_session, signed):
    """AdMob retries up to five times, so a replay must not double-credit."""
    user = User(email="ssv2@test.com", password_hash="h")
    user.service_credit_balance = 0
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    payout = admob_ssv.payout_points()
    for _ in range(3):
        res = await client.get(f"/api/v1/study/ads/complete?{signed(user.id)}")
        assert res.status_code == 200

    await db_session.refresh(user)
    assert user.service_credit_balance == payout, "replayed callback double-credited"


@pytest.mark.asyncio
async def test_bad_signature_is_rejected_and_nothing_credited(
    client, db_session, signed
):
    user = User(email="ssv3@test.com", password_hash="h")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    raw = signed(user.id).replace(
        "ad_network=5450213213286189855", "ad_network=999"
    )
    res = await client.get(f"/api/v1/study/ads/complete?{raw}")
    assert res.status_code == 400

    rows = (await db_session.execute(select(StudyTransaction))).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_credit_never_touches_the_withdrawable_wallet(
    client, db_session, signed
):
    """An ad reward that becomes withdrawable cash is a payout the ad did
    not fund."""
    user = User(email="ssv4@test.com", password_hash="h")
    user.service_credit_balance = 0
    user.cashable_balance = 5_000
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    res = await client.get(f"/api/v1/study/ads/complete?{signed(user.id)}")
    assert res.status_code == 200
    await db_session.refresh(user)
    assert user.cashable_balance == 5_000


@pytest.mark.asyncio
async def test_unknown_user_is_acknowledged_not_credited(
    client, db_session, signed
):
    """An unknown user must not create a wallet, but AdMob should stop
    retrying - so acknowledge with 200 and log."""
    res = await client.get(f"/api/v1/study/ads/complete?{signed(999999)}")
    assert res.status_code == 200
    rows = (await db_session.execute(select(StudyTransaction))).scalars().all()
    assert rows == [], "an unknown user must not be credited"


@pytest.mark.asyncio
async def test_non_numeric_user_id_is_acknowledged_not_credited(
    client, db_session, signed
):
    """AdMob documents user_id as string-only.

    A value that is not our numeric id is simply unmatched - it must not
    be treated as a malformed callback (which would make Google retry
    five times for a request that can never succeed) and must never
    credit anyone.
    """
    res = await client.get(
        f"/api/v1/study/ads/complete?{signed('not-a-number')}"
    )
    assert res.status_code == 200
    rows = (await db_session.execute(select(StudyTransaction))).scalars().all()
    assert rows == []


def test_payout_is_the_configured_amount_and_not_the_ad_unit_label():
    """AdMob's unit is labelled '1 Point'; we pay the derived 16."""
    assert admob_ssv.payout_points() == 16


# ── the ad_unit allowlist ──────────────────────────────────────────


def test_ad_unit_allowlist_covers_live_and_test_units():
    """Both the live unit and Google's rewarded test unit must be listed.

    A dev build requests the test unit, and AdMob sends a callback for
    it too - so a test view still has to be creditable.
    """
    allowed = admob_ssv.allowed_ad_units()
    assert "ca-app-pub-3898064484524772/4958048285" in allowed
    assert "ca-app-pub-3940256099942544/5224354917" in allowed


def test_ad_unit_from_another_app_is_refused():
    """A rogue publisher's unit must not be able to mint our SV.

    The endpoint is public and AdMob's signing key is shared by every
    publisher, so without this any developer could point their own ad
    unit's callback at ours and have their users credited.
    """
    assert admob_ssv.ad_unit_is_allowed("ca-app-pub-9999999999999999/1111111111") is False
    assert admob_ssv.ad_unit_is_allowed("ca-app-pub-3898064484524772/4958048285") is True


@pytest.mark.asyncio
async def test_callback_for_a_foreign_ad_unit_is_refused(signed):
    """The signature can be perfectly valid and the ad unit still wrong."""
    raw = signed(7, ad_unit="ca-app-pub-9999999999999999/1111111111")
    with pytest.raises(admob_ssv.SSVError, match="not ours"):
        await admob_ssv.verify_callback(raw, "8.8.8.8")


# ── signature extraction follows Google's algorithm ──────────────────


def test_signature_and_key_id_are_split_like_google_does():
    """Google takes the signature from `signature=` to the `&` before
    `key_id=`, and the key id from there to the end.

    The signature comes back percent-decoded, because that is the base64
    payload itself - the content that was signed stays encoded, and it
    is the signature bytes that need decoding before verification.
    """
    raw = "a=1&signature=ABC%3D&key_id=12345"
    sig, key_id = admob_ssv.split_signature_and_key_id(raw)
    assert sig == "ABC="
    assert key_id == "12345"


def test_signature_must_be_followed_by_key_id():
    with pytest.raises(admob_ssv.SSVError):
        admob_ssv.split_signature_and_key_id("a=1&signature=ABC")


def test_content_is_everything_before_the_signature_ampersand():
    """Matches Google's `queryString.substring(0, indexOf("signature=") - 1)`."""
    raw = "a=1&b=2&signature=ABC&key_id=9"
    assert admob_ssv.build_signed_content(raw) == "a=1&b=2"


# ── the key server ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_key_fetch_follows_the_redirect(monkeypatch):
    """Regression: gstatic.com answers 301 to www.gstatic.com.

    httpx does not follow redirects by default, so the key fetch failed
    on every call and no SSV callback could ever be verified. This
    asserts the client is configured to follow.
    """
    import httpx

    seen: dict = {}

    class FakeResponse:
        status_code = 200

        def json(self):
            return {
                "keys": [
                    {
                        "keyId": 1234,
                        "pem": (
                            "-----BEGIN PUBLIC KEY-----\n"
                            "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE+nzvoGqvDeB9+SzE6igTl7"
                            "TyK4JBbglwir9oTcQta8NuG26ZpZFxt+F2NDk7asTE6/2Yc8i1ATcGI"
                            "qtuS5hv0Q==\n-----END PUBLIC KEY-----"
                        ),
                    }
                ]
            }

    class FakeClient:
        def __init__(self, **kwargs):
            seen.update(kwargs)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_a):
            return False

        async def get(self, url):
            seen["url"] = url
            return FakeResponse()

    monkeypatch.setattr(httpx, "AsyncClient", FakeClient)
    admob_ssv._reset_key_cache_for_tests()

    keys = await admob_ssv.fetch_verifier_keys(force=True)
    assert len(keys) == 1 and 1234 in keys
    assert seen.get("follow_redirects") is True, "redirects are not followed"
    admob_ssv._reset_key_cache_for_tests()
