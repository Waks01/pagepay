"""AI cost logging and the margin summary it feeds.

Telemetry is the only thing that makes the pricing defensible — without
it, the chat quota, the paid-turn prices, and the generation charge are
guesses. These tests pin three properties:

- cost is computed at write time from the published model price, so a
  price change never rewrites what a call cost last month
- logging never breaks the request it was recording
- free-tier and premium turns are recorded as costing money even though
  nothing was charged, so the premium gap is visible rather than free
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

from app.models import AiUsageLog, StudyMaterial, User  # noqa: E402
from app.services.ai_cost import log_usage, margin_usd, model_cost_usd  # noqa: E402
from app.routers import study as study_router  # noqa: E402

GLM = "@cf/zai-org/glm-4.7-flash"
GRANITE = "@cf/ibm-granite/granite-4.0-h-micro"


def _auth_header(user_id: int) -> dict:
    from app.services.auth import create_access_token

    return {"Authorization": f"Bearer {create_access_token(user_id)}"}


# ── cost derivation ────────────────────────────────────────────────


def test_cost_uses_the_published_model_price():
    """The logged cost must be the price, not a guess."""
    # 17k input + 2k output tokens at GLM's $0.060/$0.400 per M.
    cost = model_cost_usd(GLM, 17_000, 2_000)
    assert cost == pytest.approx(17_000 / 1e6 * 0.060 + 2_000 / 1e6 * 0.400)


def test_standard_model_is_cheaper_than_premium():
    """The routing saving must show up in the cost, not just the price."""
    assert model_cost_usd(GRANITE, 17_000, 2_000) < model_cost_usd(GLM, 17_000, 2_000)


def test_unknown_model_costs_zero_not_an_error():
    """A new model without a price entry must not raise.

    It shows up as free in the summary until someone adds the price —
    a loud zero, which is better than a crash.
    """
    assert model_cost_usd("@cf/some/new-model", 10_000, 1_000) == 0.0


def test_margin_converts_sv_to_usd():
    """15 SV is N1.50, which is ~$0.0011 at the documented FX rate."""
    assert margin_usd(0) == 0
    assert margin_usd(15) == pytest.approx(1.50 / 1332.5, rel=1e-3)
    assert margin_usd(35) > margin_usd(15)


# ── logging behaviour ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_logging_disabled_without_a_db_is_a_noop():
    """Fire-and-forget means it must survive a missing session."""
    await log_usage(
        None,
        user_id=1,
        endpoint="chat",
        model=GLM,
        prompt_tokens=10,
        completion_tokens=5,
    )
    assert True  # reaching this line is the test


@pytest.mark.asyncio
async def test_logging_failure_does_not_raise(client, db_session, monkeypatch):
    """A broken table must not fail the request it was recording."""
    class Boom:
        def add(self, *_a, **_k):
            raise RuntimeError("db gone")

        async def commit(self):
            raise RuntimeError("db gone")

        async def rollback(self):
            raise RuntimeError("db gone")

    await log_usage(
        Boom(),
        user_id=1,
        endpoint="chat",
        model=GLM,
        prompt_tokens=10,
        completion_tokens=5,
    )  # must not raise


@pytest.mark.asyncio
async def test_chat_logs_cost_and_margin(client, db_session, monkeypatch):
    """A paid chat turn records both what it cost and what it charged."""
    from app.models import AiUsageLog
    from app.services.ai_usage import reset_user

    reset_user(1)
    user = User(email="cost_chat@test.com", password_hash="hash")
    user.service_credit_balance = 500
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    material = StudyMaterial(
        user_id=user.id,
        title="T",
        raw_input="Osmosis moves water across a membrane.",
        parsed_structure='{"topics": [{"name": "Cells", "subtopics": [], "key_concepts": []}]}',
    )
    db_session.add(material)
    await db_session.commit()
    await db_session.refresh(material)

    async def fake_route_ai(prompt, task_type, max_tokens=None, db=None,
                            system_prompt=None, history=None, model_tier=None):
        return {
            "response": "Osmosis is water moving across a membrane.",
            "provider": "stub",
            "model": GLM if model_tier == "premium" else GRANITE,
            "usage": {"prompt_tokens": 17_000, "completion_tokens": 2_000},
        }

    monkeypatch.setattr(study_router, "route_ai", fake_route_ai)

    res = await client.post(
        "/api/v1/study/chat",
        json={"material_id": material.id, "message": "Define osmosis"},
        headers=_auth_header(user.id),
    )
    assert res.status_code == 200

    rows = (await db_session.execute(select(AiUsageLog))).scalars().all()
    assert len(rows) == 1
    assert rows[0].endpoint == "chat"
    assert rows[0].model == GRANITE
    assert rows[0].prompt_tokens == 17_000
    assert rows[0].completion_tokens == 2_000
    # A free turn still costs money — that is the whole point.
    assert rows[0].sv_charged == 0
    assert rows[0].cost_usd > 0


@pytest.mark.asyncio
async def test_summary_reports_margin_and_the_free_gap(client, db_session, monkeypatch):
    """The summary must show revenue, cost, and what free cost us."""
    from app.models import AiUsageLog

    user = User(email="cost_sum@test.com", password_hash="hash")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    # One free turn (costs, charges nothing) and one paid turn.
    db_session.add_all([
        AiUsageLog(
            user_id=user.id, endpoint="chat", model=GRANITE,
            prompt_tokens=17_000, completion_tokens=2_000,
            sv_charged=0, cost_usd=model_cost_usd(GRANITE, 17_000, 2_000),
        ),
        AiUsageLog(
            user_id=user.id, endpoint="chat", model=GLM,
            prompt_tokens=17_000, completion_tokens=2_000,
            sv_charged=35, cost_usd=model_cost_usd(GLM, 17_000, 2_000),
        ),
    ])
    await db_session.commit()

    res = await client.get(
        "/api/v1/study/ai-usage/summary?days=30",
        headers=_auth_header(user.id),
    )
    assert res.status_code == 200
    body = res.json()

    assert body["calls"] == 2
    assert body["free_calls_still_costing"]["calls"] == 1
    assert body["free_calls_still_costing"]["cost_usd"] > 0
    assert body["revenue_usd"] > 0
    # Revenue came from the paid turn, cost includes the free one.
    assert body["by_endpoint"]["chat"]["calls"] == 2
    assert body["by_endpoint"]["chat"]["sv_charged"] == 35
    assert body["per_user_cost"]["active_users"] == 1
    assert body["per_user_cost"]["p50"] > 0


@pytest.mark.asyncio
async def test_summary_window_is_bounded(client, db_session, monkeypatch):
    """A nonsense window must not return everything."""
    user = User(email="win@test.com", password_hash="hash")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    for days in (0, -5, 99999):
        res = await client.get(
            f"/api/v1/study/ai-usage/summary?days={days}",
            headers=_auth_header(user.id),
        )
        assert res.status_code == 200
        assert 1 <= res.json()["window_days"] <= 365
