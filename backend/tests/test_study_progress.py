"""Per-topic study progress: quiz roll-up, upsert semantics, read path.

The progress dashboard has had a read path since Phase 3 but no writer —
`POST /study/progress` was insert-only and no client ever called it, so
the section always rendered 0% mastered. These tests pin the contract
that now makes it real:

- quiz completion on a single-topic asset upserts that topic's row
  (mastered at >= BONUS_THRESHOLD, reviewing below it)
- all-topics assets stay out of per-topic progress
- repeated attempts update one row, never demote, never duplicate
- GET returns exactly one entry per parsed topic, untouched ones
  reported as not_started
"""

import json

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models import StudyAsset, StudyMaterial, StudyProgress, User
from app.routers import study as study_router


MATERIAL_STRUCTURE = json.dumps(
    {
        "topics": [
            {"name": "Algebra", "subtopics": ["Equations"], "key_concepts": ["x"]},
            {"name": "Geometry", "subtopics": ["Shapes"], "key_concepts": []},
        ]
    }
)


def _auth_header(user_id: int) -> dict[str, str]:
    from app.services.auth import create_access_token

    return {"Authorization": f"Bearer {create_access_token(user_id)}"}


async def _make_user(db_session, email: str) -> User:
    user = User(email=email, password_hash="hash")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _make_material(db_session, user: User, structure: str = MATERIAL_STRUCTURE) -> StudyMaterial:
    material = StudyMaterial(
        user_id=user.id,
        title="Progress Material",
        raw_input="Topic 1: Algebra. Subtopic: Equations.",
        parsed_structure=structure,
    )
    db_session.add(material)
    await db_session.commit()
    await db_session.refresh(material)
    return material


def _make_asset(material: StudyMaterial, topic: str | None = "Algebra") -> StudyAsset:
    return StudyAsset(
        material_id=material.id,
        asset_type="mcq",
        content_json=json.dumps(
            {"questions": [{"question": "1+1?", "options": ["1", "2"], "correct_index": 1, "explanation": "math"}]}
        ),
        topic=topic,
    )


def _quiz_body(asset_id: int, score: int) -> dict:
    return {"asset_id": asset_id, "score": score}


@pytest.fixture
def silence_background_notifications(monkeypatch):
    """Bonus-scoring quizzes fan out FCM + DB notification tasks; keep
    them from touching the real app database during tests."""

    async def _noop(*args, **kwargs) -> None:
        return None

    monkeypatch.setattr("app.services.fcm.send_push_notification_background", _noop)
    monkeypatch.setattr("app.services.notifications.create_notification_background", _noop)


@pytest.mark.asyncio
async def test_quiz_complete_high_score_masters_topic(client: AsyncClient, db_session, silence_background_notifications):
    user = await _make_user(db_session, "mastered@test.com")
    material = await _make_material(db_session, user)
    asset = _make_asset(material)
    db_session.add(asset)
    await db_session.commit()
    await db_session.refresh(asset)

    res = await client.post(
        "/api/v1/study/quiz/complete",
        json=_quiz_body(asset.id, 100),
        headers=_auth_header(user.id),
    )
    assert res.status_code == 200

    rows = (await db_session.execute(select(StudyProgress))).scalars().all()
    assert len(rows) == 1
    row = rows[0]
    assert row.topic_name == "Algebra"
    assert row.status == "mastered"
    assert row.mastery_score == 100
    assert row.topic_index == 0
    assert row.last_reviewed_at is not None


@pytest.mark.asyncio
async def test_quiz_complete_low_score_marks_reviewing(client: AsyncClient, db_session, silence_background_notifications):
    user = await _make_user(db_session, "reviewing@test.com")
    material = await _make_material(db_session, user)
    asset = _make_asset(material)
    db_session.add(asset)
    await db_session.commit()
    await db_session.refresh(asset)

    res = await client.post(
        "/api/v1/study/quiz/complete",
        json=_quiz_body(asset.id, 60),
        headers=_auth_header(user.id),
    )
    assert res.status_code == 200

    row = (await db_session.execute(select(StudyProgress))).scalar_one()
    assert row.status == "reviewing"
    assert row.mastery_score == 60


@pytest.mark.asyncio
async def test_quiz_complete_all_topics_asset_writes_no_progress(client: AsyncClient, db_session, silence_background_notifications):
    user = await _make_user(db_session, "alltopics@test.com")
    material = await _make_material(db_session, user)
    asset = _make_asset(material, topic=None)
    db_session.add(asset)
    await db_session.commit()
    await db_session.refresh(asset)

    res = await client.post(
        "/api/v1/study/quiz/complete",
        json=_quiz_body(asset.id, 100),
        headers=_auth_header(user.id),
    )
    assert res.status_code == 200

    rows = (await db_session.execute(select(StudyProgress))).scalars().all()
    assert rows == []

    res = await client.get(
        f"/api/v1/study/materials/{material.id}/progress",
        headers=_auth_header(user.id),
    )
    assert res.status_code == 200
    body = res.json()
    assert body["total_topics"] == 2
    assert body["mastered"] == 0
    assert body["reviewing"] == 0
    assert body["not_started"] == 2
    assert all(item["status"] == "not_started" for item in body["progress"])


