"""Phase 3: AI study-tutor chat endpoint tests.

Covers the fixes from the AI-chat investigation:
- level/difficulty/language/history must reach the router (they used
  to be query params the client never sent)
- a failing provider returns 503 instead of a silent empty stream
- the daily quota admits up to the limit, then 429s, and refunds
  failed calls
"""

import pytest
from fastapi import HTTPException
from httpx import AsyncClient

from app.models import User, StudyMaterial
from app.routers import study as study_router


def _auth_header(user_id: int) -> dict[str, str]:
    from app.services.auth import create_access_token
    return {"Authorization": f"Bearer {create_access_token(user_id)}"}


async def _seed_material(db_session, user: User, title: str = "Chat Material") -> StudyMaterial:
    material = StudyMaterial(
        user_id=user.id,
        title=title,
        raw_input="Topic 1: Photosynthesis.",
        parsed_structure=(
            '{"topics": [{"name": "Photosynthesis", '
            '"subtopics": ["Light reactions"], "key_concepts": []}]}'
        ),
    )
    db_session.add(material)
    await db_session.commit()
    await db_session.refresh(material)
    return material


@pytest.mark.asyncio
async def test_chat_passes_level_difficulty_language_and_history(
    client: AsyncClient, db_session, monkeypatch
):
    """The settings UI must reach the model call: education level,
    difficulty, language, and prior turns arrive at the router."""
    user = User(email="chat1@test.com", password_hash="hash")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    material = await _seed_material(db_session, user)

    captured: dict = {}

    async def fake_route_ai(prompt, task_type, max_tokens=None, db=None,
                            system_prompt=None, history=None):
        captured.update(
            prompt=prompt,
            task_type=task_type,
            system_prompt=system_prompt,
            history=history,
        )
        return {"response": "Photosynthesis converts light to energy.",
                "provider": "stub", "model": "stub", "usage": {}}

    monkeypatch.setattr(study_router, "route_ai", fake_route_ai)

    res = await client.post(
        "/api/v1/study/chat",
        json={
            "material_id": material.id,
            "message": "What is photosynthesis?",
            "education_level": "tertiary",
            "difficulty": "hard",
            "language": "ha",
            "history": [
                {"role": "user", "content": "hi"},
                {"role": "assistant", "content": "Hello!"},
            ],
        },
        headers=_auth_header(user.id),
    )
    assert res.status_code == 200
    assert res.text.strip() == "Photosynthesis converts light to energy."

    # Body params, not query params — the old signature silently
    # dropped these and every chat ran secondary/medium/English.
    assert "Education Level: tertiary" in captured["system_prompt"]
    assert "Difficulty: hard" in captured["system_prompt"]
    assert "Hausa" in captured["system_prompt"]
    assert captured["task_type"] == "chat"
    assert captured["history"] == [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "Hello!"},
    ]


