"""AdMob rewarded-ad SSV.

This is the only thing standing between "watch an ad, get SV" and a
loop that credits itself. The tests below forge signatures with a real
EC key pair so the crypto path is actually exercised rather than
mocked, and they cover the four ways it must refuse: bad signature,
wrong key, unknown caller, and a replayed callback.
"""

import base64
import json
import os
import time

import pytest
from cryptography.hazmat.primitives import hashes, serialization
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
from urllib.parse import quote  # noqa: E402

from app.models import StudyTransaction, User, UserTier  # noqa: E402
from app.services import admob_ssv  # noqa: E402

KEY_ID = 987654321


@pytest.fixture
def signed():
    """A real EC key pair, the signed-content builder, and the cache."""
    private = ec.generate_private_key(ec.SECP256R1())
    admob_ssv._keys_cache = {KEY_ID: private.public_key()}
    admob_ssv._keys_fetched_at = time.time()

    def sign(content: str, kid: int = KEY_ID) -> str:
        sig = private.sign(content.encode("utf-8"), ec.ECDSA(hashes.SHA256()))
        return quote(base64.b64encode(sig).decode(), safe="")

    def build(user_id: int, txn_id: int, **over) -> str:
        params = {
            "user_id": user_id,
            "custom_data": "",
            "reward_amount": "1",
            "reward_item": "1 Point",
            "timestamp": "1791587482000",
            "ad_unit": "ca-app-pub-x/4958048285",
            "ad_network": "5450213213286189855",
            "transaction_id": txn_id,
        }
        params.update(over)
        # Percent-encode every value, as AdMob does. Signing the encoded
        # form also makes the round-trip through an HTTP client
        # idempotent, so a re-encode cannot alter the signed bytes.
        pairs = [f"{k}={quote(str(v), safe='')}" for k, v in params.items()]
        content = "&".join(pairs)
        sig = sign(content, over.get("_kid", KEY_ID))
        return f"{content}&signature={sig}&key_id={KEY_ID}"

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
    assert admob_ssv.build_signed_content(raw) == "user_id=1&reward_amount=1&ad_network=55"


def test_signed_content_refuses_a_query_without_key_id_last():
    with pytest.raises(admob_ssv.SSVError):
        admob_ssv.build_signed_content("user_id=1&signature=ABC")


# ── verification ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_valid_callback_verifies(signed):
    raw = signed(7, 4242)
    params = await admob_ssv.verify_callback(raw, "8.8.8.8")
    assert params["user_id"] == "7"
    assert params["transaction_id"] == "4242"


@pytest.mark.asyncio
async def test_tampered_payload_is_refused(signed):
    """Changing a value after signing must break the signature."""
    raw = signed(7, 4242)
    tampered = raw.replace("user_id=7", "user_id=8", 1)
    with pytest.raises(admob_ssv.SSVError):
        await admob_ssv.verify_callback(tampered, "8.8.8.8")


@pytest.mark.asyncio
async def test_foreign_signature_is_refused(signed):
    """A signature from a key AdMob does not publish must not verify."""
    attacker = ec.generate_private_key(ec.SECP256R1())
    content = "user_id=7&reward_amount=1&transaction_id=4242&signature=x"
    sig = base64.b64encode(
        attacker.sign(content.encode(), ec.ECDSA(hashes.SHA256()))
    ).decode()
    raw = f"{content[:-len('&signature=x')]}&signature={sig}&key_id={KEY_ID}"
    with pytest.raises(admob_ssv.SSVError):
        await admob_ssv.verify_callback(raw, "8.8.8.8")


@pytest.mark.asyncio
async def test_unknown_key_id_is_refused(signed):
    """A signature bounded to a key AdMob no longer publishes must not verify."""
    raw = signed(7, 4242).replace(f"key_id={KEY_ID}", "key_id=111", 1)
    with pytest.raises(admob_ssv.SSVError):
        await admob_ssv.verify_callback(raw, "8.8.8.8")


@pytest.mark.asyncio
async def test_non_google_origin_is_refused(signed, monkeypatch):
    monkeypatch.setattr(admob_ssv, "origin_is_google", lambda ip: False)
    with pytest.raises(admob_ssv.SSVError):
        await admob_ssv.verify_callback(signed(7, 4242), "1.2.3.4")


@pytest.mark.asyncio
async def test_missing_field_is_refused(signed):
    """Dropping a signed parameter invalidates the signature too."""
    raw = signed(7, 4242)
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

    res = await client.get(f"/api/v1/study/ads/complete?{signed(user.id, 555)}")
    assert res.status_code == 200

    await db_session.refresh(user)
    assert user.service_credit_balance == admob_ssv.payout_points()
    rows = (await db_session.execute(select(StudyTransaction))).scalars().all()
    assert len(rows) == 1 and rows[0].method == "ad"
    assert rows[0].asset_id == 555  # transaction_id is the dedupe key


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
        res = await client.get(f"/api/v1/study/ads/complete?{signed(user.id, 777)}")
        assert res.status_code == 200

    await db_session.refresh(user)
    assert user.service_credit_balance == payout, "replayed callback double-credited"


@pytest.mark.asyncio
async def test_bad_signature_is_rejected_and_nothing_credited(client, db_session, signed):
    user = User(email="ssv3@test.com", password_hash="h")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    raw = signed(user.id, 888).replace("user_id=", "user_id=", 1)
    tampered = raw.replace("ad_network=5450213213286189855", "ad_network=999")
    res = await client.get(f"/api/v1/study/ads/complete?{tampered}")
    assert res.status_code == 400

    rows = (await db_session.execute(select(StudyTransaction))).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_credit_never_touches_the_withdrawable_wallet(client, db_session, signed):
    """An ad reward that becomes withdrawable cash is a payout the ad did
    not fund."""
    user = User(email="ssv4@test.com", password_hash="h")
    user.service_credit_balance = 0
    user.cashable_balance = 5_000
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    res = await client.get(f"/api/v1/study/ads/complete?{signed(user.id, 999)}")
    assert res.status_code == 200
    await db_session.refresh(user)
    assert user.cashable_balance == 5_000


def test_payout_is_the_configured_amount_and_not_the_ad_unit_label():
    """AdMob's unit is labelled '1 Point'; we pay the derived 16."""
    assert admob_ssv.payout_points() == 16
