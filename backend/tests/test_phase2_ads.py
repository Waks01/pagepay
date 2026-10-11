"""Phase 2 ad-infrastructure tests.

Covers the still-relevant ad surfaces:
  1. /api/v1/config/ads        — dev returns Google test IDs, prod
                                 returns the seeded PagePay IDs
  2. Sponsored-every-4th rotation in build_feed_with_sponsored
  3. /api/v1/ads/applovin/callback — 501 stub (not yet wired)

The /api/v1/ads/impression, /api/v1/ads/reward-claim, and HMAC
AdMob SSV tests were removed in the ad-system security hardening
pass (Task #3). The new ECDSA + server-token flow is fully covered
by tests/test_ads_credit.py.
"""

from __future__ import annotations

import pytest

from app.models import AppConfig
from app.routers.content import build_feed_with_sponsored
from app.services import fx as fx_service


# Static FX rate the math tests use. Pinning the rate means a
# $0.001 ad credits exactly 120 points at 1500 NGN/USD, which
# keeps the assertions human-readable.
STATIC_FX_RATE = 1500.0


def _stub_fx(monkeypatch, rate: float = STATIC_FX_RATE) -> None:
    """Patch get_usd_to_ngn with a deterministic rate."""
    fx_service.reset_cache_for_tests()

    async def fake_get_usd_to_ngn():
        return fx_service.FxRate(rate=rate, fetched_at=0.0, source="test")

    monkeypatch.setattr(fx_service, "get_usd_to_ngn", fake_get_usd_to_ngn)


async def _register_and_login(client, email: str) -> dict[str, str]:
    """Register a fresh user and return auth headers."""
    r = await client.post("/api/v1/auth/register", json={
        "email": email, "password": "secure1234",
    })
    assert r.status_code == 201, r.text
    token = r.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _make_content_row(id_: int, *, sponsored: bool = False) -> "object":
    """Build a lightweight stand-in for a ContentCatalog row.

    We don't need a real DB row to exercise the rotation helper —
    the function only reads attributes, never queries. This
    keeps the test fast and decoupled from the ORM.
    """
    from types import SimpleNamespace
    return SimpleNamespace(
        id=id_,
        title=f"item-{id_}",
        is_sponsored=sponsored,
    )


# ── 1. Sponsored rotation helper ──────────────────────────────────
# The `build_feed_with_sponsored` function is the engine of the
# feed endpoint. These tests pin the contract: sponsored appears
# at positions [interval, 2*interval, ...] in the output, organic
# items are dropped from the tail to keep the length constant,
# and the per-user shuffle is deterministic.

def test_sponsored_every_4th_inserts_at_position_4_8_12():
    organic = [_make_content_row(i) for i in range(1, 13)]  # 12 items
    sponsored = [_make_content_row(100 + i, sponsored=True) for i in range(5)]
    out = build_feed_with_sponsored(organic, sponsored, user_id=42, every=4)
    # 12 organic → 12 - (12//4) = 9 organic + 3 sponsored = 12 total
    assert len(out) == 12
    sponsored_positions = [i for i, item in enumerate(out) if item.is_sponsored]
    assert sponsored_positions == [3, 7, 11]  # 0-indexed → 4th, 8th, 12th
    # All sponsored items in the output came from the input
    assert all(item in sponsored for item in out if item.is_sponsored)


def test_sponsored_rotation_disabled_when_every_zero():
    organic = [_make_content_row(i) for i in range(1, 11)]
    sponsored = [_make_content_row(100 + i, sponsored=True) for i in range(5)]
    out = build_feed_with_sponsored(organic, sponsored, user_id=42, every=0)
    # No rotation → organic list unchanged, no sponsored items injected
    assert out == list(organic)
    assert all(not item.is_sponsored for item in out)


def test_sponsored_rotation_skipped_when_no_inventory():
    organic = [_make_content_row(i) for i in range(1, 11)]
    out = build_feed_with_sponsored(organic, sponsored=[], user_id=42, every=4)
    assert out == list(organic)


def test_sponsored_rotation_per_user_is_deterministic():
    """Same user → same shuffle on every call. The per-user seed
    makes the ad order stable across requests so back-button
    navigation doesn't shuffle the feed under the user.
    """
    organic = [_make_content_row(i) for i in range(1, 11)]
    sponsored = [_make_content_row(100 + i, sponsored=True) for i in range(8)]
    out_a = build_feed_with_sponsored(organic, sponsored, user_id=7, every=4)
    out_b = build_feed_with_sponsored(organic, sponsored, user_id=7, every=4)
    assert [item.id for item in out_a] == [item.id for item in out_b]


