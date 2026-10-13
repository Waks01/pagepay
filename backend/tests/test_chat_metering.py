"""Paid chat turns beyond the free quota.

The free quota is deliberately tiny (5/day) so the free tier is cheap
to serve. A student who wants a sixth question buys one with SV, priced
by the tier the question routes to so the price tracks the cost.

The invariants these tests pin:

- a rejected payment writes nothing and leaves the free quota intact
- an unaffordable balance is a 402 carrying the real price and balance
- the price follows routing (Standard 15 / Premium 35), not a flat rate
- a failed model call refunds the SV and the slot
- paid turns are capped, so a scripted client can't buy indefinitely
- chat debits the spendable wallet, never the withdrawable side
"""

import os

import pytest

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

from app.models import StudyMaterial, StudyTransaction, User  # noqa: E402
from app.routers import study as study_router  # noqa: E402
from app.services.ai_usage import peek_count, reset_user  # noqa: E402


def _auth_header(user_id: int) -> dict:
    from app.services.auth import create_access_token

    return {"Authorization": f"Bearer {create_access_token(user_id)}"}


async def _make_material(db_session, user, raw="Osmosis moves water across a membrane."):
    material = StudyMaterial(
        user_id=user.id,
        title="Cell Biology",
        raw_input=raw,
        parsed_structure='{"topics": [{"name": "Cells", "subtopics": [], "key_concepts": []}]}',
    )
    db_session.add(material)
    await db_session.commit()
    await db_session.refresh(material)
    return material


async def _make_user(db_session, email, sv=0, cashable=0):
    user = User(email=email, password_hash="hash")
    user.service_credit_balance = sv
    user.cashable_balance = cashable
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


def _patch_ai(monkeypatch, *, fail=False, response="ok"):
    async def fake_route_ai(prompt, task_type, max_tokens=None, db=None,
                            system_prompt=None, history=None, model_tier=None):
        if fail:
            from fastapi import HTTPException

            raise HTTPException(status_code=503, detail="provider down")
        return {"response": response, "provider": "stub", "model": "stub", "usage": {}}

    monkeypatch.setattr(study_router, "route_ai", fake_route_ai)


@pytest.mark.asyncio
async def test_free_turn_is_not_charged(client, db_session, monkeypatch):
    """Inside the quota, nothing is debited and no transaction is written."""
    reset_user(1)
    user = await _make_user(db_session, "chat_free@test.com", sv=500)
    material = await _make_material(db_session, user)
    _patch_ai(monkeypatch)

    res = await client.post(
        "/api/v1/study/chat",
        json={"material_id": material.id, "message": "Define osmosis"},
        headers=_auth_header(user.id),
    )
    assert res.status_code == 200
    await db_session.refresh(user)
    assert user.service_credit_balance == 500

    rows = (await db_session.execute(select(StudyTransaction))).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_quota_exhausted_without_payment_is_429_and_keeps_quota(
    client, db_session, monkeypatch
):
    """A 429 must not consume the free quota, so the user can still pay."""
    reset_user(1)
    user = await _make_user(db_session, "chat_q@test.com", sv=500)
    material = await _make_material(db_session, user)
    _patch_ai(monkeypatch)

    from app.config import settings

    limit = settings.study_chat_daily_limit
    for _ in range(limit):
        used_before = peek_count(user.id)
        assert used_before < limit
        r = await client.post(
            "/api/v1/study/chat",
            json={"material_id": material.id, "message": "Define osmosis"},
            headers=_auth_header(user.id),
        )
        assert r.status_code == 200
        assert peek_count(user.id) == used_before + 1

    # Quota now spent. Without pay_for_turn we must get a 429 that names
    # the price, and the counter must not move.
    before = peek_count(user.id)
    r = await client.post(
        "/api/v1/study/chat",
        json={"material_id": material.id, "message": "Define osmosis"},
        headers=_auth_header(user.id),
    )
    assert r.status_code == 429
    assert "SV" in r.json()["detail"]
    assert peek_count(user.id) == before, "a rejected attempt consumed quota"