@pytest.mark.asyncio
async def test_chat_other_users_material_404(
    client: AsyncClient, db_session, monkeypatch
):
    """Ownership is still enforced: someone else's material is a 404,
    not the tutor answering about it."""
    owner = User(email="owner@test.com", password_hash="hash")
    intruder = User(email="intruder@test.com", password_hash="hash")
    db_session.add_all([owner, intruder])
    await db_session.commit()
    await db_session.refresh(owner)
    await db_session.refresh(intruder)
    material = await _seed_material(db_session, owner)

    async def fake_route_ai(*args, **kwargs):  # pragma: no cover
        raise AssertionError("route_ai must not be called")

    monkeypatch.setattr(study_router, "route_ai", fake_route_ai)

    res = await client.post(
        "/api/v1/study/chat",
        json={"material_id": material.id, "message": "hi"},
        headers=_auth_header(intruder.id),
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_chat_provider_failure_returns_503(
    client: AsyncClient, db_session, monkeypatch
):
    """The model call happens before streaming starts, so a provider
    outage surfaces as a 503 the client can render as an error —
    not a silent empty bubble on an already-committed 200."""
    user = User(email="chat2@test.com", password_hash="hash")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    material = await _seed_material(db_session, user)

    async def failing_route_ai(*args, **kwargs):
        raise HTTPException(status_code=503, detail="Cloudflare AI unavailable")

    monkeypatch.setattr(study_router, "route_ai", failing_route_ai)

    res = await client.post(
        "/api/v1/study/chat",
        json={"material_id": material.id, "message": "hi"},
        headers=_auth_header(user.id),
    )
    assert res.status_code == 503
    assert "Cloudflare" in res.json()["detail"]


@pytest.mark.asyncio
async def test_chat_daily_quota_and_refund(
    client: AsyncClient, db_session, monkeypatch
):
    """The quota admits up to the limit, then 429s, and a failed
    model call refunds its slot so an outage doesn't burn the day."""
    from app.config import settings

    user = User(email="chat3@test.com", password_hash="hash")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    material = await _seed_material(db_session, user)

    calls = {"n": 0}

    async def fake_route_ai(prompt, task_type, max_tokens=None, db=None,
                            system_prompt=None, history=None):
        calls["n"] += 1
        if calls["n"] == 1:
            raise HTTPException(status_code=503, detail="Cloudflare AI unavailable")
        return {"response": "ok", "provider": "stub", "model": "stub", "usage": {}}

    monkeypatch.setattr(study_router, "route_ai", fake_route_ai)
    monkeypatch.setattr(settings, "study_chat_daily_limit", 2)
    monkeypatch.setattr(settings, "study_chat_premium_daily_limit", 2)

    def post():
        return client.post(
            "/api/v1/study/chat",
            json={"material_id": material.id, "message": "hi"},
            headers=_auth_header(user.id),
        )

    # First call fails — slot refunded.
    res = await post()
    assert res.status_code == 503

    # Two successful calls consume the limit of 2.
    assert (await post()).status_code == 200
    assert (await post()).status_code == 200

    # Third is over quota.
    res = await post()
    assert res.status_code == 429
    assert "Daily AI chat limit" in res.json()["detail"]


@pytest.mark.asyncio
async def test_chat_survives_malformed_parsed_structure(
    client: AsyncClient, db_session, monkeypatch
):
    """A material whose parsed_structure is not valid JSON (or has
    unexpected topic shapes) must not 500 the chat endpoint.

    The broken structure must also not cost the student their material:
    `raw_input` is still usable, and a model that can see only headings
    cannot teach. So the raw text has to reach the prompt.
    """
    user = User(email="chat4@test.com", password_hash="hash")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    material = StudyMaterial(
        user_id=user.id,
        title="Broken Material",
        raw_input="The mitochondrion is the powerhouse of the cell.",
        parsed_structure="not json at all",
    )
    db_session.add(material)
    await db_session.commit()
    await db_session.refresh(material)

    async def fake_route_ai(prompt, task_type, max_tokens=None, db=None,
                            system_prompt=None, history=None):
        # The material survives the unparseable structure.
        assert "powerhouse of the cell" in (system_prompt or "")
        # And it is not silently presented as the whole story.
        assert "No structured context available." not in (system_prompt or "")
        return {"response": "still here", "provider": "stub", "model": "stub", "usage": {}}

    monkeypatch.setattr(study_router, "route_ai", fake_route_ai)

    res = await client.post(
        "/api/v1/study/chat",
        json={"material_id": material.id, "message": "hi"},
        headers=_auth_header(user.id),
    )
    assert res.status_code == 200
    assert res.text.strip() == "still here"


@pytest.mark.asyncio
async def test_chat_sends_the_full_material_not_just_the_outline(
    client: AsyncClient, db_session, monkeypatch
):
    """The tutor must receive the student's actual material.

    This regressed to outline-only: chat built its context from the
    `topics`/`subtopics` names and nothing else, so the model was asked
    to teach from a table of contents. `raw_input` was right there and
    unused.
    """
    user = User(email="chat5@test.com", password_hash="hash")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    material = StudyMaterial(
        user_id=user.id,
        title="Full Material",
        raw_input=(
            "The cell membrane is selectively permeable. Water moves "
            "across it by osmosis, from a dilute solution to a "
            "concentrated one. A red blood cell bursts in distilled "
            "water for exactly this reason."
        ),
        parsed_structure=(
            '{"topics": [{"name": "Cell Structure", '
            '"subtopics": ["Cell Membrane"], "key_concepts": ["Osmosis"]}]}'
        ),
    )
    db_session.add(material)
    await db_session.commit()
    await db_session.refresh(material)

    seen: dict[str, str] = {}

    async def fake_route_ai(prompt, task_type, max_tokens=None, db=None,
                            system_prompt=None, history=None):
        seen["system"] = system_prompt or ""
        return {"response": "ok", "provider": "stub", "model": "stub", "usage": {}}

    monkeypatch.setattr(study_router, "route_ai", fake_route_ai)

    res = await client.post(
        "/api/v1/study/chat",
        json={"material_id": material.id, "message": "why does a cell burst?"},
        headers=_auth_header(user.id),
    )
    assert res.status_code == 200

    prompt = seen["system"]
    # The outline still arrives, so the model knows the structure.
    assert "Cell Structure" in prompt
    assert "Cell Membrane" in prompt
    # But the material itself must be there too — not a substitute.
    assert "selectively permeable" in prompt, "material text missing"
    assert "red blood cell bursts" in prompt, "tail of material missing"
    assert "No structured context available." not in prompt