@pytest.mark.asyncio
async def test_retake_keeps_mastered_status_and_best_score(client: AsyncClient, db_session, silence_background_notifications):
    user = await _make_user(db_session, "retake@test.com")
    material = await _make_material(db_session, user)
    asset = _make_asset(material)
    db_session.add(asset)
    await db_session.commit()
    await db_session.refresh(asset)

    for score in (100, 40, 90):
        res = await client.post(
            "/api/v1/study/quiz/complete",
            json=_quiz_body(asset.id, score),
            headers=_auth_header(user.id),
        )
        assert res.status_code == 200

    rows = (await db_session.execute(select(StudyProgress))).scalars().all()
    assert len(rows) == 1
    row = rows[0]
    assert row.status == "mastered"
    assert row.mastery_score == 100


@pytest.mark.asyncio
async def test_post_progress_upserts_single_row(client: AsyncClient, db_session):
    user = await _make_user(db_session, "upsert@test.com")
    material = await _make_material(db_session, user)
    headers = _auth_header(user.id)

    res = await client.post(
        "/api/v1/study/progress",
        json={
            "material_id": material.id,
            "topic_name": "Algebra",
            "status": "reviewing",
            "mastery_score": 55,
        },
        headers=headers,
    )
    assert res.status_code == 201
    first_id = res.json()["id"]

    # A bare topic_name (no topic_index) must resolve to the same row,
    # and a weaker follow-up status must not demote it.
    res = await client.post(
        "/api/v1/study/progress",
        json={
            "material_id": material.id,
            "topic_name": "Algebra",
            "status": "reviewing",
            "mastery_score": 40,
        },
        headers=headers,
    )
    assert res.status_code == 201
    assert res.json()["id"] == first_id

    rows = (await db_session.execute(select(StudyProgress))).scalars().all()
    assert len(rows) == 1
    row = rows[0]
    assert row.topic_index == 0
    assert row.mastery_score == 55
    assert row.last_reviewed_at is not None

    res = await client.post(
        "/api/v1/study/progress",
        json={"material_id": material.id, "topic_name": "Geometry", "status": "mastered", "mastery_score": 88},
        headers=headers,
    )
    assert res.status_code == 201

    rows = (await db_session.execute(select(StudyProgress))).scalars().all()
    assert len(rows) == 2


@pytest.mark.asyncio
async def test_get_progress_returns_entry_per_topic(client: AsyncClient, db_session):
    user = await _make_user(db_session, "read@test.com")
    material = await _make_material(db_session, user)
    headers = _auth_header(user.id)

    res = await client.post(
        "/api/v1/study/progress",
        json={"material_id": material.id, "topic_name": "Algebra", "status": "reviewing", "mastery_score": 50},
        headers=headers,
    )
    assert res.status_code == 201

    res = await client.get(f"/api/v1/study/materials/{material.id}/progress", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["total_topics"] == 2
    assert body["mastered"] == 0
    assert body["reviewing"] == 1
    assert body["not_started"] == 1
    assert len(body["progress"]) == 2

    algebra = next(i for i in body["progress"] if i["topic_name"] == "Algebra")
    geometry = next(i for i in body["progress"] if i["topic_name"] == "Geometry")
    assert algebra["status"] == "reviewing"
    assert algebra["mastery_score"] == 50
    assert geometry["status"] == "not_started"
    assert geometry["id"] is None


@pytest.mark.asyncio
async def test_get_progress_other_user_404(client: AsyncClient, db_session):
    owner = await _make_user(db_session, "owner@test.com")
    intruder = await _make_user(db_session, "intruder@test.com")
    material = await _make_material(db_session, owner)

    res = await client.get(
        f"/api/v1/study/materials/{material.id}/progress",
        headers=_auth_header(intruder.id),
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_generate_topic_asset_persists_topic_and_rolls_up(
    client: AsyncClient, db_session, monkeypatch, silence_background_notifications
):
    user = await _make_user(db_session, "generate@test.com")
    material = await _make_material(db_session, user)
    headers = _auth_header(user.id)

    async def fake_route_ai(prompt, task_type, db):
        return {
            "response": json.dumps(
                {
                    "questions": [
                        {
                            "question": "Solve 2x = 4",
                            "options": ["1", "2"],
                            "correct_index": 1,
                            "explanation": "divide both sides",
                        }
                    ]
                }
            ),
            "provider": "stub",
            "model": "stub",
        }

    monkeypatch.setattr(study_router, "route_ai", fake_route_ai)

    res = await client.post(
        "/api/v1/study/generate",
        json={
            "material_id": material.id,
            "asset_type": "mcq",
            "mode": "topic",
            "topic": "Algebra",
            "count": 1,
        },
        headers=headers,
    )
    assert res.status_code == 200

    asset = (await db_session.execute(select(StudyAsset))).scalar_one()
    assert asset.topic == "Algebra"

    res = await client.post(
        "/api/v1/study/quiz/complete",
        json=_quiz_body(asset.id, 85),
        headers=headers,
    )
    assert res.status_code == 200

    row = (await db_session.execute(select(StudyProgress))).scalar_one()
    assert row.topic_name == "Algebra"
    assert row.status == "mastered"
    assert row.mastery_score == 85
