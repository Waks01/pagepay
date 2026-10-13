"""Asset generation is charged, not free.

Generation is the expensive step: the model call costs ~N2.13 whether or
not the student ever reads the result. Charging only at unlock let anyone
burn compute by generating repeatedly and unlocking nothing.

The invariants:

- generation debits before the model call, so a 402 costs no tokens
- a failed model call refunds, so an outage is not billed
- reading one of your own generated assets is not charged a second time
- premium generates free and unlocks free, as before
- the withdrawable wallet is never touched
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

from app.models import StudyAsset, StudyMaterial, StudyTransaction, User  # noqa: E402
from app.routers import study as study_router  # noqa: E402


def _auth_header(user_id: int) -> dict:
    from app.services.auth import create_access_token

    return {"Authorization": f"Bearer {create_access_token(user_id)}"}


async def _make_user(db_session, email, sv=0, cashable=0, premium=False):
    from datetime import datetime, timedelta

    from app.models import UserTier

    user = User(email=email, password_hash="hash")
    user.service_credit_balance = sv
    user.cashable_balance = cashable
    if premium:
        user.tier = UserTier.STUDY_PLUS_MONTHLY
        user.subscription_expires_at = datetime.utcnow() + timedelta(days=30)
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _make_material(db_session, user):
    material = StudyMaterial(
        user_id=user.id,
        title="Cell Biology",
        raw_input="Osmosis moves water across a membrane.",
        parsed_structure='{"topics": [{"name": "Cells", "subtopics": [], "key_concepts": []}]}',
    )
    db_session.add(material)
    await db_session.commit()
    await db_session.refresh(material)
    return material


def _patch_ai(monkeypatch, *, fail=False, payload=None):
    from fastapi import HTTPException

    content = payload or {"questions": [
        {
            "question": "What is osmosis?",
            "options": ["A", "B", "C", "D"],
            "correct_index": 1,
            "explanation": "Water moves across a membrane.",
            "topic": "Cells",
        }
    ]}

    async def fake_route_ai(prompt, task_type, max_tokens=None, db=None,
                            system_prompt=None, history=None, model_tier=None):
        if fail:
            raise HTTPException(status_code=503, detail="provider down")
        import json as _json
        return {
            "response": _json.dumps(content),
            "provider": "stub",
            "model": "stub",
            "usage": {},
        }

    monkeypatch.setattr(study_router, "route_ai", fake_route_ai)


_GEN_BODY = {
    "material_id": 0,   # filled per test
    "asset_type": "mcq",
    "count": 5,
    "mode": "all",
}


@pytest.mark.asyncio
async def test_generation_debits_before_the_model_call(client, db_session, monkeypatch):
    """Payment happens first, so a 402 costs nothing."""
    user = await _make_user(db_session, "gen_402@test.com", sv=40)
    material = await _make_material(db_session, user)
    _patch_ai(monkeypatch)

    before = user.service_credit_balance
    res = await client.post(
        "/api/v1/study/generate",
        json={**_GEN_BODY, "material_id": material.id},
        headers=_auth_header(user.id),
    )
    assert res.status_code == 402
    assert "50" in res.json()["detail"]

    await db_session.refresh(user)
    assert user.service_credit_balance == before, "a rejected generate was charged"

    # And no asset was created.
    assets = (await db_session.execute(select(StudyAsset))).scalars().all()
    assert assets == []


@pytest.mark.asyncio
async def test_generation_charges_and_stores(client, db_session, monkeypatch):
    """A funded generate is charged once and the asset is stored."""
    user = await _make_user(db_session, "gen_ok@test.com", sv=500)
    material = await _make_material(db_session, user)
    _patch_ai(monkeypatch)

    res = await client.post(
        "/api/v1/study/generate",
        json={**_GEN_BODY, "material_id": material.id},
        headers=_auth_header(user.id),
    )
    assert res.status_code == 200
    assert "questions" in res.json()["assets"][0]

    await db_session.refresh(user)
    assert user.service_credit_balance == 450

    assets = (await db_session.execute(select(StudyAsset))).scalars().all()
    assert len(assets) == 1

    txns = (await db_session.execute(select(StudyTransaction))).scalars().all()
    assert len(txns) == 1
    assert txns[0].method == "generate"
    assert txns[0].points_spent == 50
    assert txns[0].asset_id == assets[0].id


@pytest.mark.asyncio
async def test_failed_generation_refunds(client, db_session, monkeypatch):
    """A provider outage must not bill for content that does not exist."""
    user = await _make_user(db_session, "gen_fail@test.com", sv=500)
    material = await _make_material(db_session, user)
    _patch_ai(monkeypatch, fail=True)

    before = user.service_credit_balance
    res = await client.post(
        "/api/v1/study/generate",
        json={**_GEN_BODY, "material_id": material.id},
        headers=_auth_header(user.id),
    )
    assert res.status_code == 503

    await db_session.refresh(user)
    assert user.service_credit_balance == before, "failed generation was charged"

    assets = (await db_session.execute(select(StudyAsset))).scalars().all()
    assert assets == []


@pytest.mark.asyncio
async def test_malformed_model_response_refunds(client, db_session, monkeypatch):
    """Non-JSON output is a failure, not a stored asset."""
    user = await _make_user(db_session, "gen_json@test.com", sv=500)
    material = await _make_material(db_session, user)

    async def fake_route_ai(prompt, task_type, max_tokens=None, db=None,
                            system_prompt=None, history=None, model_tier=None):
        return {"response": "not json at all", "provider": "stub", "model": "stub", "usage": {}}

    monkeypatch.setattr(study_router, "route_ai", fake_route_ai)

    before = user.service_credit_balance
    res = await client.post(
        "/api/v1/study/generate",
        json={**_GEN_BODY, "material_id": material.id},
        headers=_auth_header(user.id),
    )
    assert res.status_code == 502
    await db_session.refresh(user)
    assert user.service_credit_balance == before


@pytest.mark.asyncio
async def test_reading_your_own_generated_asset_is_free(client, db_session, monkeypatch):
    """The unlock must not charge twice for the same content."""
    user = await _make_user(db_session, "gen_unlock@test.com", sv=500)
    material = await _make_material(db_session, user)
    _patch_ai(monkeypatch)

    res = await client.post(
        "/api/v1/study/generate",
        json={**_GEN_BODY, "material_id": material.id},
        headers=_auth_header(user.id),
    )
    assert res.status_code == 200
    await db_session.refresh(user)
    after_generate = user.service_credit_balance
    assert after_generate == 450
    asset_id = (
        await db_session.execute(select(StudyAsset.id))
    ).scalar_one()

    res = await client.post(
        "/api/v1/study/unlock",
        json={"asset_id": asset_id, "method": "points"},
        headers=_auth_header(user.id),
    )
    assert res.status_code == 200
    body = res.json()
    assert body["unlocked"] is True
    assert body["method"] == "generate"
    assert body["points_spent"] == 0

    await db_session.refresh(user)
    assert user.service_credit_balance == after_generate, "unlock charged twice"


@pytest.mark.asyncio
async def test_premium_generates_free_and_unlocks_free(client, db_session, monkeypatch):
    user = await _make_user(db_session, "gen_prem@test.com", sv=500, premium=True)
    material = await _make_material(db_session, user)
    _patch_ai(monkeypatch)

    before = user.service_credit_balance
    res = await client.post(
        "/api/v1/study/generate",
        json={**_GEN_BODY, "material_id": material.id},
        headers=_auth_header(user.id),
    )
    assert res.status_code == 200

    await db_session.refresh(user)
    assert user.service_credit_balance == before, "premium was charged to generate"

    asset_id = (await db_session.execute(select(StudyAsset.id))).scalar_one()
    res = await client.post(
        "/api/v1/study/unlock",
        json={"asset_id": asset_id, "method": "points"},
        headers=_auth_header(user.id),
    )
    assert res.status_code == 200
    assert res.json()["method"] == "premium"
    await db_session.refresh(user)
    assert user.service_credit_balance == before, "premium was charged to unlock"


@pytest.mark.asyncio
async def test_generation_never_touches_the_withdrawable_wallet(
    client, db_session, monkeypatch
):
    """Generation must come from spendable SV, never withdrawable earnings."""
    user = await _make_user(db_session, "gen_wallet@test.com", sv=500, cashable=5000)
    material = await _make_material(db_session, user)
    _patch_ai(monkeypatch)

    res = await client.post(
        "/api/v1/study/generate",
        json={**_GEN_BODY, "material_id": material.id},
        headers=_auth_header(user.id),
    )
    assert res.status_code == 200

    await db_session.refresh(user)
    assert user.cashable_balance == 5000
    assert user.service_credit_balance == 450


@pytest.mark.asyncio
async def test_video_generation_costs_more(client, db_session, monkeypatch):
    """Video assets cost 200 SV, not 50."""
    user = await _make_user(db_session, "gen_video@test.com", sv=500)
    material = await _make_material(db_session, user)
    _patch_ai(monkeypatch, payload={"scenes": [{"narration": "hello"}]})

    res = await client.post(
        "/api/v1/study/generate",
        json={**_GEN_BODY, "material_id": material.id, "asset_type": "video"},
        headers=_auth_header(user.id),
    )
    assert res.status_code == 200
    await db_session.refresh(user)
    assert user.service_credit_balance == 300, "video must cost 200 SV"