@pytest.mark.asyncio
async def test_paid_turn_debits_and_writes_ledger(client, db_session, monkeypatch):
    """Paying buys the turn, debits SV, and records a transaction."""
    reset_user(1)
    user = await _make_user(db_session, "chat_pay@test.com", sv=500)
    material = await _make_material(db_session, user)
    _patch_ai(monkeypatch, response="A red blood cell bursts because water enters by osmosis.")

    from app.config import settings

    limit = settings.study_chat_daily_limit
    for _ in range(limit):
        await client.post(
            "/api/v1/study/chat",
            json={"material_id": material.id, "message": "Define osmosis"},
            headers=_auth_header(user.id),
        )

    before = user.service_credit_balance
    res = await client.post(
        "/api/v1/study/chat",
        json={"material_id": material.id, "message": "Define osmosis", "pay_for_turn": True},
        headers=_auth_header(user.id),
    )
    assert res.status_code == 200
    assert res.text.strip() == "A red blood cell bursts because water enters by osmosis."

    await db_session.refresh(user)
    assert user.service_credit_balance == before - settings.study_chat_sv_standard

    rows = (await db_session.execute(select(StudyTransaction))).scalars().all()
    assert len(rows) == 1
    assert rows[0].method == "chat"
    assert rows[0].points_spent == settings.study_chat_sv_standard
    assert rows[0].asset_id is None


@pytest.mark.asyncio
async def test_price_follows_the_routed_tier(client, db_session, monkeypatch):
    """A reasoning question costs Premium (35), a recall one Standard (15)."""
    reset_user(1)
    user = await _make_user(db_session, "chat_tier@test.com", sv=1000)
    material = await _make_material(db_session, user)
    _patch_ai(monkeypatch)

    from app.config import settings

    limit = settings.study_chat_daily_limit

    async def burn_quota():
        for _ in range(limit):
            await client.post(
                "/api/v1/study/chat",
                json={"material_id": material.id, "message": "Define osmosis"},
                headers=_auth_header(user.id),
            )

    # Recall question -> Standard tier -> 15 SV.
    await burn_quota()
    before = user.service_credit_balance
    res = await client.post(
        "/api/v1/study/chat",
        json={"material_id": material.id, "message": "Define osmosis", "pay_for_turn": True},
        headers=_auth_header(user.id),
    )
    assert res.status_code == 200
    await db_session.refresh(user)
    charged_standard = before - user.service_credit_balance
    assert charged_standard == settings.study_chat_sv_standard

    # Reasoning question -> Premium tier -> 35 SV.
    await burn_quota()
    before = user.service_credit_balance
    res = await client.post(
        "/api/v1/study/chat",
        json={
            "material_id": material.id,
            "message": "Why does a red blood cell burst in distilled water?",
            "pay_for_turn": True,
        },
        headers=_auth_header(user.id),
    )
    assert res.status_code == 200
    await db_session.refresh(user)
    charged_premium = before - user.service_credit_balance
    assert charged_premium == settings.study_chat_sv_premium
    assert charged_premium > charged_standard


@pytest.mark.asyncio
async def test_insufficient_balance_is_402_with_price_and_balance(
    client, db_session, monkeypatch
):
    """A short balance must say how much is needed and what they have."""
    reset_user(1)
    user = await _make_user(db_session, "chat_402@test.com", sv=4)
    material = await _make_material(db_session, user)
    _patch_ai(monkeypatch)

    from app.config import settings

    for _ in range(settings.study_chat_daily_limit):
        await client.post(
            "/api/v1/study/chat",
            json={"material_id": material.id, "message": "Define osmosis"},
            headers=_auth_header(user.id),
        )

    before = user.service_credit_balance
    res = await client.post(
        "/api/v1/study/chat",
        json={"material_id": material.id, "message": "Define osmosis", "pay_for_turn": True},
        headers=_auth_header(user.id),
    )
    assert res.status_code == 402
    detail = res.json()["detail"]
    assert str(settings.study_chat_sv_standard) in detail
    assert "4" in detail

    # Nothing was debited.
    await db_session.refresh(user)
    assert user.service_credit_balance == before
    rows = (await db_session.execute(select(StudyTransaction))).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_failed_model_call_refunds_the_turn(client, db_session, monkeypatch):
    """A provider outage must not cost the student anything."""
    reset_user(1)
    user = await _make_user(db_session, "chat_refund@test.com", sv=500)
    material = await _make_material(db_session, user)
    _patch_ai(monkeypatch, fail=True)

    from app.config import settings

    for _ in range(settings.study_chat_daily_limit):
        await client.post(
            "/api/v1/study/chat",
            json={"material_id": material.id, "message": "Define osmosis"},
            headers=_auth_header(user.id),
        )

    before = user.service_credit_balance
    queries_before = peek_count(user.id)
    res = await client.post(
        "/api/v1/study/chat",
        json={"material_id": material.id, "message": "Define osmosis", "pay_for_turn": True},
        headers=_auth_header(user.id),
    )
    assert res.status_code == 503

    await db_session.refresh(user)
    assert user.service_credit_balance == before, "SV was not refunded"
    assert peek_count(user.id) == queries_before, "quota slot was not refunded"