def test_sponsored_rotation_per_user_differs_across_users():
    """Two different users with the same inventory see different
    sponsored orderings — the per-user seed gives each user a
    unique shuffle.
    """
    organic = [_make_content_row(i) for i in range(1, 11)]
    sponsored = [_make_content_row(100 + i, sponsored=True) for i in range(8)]
    out_user_a = build_feed_with_sponsored(organic, sponsored, user_id=1, every=4)
    out_user_b = build_feed_with_sponsored(organic, sponsored, user_id=2, every=4)
    # The sponsored item ids will likely differ at the same
    # positions. We assert the shuffles are not identical — exact
    # position depends on the seed and a stable test would
    # require pinning the seed, which we don't want to commit.
    sponsored_ids_a = [item.id for item in out_user_a if item.is_sponsored]
    sponsored_ids_b = [item.id for item in out_user_b if item.is_sponsored]
    assert sponsored_ids_a != sponsored_ids_b


def test_sponsored_rotation_caps_at_max_sponsored():
    """More sponsored inventory than `max_sponsored` → only the
    first N (post-shuffle) appear in the output.
    """
    organic = [_make_content_row(i) for i in range(1, 21)]  # 20 items
    sponsored = [_make_content_row(100 + i, sponsored=True) for i in range(50)]
    out = build_feed_with_sponsored(
        organic, sponsored, user_id=42, every=4, max_sponsored=2
    )
    # 20 organic → 20 - (20//4) = 15 organic + 2 sponsored = 17
    # The cap trims the slot count further: 20 // 4 = 5 slots,
    # but max_sponsored=2 means at most 2 sponsored items.
    sponsored_count = sum(1 for item in out if item.is_sponsored)
    assert sponsored_count <= 2


# ── 2. /api/v1/config/ads — dev vs prod ───────────────────────────
# The dev env returns Google's documented test unit IDs; prod
# returns the values seeded by `app/seed.py`. We seed app_config
# explicitly here (the autouse conftest fixture wipes the DB
# between tests, so the lifespan seed never runs in tests).

@pytest.mark.asyncio
async def test_config_ads_dev_returns_google_test_ids(client, db_session):
    """env=dev returns Google's test unit IDs, not the prod ones."""
    # Seed: no app_config rows needed. The dev override is built
    # into `ads_service._dev_value_for` — it doesn't read from
    # the DB at all.
    r = await client.get("/api/v1/config/ads?env=dev")
    assert r.status_code == 200
    body = r.json()
    # Google's documented Android test unit ID for native advanced:
    assert body["in_feed_android"] == "ca-app-pub-3940256099942544/2247696110"
    # App ID for Android test:
    assert body["android_app_id"] == "ca-app-pub-3940256099942544~3347511713"


@pytest.mark.asyncio
async def test_config_ads_prod_returns_seeded_ids(client, db_session):
    """env=prod reads from app_config and returns the seeded IDs."""
    # Seed the prod row. We use the model's primary key directly
    # so the upsert path in `seed.py` doesn't have to run.
    db_session.add(AppConfig(
        key="admob.in_feed.android",
        value="ca-app-pub-3898064484524772/6538723260",
        environment="prod",
        description="seeded by test",
    ))
    db_session.add(AppConfig(
        key="admob.app_id.android",
        value="ca-app-pub-3898064484524772~6521009021",
        environment="prod",
        description="seeded by test",
    ))
    await db_session.commit()

    r = await client.get("/api/v1/config/ads?env=prod")
    assert r.status_code == 200
    body = r.json()
    assert body["in_feed_android"] == "ca-app-pub-3898064484524772/6538723260"
    assert body["android_app_id"] == "ca-app-pub-3898064484524772~6521009021"
    # A key we didn't seed → empty string. The client treats
    # empty as "slot disabled".
    assert body["interstitial_ios"] == ""


@pytest.mark.asyncio
async def test_config_ads_rejects_invalid_env(client):
    """The endpoint pattern-restricts env to dev|prod."""
    r = await client.get("/api/v1/config/ads?env=staging")
    assert r.status_code == 422



# The HMAC-SHA256 SSV tests were removed in the ad-system security
# hardening pass (Task #3). The new flow uses ECDSA P-256 query-
# param signatures bound to a server-issued ad-request token
# (`/api/v1/ads/request-token`), not HMAC over a raw body. The
# replacement coverage is in tests/test_ads_credit.py:
#   - test_ssv_credits_user_for_valid_request
#   - test_ssv_rejects_bad_signature
#   - test_ssv_unknown_token_is_ignored
#   - test_ssv_user_mismatch_is_ignored
#   - test_recent_credits_returns_credited_events
# Plus the 410-Gone checks for the removed /ads/credit, /ads/
# impression, and /ads/reward-claim endpoints.

@pytest.mark.asyncio
async def test_applovin_callback_returns_501(client):
    """AppLovin is stubbed until the integration lands."""
    r = await client.post("/api/v1/ads/applovin/callback", json={})
    assert r.status_code == 501
