"""Study payment methods: sv (spendable) and cashable (withdrawable).

The user picks which wallet pays — sv is the default/primary, cashable
spends withdrawable earnings. Both sides are the same unit
(`POINTS_PER_NAIRA` = 10 pts/₦), so a price quoted in sv is paid from
either wallet at face value. These tests pin:

- both methods debit the right column and leave the other untouched
- an unaffordable wallet is a 402 that carries the real price + balance
- the choice is what lands in the ledger (`StudyTransaction` /
  `AudioUnlock`), never silently rewritten
- `sv` is an accepted alias of the legacy `points` name on assets
- the removed "ad" method stays rejected on both endpoints
"""

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.config import settings
from app.models import (
    AudioUnlock,
    StudyAsset,
    StudyMaterial,
    StudyTransaction,
    User,
)
from app.routers import study as study_router


def _auth_header(user_id: int) -> dict[str, str]:
    from app.services.auth import create_access_token

    return {"Authorization": f"Bearer {create_access_token(user_id)}"}


async def _make_user(
    db_session,
    email: str,
    sv: int = 0,
    cashable: int = 0,
) -> User:
    user = User(
        email=email,
        password_hash="hash",
        service_credit_balance=sv,
        cashable_balance=cashable,
        points_balance=sv + cashable,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _make_material(db_session, user: User, content: str = "x" * 1000) -> StudyMaterial:
    material = StudyMaterial(
        user_id=user.id,
        title="Pay Material",
        raw_input=content,
        parsed_structure='{"topics":[]}',
        content=content,
    )
    db_session.add(material)
    await db_session.commit()
    await db_session.refresh(material)
    return material


async def _make_asset(db_session, material: StudyMaterial, cost: int = 50) -> StudyAsset:
    asset = StudyAsset(
        material_id=material.id,
        asset_type="mcq",
        content_json='{"questions":[]}',
        points_to_unlock=cost,
    )
    db_session.add(asset)
    await db_session.commit()
    await db_session.refresh(asset)
    return asset


@pytest.fixture
def wallet_split_on(monkeypatch):
    """Pin the split so sv -> service_credit_balance and cashable ->
    cashable_balance regardless of the local .env."""
    monkeypatch.setattr(study_router.settings, "wallet_split_enabled", True)


# ── audio unlock ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_audio_status_reports_the_real_cost(client: AsyncClient, db_session, wallet_split_on):
    user = await _make_user(db_session, "audio-status@test.com")
    # 1000 chars -> 20 base + (1000 // 500) * 10 = 40 sv.
    material = await _make_material(db_session, user, content="x" * 1000)

    res = await client.get(
        f"/api/v1/study/materials/{material.id}/audio-status",
        headers=_auth_header(user.id),
    )
    assert res.status_code == 200
    assert res.json()["cost_sv"] == 40


@pytest.mark.asyncio
async def test_audio_unlock_pays_with_sv_by_default(client: AsyncClient, db_session, wallet_split_on):
    user = await _make_user(db_session, "audio-sv@test.com", sv=100, cashable=100)
    material = await _make_material(db_session, user, content="x" * 1000)

    res = await client.post(
        f"/api/v1/study/materials/{material.id}/unlock-audio",
        json={"method": "sv"},
        headers=_auth_header(user.id),
    )
    assert res.status_code == 200
    data = res.json()
    assert data["method"] == "sv"
    assert data["cost_sv"] == 40
    assert data["new_balance"] == 60  # the sv wallet went 100 -> 60

    await db_session.refresh(user)
    assert user.service_credit_balance == 60
    assert user.cashable_balance == 100  # untouched

    unlock = (await db_session.execute(select(AudioUnlock))).scalar_one()
    assert unlock.method == "sv"
    assert unlock.cost_sv == 40


@pytest.mark.asyncio
async def test_audio_unlock_pays_with_cashable(client: AsyncClient, db_session, wallet_split_on):
    user = await _make_user(db_session, "audio-cash@test.com", sv=5, cashable=100)
    material = await _make_material(db_session, user, content="x" * 1000)

    res = await client.post(
        f"/api/v1/study/materials/{material.id}/unlock-audio",
        json={"method": "cashable"},
        headers=_auth_header(user.id),
    )
    assert res.status_code == 200
    data = res.json()
    assert data["method"] == "cashable"
    assert data["cost_sv"] == 40
    assert data["new_balance"] == 60  # the cashable wallet went 100 -> 60

    await db_session.refresh(user)
    assert user.cashable_balance == 60
    assert user.service_credit_balance == 5  # untouched

    unlock = (await db_session.execute(select(AudioUnlock))).scalar_one()
    assert unlock.method == "cashable"


@pytest.mark.asyncio
async def test_audio_unlock_insufficient_sv_402(client: AsyncClient, db_session, wallet_split_on):
    user = await _make_user(db_session, "audio-poor-sv@test.com", sv=15, cashable=100)
    material = await _make_material(db_session, user, content="x" * 1000)

    res = await client.post(
        f"/api/v1/study/materials/{material.id}/unlock-audio",
        json={"method": "sv"},
        headers=_auth_header(user.id),
    )
    assert res.status_code == 402
    detail = res.json()["detail"]
    # The modal surfaces this verbatim, so it must carry both numbers.
    assert "40" in detail
    assert "15" in detail

    assert (await db_session.execute(select(AudioUnlock))).scalars().all() == []


@pytest.mark.asyncio
async def test_audio_unlock_insufficient_cashable_402(client: AsyncClient, db_session, wallet_split_on):
    """A user with plenty of sv but no cashable must not be able to pay
    the cashable path — and the message must name the cashable wallet."""
    user = await _make_user(db_session, "audio-poor-cash@test.com", sv=100, cashable=10)
    material = await _make_material(db_session, user, content="x" * 1000)

    res = await client.post(
        f"/api/v1/study/materials/{material.id}/unlock-audio",
        json={"method": "cashable"},
        headers=_auth_header(user.id),
    )
    assert res.status_code == 402
    assert "cashable" in res.json()["detail"]

    await db_session.refresh(user)
    assert user.service_credit_balance == 100
    assert user.cashable_balance == 10
    assert (await db_session.execute(select(AudioUnlock))).scalars().all() == []


@pytest.mark.asyncio
async def test_audio_unlock_is_idempotent_per_method(client: AsyncClient, db_session, wallet_split_on):
    user = await _make_user(db_session, "audio-twice@test.com", sv=100, cashable=100)
    material = await _make_material(db_session, user, content="x" * 1000)
    headers = _auth_header(user.id)

    first = await client.post(
        f"/api/v1/study/materials/{material.id}/unlock-audio",
        json={"method": "cashable"},
        headers=headers,
    )
    assert first.status_code == 200

    second = await client.post(
        f"/api/v1/study/materials/{material.id}/unlock-audio",
        json={"method": "sv"},
        headers=headers,
    )
    assert second.status_code == 200
    data = second.json()
    assert data["unlocked"] is True
    assert data["method"] == "existing"
    assert data["cost_sv"] == 0
    # Reports the wallet that actually paid (cashable), not the sv wallet.
    assert data["new_balance"] == 60

    rows = (await db_session.execute(select(AudioUnlock))).scalars().all()
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_audio_unlock_rejects_ad_method(client: AsyncClient, db_session, wallet_split_on):
    """`method: "ad"` once fell off the end of the handler into a 500 —
    the ad pipeline was removed, so it must be an honest 400."""
    user = await _make_user(db_session, "audio-ad@test.com", sv=100, cashable=100)
    material = await _make_material(db_session, user)

    res = await client.post(
        f"/api/v1/study/materials/{material.id}/unlock-audio",
        json={"method": "ad"},
        headers=_auth_header(user.id),
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "method must be 'sv' or 'cashable'"

    assert (await db_session.execute(select(AudioUnlock))).scalars().all() == []


# ── asset unlock ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_asset_unlock_pays_with_sv(client: AsyncClient, db_session, wallet_split_on):
    user = await _make_user(db_session, "asset-sv@test.com", sv=200, cashable=200)
    material = await _make_material(db_session, user)
    asset = await _make_asset(db_session, material, cost=50)

    res = await client.post(
        "/api/v1/study/unlock",
        json={"asset_id": asset.id, "method": "sv"},
        headers=_auth_header(user.id),
    )
    assert res.status_code == 200
    data = res.json()
    assert data["unlocked"] is True
    assert data["new_balance"] == 150
    assert data["method"] == "points"  # sv is the legacy points alias

    await db_session.refresh(user)
    assert user.service_credit_balance == 150
    assert user.cashable_balance == 200  # untouched

    txn = (await db_session.execute(select(StudyTransaction))).scalar_one()
    assert txn.method == "points"
    assert txn.points_spent == 50


@pytest.mark.asyncio
async def test_asset_unlock_pays_with_cashable(client: AsyncClient, db_session, wallet_split_on):
    user = await _make_user(db_session, "asset-cash@test.com", sv=10, cashable=200)
    material = await _make_material(db_session, user)
    asset = await _make_asset(db_session, material, cost=50)

    res = await client.post(
        "/api/v1/study/unlock",
        json={"asset_id": asset.id, "method": "cashable"},
        headers=_auth_header(user.id),
    )
    assert res.status_code == 200
    data = res.json()
    assert data["unlocked"] is True
    assert data["new_balance"] == 150
    assert data["method"] == "cashable"

    await db_session.refresh(user)
    assert user.cashable_balance == 150
    assert user.service_credit_balance == 10  # untouched

    txn = (await db_session.execute(select(StudyTransaction))).scalar_one()
    assert txn.method == "cashable"


@pytest.mark.asyncio
async def test_asset_unlock_insufficient_cashable_402(client: AsyncClient, db_session, wallet_split_on):
    user = await _make_user(db_session, "asset-poor-cash@test.com", sv=200, cashable=10)
    material = await _make_material(db_session, user)
    asset = await _make_asset(db_session, material, cost=50)

    res = await client.post(
        "/api/v1/study/unlock",
        json={"asset_id": asset.id, "method": "cashable"},
        headers=_auth_header(user.id),
    )
    assert res.status_code == 402
    assert "cashable" in res.json()["detail"]

    await db_session.refresh(user)
    assert user.cashable_balance == 10
    assert user.service_credit_balance == 200
    assert (await db_session.execute(select(StudyTransaction))).scalars().all() == []


@pytest.mark.asyncio
async def test_asset_unlock_rejects_ad_and_unknown_methods(client: AsyncClient, db_session, wallet_split_on):
    user = await _make_user(db_session, "asset-methods@test.com", sv=200, cashable=200)
    material = await _make_material(db_session, user)
    asset = await _make_asset(db_session, material, cost=50)
    headers = _auth_header(user.id)

    # "ad" has no pipeline; unknown spellings must never debit anything.
    for method in ("ad", "crypto", "sv "):
        res = await client.post(
            "/api/v1/study/unlock",
            json={"asset_id": asset.id, "method": method},
            headers=headers,
        )
        assert res.status_code in (400, 422), f"{method!r} was accepted"

    await db_session.refresh(user)
    assert user.service_credit_balance == 200
    assert user.cashable_balance == 200
    assert (await db_session.execute(select(StudyTransaction))).scalars().all() == []

# ── Tier plumbing: the paid tiers must be purchasable and deliverable ─


def test_calculate_end_date_covers_every_paid_tier():
    """Subscription expiry must work for all four paid tiers.

    `calculate_subscription_end_date` only branched on UserTier.
    PREMIUM_MONTHLY / PREMIUM_YEARLY, which no longer exist in the
    enum, so every successful charge raised AttributeError. The webhook
    swallowed it, the user kept paying, and the tier was never
    upgraded.
    """
    from datetime import datetime, timedelta

    from app.models import UserTier
    from app.services.subscription import calculate_subscription_end_date

    start = datetime(2026, 1, 1)
    expected = {
        UserTier.STUDY_PLUS_MONTHLY: 30,
        UserTier.STUDY_PLUS_YEARLY: 365,
        UserTier.COMPLETE_PLUS_MONTHLY: 30,
        UserTier.COMPLETE_PLUS_YEARLY: 365,
    }
    for tier, days in expected.items():
        got = calculate_subscription_end_date(tier, start)
        assert got == start + timedelta(days=days), f"{tier.value} -> {got}"


def test_free_tier_has_no_end_date():
    """FREE must raise, not silently get a subscription window."""
    from app.models import UserTier
    from app.services.subscription import calculate_subscription_end_date

    with pytest.raises(ValueError):
        calculate_subscription_end_date(UserTier.FREE)


def test_payment_initiate_accepts_real_tiers():
    """The purchase schema must accept the tiers that can be sold.

    It used to be Literal["premium_monthly", "premium_yearly"] —
    defunct values — so Pydantic rejected every purchase with a 422
    before payment, and the four real tiers were unbuyable.
    """
    from app.schemas import PaymentInitiateRequest
    from app.models import UserTier

    for tier in [
        "study_plus_monthly",
        "study_plus_yearly",
        "complete_plus_monthly",
        "complete_plus_yearly",
    ]:
        req = PaymentInitiateRequest(tier=tier)
        assert req.tier == UserTier(tier)

    # A defunct tier must not be silently accepted.
    with pytest.raises(Exception):
        PaymentInitiateRequest(tier="premium_monthly")


def test_no_dead_tier_enum_members_referenced():
    """UserTier.PREMIUM_* does not exist; any use is a runtime crash.

    Regression guard for the 11 sites in premium_notifications.py and
    the tier-benefits endpoint that referenced them.
    """
    import inspect

    from app.models import UserTier
    from app.services import premium_notifications

    assert not hasattr(UserTier, "PREMIUM_MONTHLY")
    assert not hasattr(UserTier, "PREMIUM_YEARLY")

    src = inspect.getsource(premium_notifications)
    assert "PREMIUM_MONTHLY" not in src, "dead enum member still referenced"
    assert "PREMIUM_YEARLY" not in src, "dead enum member still referenced"


def test_notifications_module_imports_cleanly():
    """premium_notifications must import — it referenced dead members."""
    from app.services import premium_notifications

    assert premium_notifications.UserTier is not None


def test_activation_copy_matches_tier_benefits():
    """Push copy must only claim what the tier actually grants.

    The old body promised "ad-free reading and 2x points" to every
    tier. Study+ has all multipliers at 1.0, so that was false.
    """
    from app.models import UserTier
    from app.routers.payouts import _premium_activated_body

    study = _premium_activated_body(UserTier.STUDY_PLUS_MONTHLY)
    assert "1.5x" not in study, f"Study+ claims a multiplier it does not have: {study}"

    complete = _premium_activated_body(UserTier.COMPLETE_PLUS_MONTHLY)
    assert "1.5x" in complete, f"Complete+ omits its real multipliers: {complete}"
    assert "3x" not in complete


def test_subscription_status_benefits_come_from_data():
    """Status benefits must reflect the tier, not a constant dict."""
    from datetime import datetime, timedelta

    from app.models import User, UserTier
    from app.services.subscription import get_subscription_status

    user = User(
        email="tier@test.com",
        password_hash="hash",
        tier=UserTier.STUDY_PLUS_MONTHLY,
        subscription_expires_at=datetime.utcnow() + timedelta(days=30),
    )
    status = get_subscription_status(user)

    assert status["benefits"]["free_asset_unlock"] is True
    assert status["benefits"]["audio_full_access"] is True
    assert status["benefits"]["chat_daily_limit"] == settings.study_chat_premium_daily_limit
    # The old constant dict keys must be gone.
    for removed in ("ad_free_study", "double_points", "priority_ai"):
        assert removed not in status["benefits"], f"stale key {removed} still returned"


def test_free_user_reports_no_premium_benefits():
    from app.models import User, UserTier
    from app.services.subscription import get_subscription_status

    user = User(email="free@test.com", password_hash="hash", tier=UserTier.FREE)
    status = get_subscription_status(user)
    assert status["is_premium"] is False
    assert status["benefits"] == {}