@pytest.mark.asyncio
async def test_paid_turns_are_capped(client, db_session, monkeypatch):
    """Paid turns stop at the cap, so exposure stays bounded.

    Uses a small cap rather than the production 50, because the chat
    endpoint is also rate-limited to 20/minute and burning 50 paid turns
    inside one test would trip that instead of exercising this cap.
    """
    reset_user(1)
    cap = 3
    monkeypatch.setattr(study_router.settings, "study_chat_paid_daily_limit", cap)

    user = await _make_user(db_session, "chat_cap@test.com", sv=100000)
    material = await _make_material(db_session, user)
    _patch_ai(monkeypatch)

    from app.config import settings

    for _ in range(settings.study_chat_daily_limit):
        await client.post(
            "/api/v1/study/chat",
            json={"material_id": material.id, "message": "Define osmosis"},
            headers=_auth_header(user.id),
        )

    for i in range(cap):
        r = await client.post(
            "/api/v1/study/chat",
            json={"material_id": material.id, "message": "Define osmosis", "pay_for_turn": True},
            headers=_auth_header(user.id),
        )
        assert r.status_code == 200, f"paid turn {i+1} failed: {r.text}"

    # One more must be refused, and must not be charged.
    await db_session.refresh(user)
    before = user.service_credit_balance
    r = await client.post(
        "/api/v1/study/chat",
        json={"material_id": material.id, "message": "Define osmosis", "pay_for_turn": True},
        headers=_auth_header(user.id),
    )
    assert r.status_code == 429
    await db_session.refresh(user)
    assert user.service_credit_balance == before, "capped turn was still charged"
    # Three paid turns were charged, no more.
    assert before == 100000 - cap * settings.study_chat_sv_standard


def test_paid_cap_and_price_are_sane():
    """The production cap must actually bound exposure, and the prices
    must cover their tier's cost."""
    from app.config import settings

    assert settings.study_chat_paid_daily_limit >= 10
    assert settings.study_chat_paid_daily_limit <= 200
    # Premium costs ~N2.43/turn; 35 SV is N3.50 -> 44% margin.
    # Standard costs ~N0.68/turn; 15 SV is N1.50 -> 55% margin.
    assert settings.study_chat_sv_premium > settings.study_chat_sv_standard
    assert settings.study_chat_sv_premium >= 35
    assert settings.study_chat_sv_standard >= 15


@pytest.mark.asyncio
async def test_chat_never_debits_the_withdrawable_wallet(
    client, db_session, monkeypatch
):
    """Paid chat must come from spendable SV, not withdrawable earnings."""
    reset_user(1)
    user = await _make_user(db_session, "chat_wallet@test.com", sv=500, cashable=5000)
    material = await _make_material(db_session, user)
    _patch_ai(monkeypatch)

    from app.config import settings

    for _ in range(settings.study_chat_daily_limit):
        await client.post(
            "/api/v1/study/chat",
            json={"material_id": material.id, "message": "Define osmosis"},
            headers=_auth_header(user.id),
        )

    res = await client.post(
        "/api/v1/study/chat",
        json={"material_id": material.id, "message": "Define osmosis", "pay_for_turn": True},
        headers=_auth_header(user.id),
    )
    assert res.status_code == 200

    await db_session.refresh(user)
    assert user.cashable_balance == 5000, "withdrawable balance was touched"
    assert user.service_credit_balance == 500 - settings.study_chat_sv_standard


@pytest.mark.asyncio
async def test_premium_user_gets_the_larger_quota(client, db_session, monkeypatch):
    """Premium quota is 15/day; a paid turn must not be needed inside it."""
    from datetime import datetime, timedelta

    from app.models import UserTier
    from app.config import settings

    reset_user(1)
    user = await _make_user(db_session, "chat_prem@test.com", sv=500)
    user.tier = UserTier.STUDY_PLUS_MONTHLY
    user.subscription_expires_at = datetime.utcnow() + timedelta(days=30)
    await db_session.commit()
    await db_session.refresh(user)

    material = await _make_material(db_session, user)
    _patch_ai(monkeypatch)

    before = user.service_credit_balance
    for _ in range(settings.study_chat_premium_daily_limit):
        r = await client.post(
            "/api/v1/study/chat",
            json={"material_id": material.id, "message": "Define osmosis"},
            headers=_auth_header(user.id),
        )
        assert r.status_code == 200

    # The next one is billable, not free.
    r = await client.post(
        "/api/v1/study/chat",
        json={"material_id": material.id, "message": "Define osmosis"},
        headers=_auth_header(user.id),
    )
    assert r.status_code == 429
    await db_session.refresh(user)
    assert user.service_credit_balance == before, "a free turn was charged"
