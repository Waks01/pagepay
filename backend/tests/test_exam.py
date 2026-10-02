"""Phase 3: Exam mode endpoint tests."""

import json
from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models import User, StudyMaterial, ExamSession, ExamAnswer
from app.routers import study as study_router


def _auth_header(user_id: int) -> dict[str, str]:
    from app.services.auth import create_access_token
    return {"Authorization": f"Bearer {create_access_token(user_id)}"}


def _fake_mcq_response(count: int = 5) -> str:
    questions = []
    for i in range(count):
        questions.append({
            "id": i + 1,
            "question": f"Test question {i + 1}?",
            "options": [f"Option A", f"Option B", f"Option C", f"Option D"],
            "answer": f"Option A",
            "explanation": f"Explanation for question {i + 1}",
        })
    return json.dumps({"questions": questions})


def _correct_answer_for_question(qid: int) -> str:
    return "Option A"


@pytest.mark.asyncio
async def test_start_exam_creates_session(client: AsyncClient, db_session, monkeypatch):
    user = User(email="exam@test.com", password_hash="hash")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    material = StudyMaterial(
        user_id=user.id,
        title="Test Material",
        raw_input="Topic 1: Algebra. Subtopic: Equations.",
        parsed_structure='{"topics": [{"name": "Algebra", "subtopics": ["Equations"], "key_concepts": []}]}',
    )
    db_session.add(material)
    await db_session.commit()
    await db_session.refresh(material)

    async def fake_route_ai(prompt, task_type, db):
        return {"response": _fake_mcq_response(5), "provider": "stub", "model": "stub"}

    monkeypatch.setattr(study_router, "route_ai", fake_route_ai)

    res = await client.post(
        "/api/v1/study/exam/start",
        json={"material_id": material.id, "exam_type": "jamb"},
        headers=_auth_header(user.id),
    )
    assert res.status_code == 200
    data = res.json()
    assert data["session_id"] > 0
    assert data["exam_type"] == "jamb"
    assert data["total_questions"] == 5
    assert data["duration_seconds"] == 3600
    assert len(data["questions"]) == 5
    assert data["questions"][0]["question"] == "Test question 1?"
    assert "answer" not in data["questions"][0]

    session = await db_session.get(ExamSession, data["session_id"])
    assert session is not None
    assert session.status == "in_progress"
    assert session.user_id == user.id
    assert session.total_questions == 5


@pytest.mark.asyncio
async def test_start_exam_requires_owned_material(client: AsyncClient, db_session, monkeypatch):
    user_a = User(email="a@test.com", password_hash="hash")
    user_b = User(email="b@test.com", password_hash="hash")
    db_session.add_all([user_a, user_b])
    await db_session.commit()
    await db_session.refresh(user_a)
    await db_session.refresh(user_b)

    material = StudyMaterial(
        user_id=user_a.id,
        title="Private Material",
        raw_input="Secret content",
        parsed_structure='{"topics": []}',
    )
    db_session.add(material)
    await db_session.commit()
    await db_session.refresh(material)

    async def fake_route_ai(prompt, task_type, db):
        return {"response": _fake_mcq_response(2), "provider": "stub", "model": "stub"}

    monkeypatch.setattr(study_router, "route_ai", fake_route_ai)

    res = await client.post(
        "/api/v1/study/exam/start",
        json={"material_id": material.id, "exam_type": "custom"},
        headers=_auth_header(user_b.id),
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_get_exam_questions_recovery(client: AsyncClient, db_session, monkeypatch):
    user = User(email="recover@test.com", password_hash="hash")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    material = StudyMaterial(
        user_id=user.id,
        title="Recovery Material",
        raw_input="Topic 1: Math",
        parsed_structure='{"topics": [{"name": "Math", "subtopics": [], "key_concepts": []}]}',
    )
    db_session.add(material)
    await db_session.commit()
    await db_session.refresh(material)

    async def fake_route_ai(prompt, task_type, db):
        return {"response": _fake_mcq_response(3), "provider": "stub", "model": "stub"}

    monkeypatch.setattr(study_router, "route_ai", fake_route_ai)

    start_res = await client.post(
        "/api/v1/study/exam/start",
        json={"material_id": material.id, "exam_type": "waec"},
        headers=_auth_header(user.id),
    )
    assert start_res.status_code == 200
    session_id = start_res.json()["session_id"]

    res = await client.get(
        f"/api/v1/study/exam/{session_id}/questions",
        headers=_auth_header(user.id),
    )
    assert res.status_code == 200
    data = res.json()
    assert data["session_id"] == session_id
    assert data["status"] == "in_progress"
    assert len(data["questions"]) == 3


@pytest.mark.asyncio
async def test_submit_exam_answer_upsert(client: AsyncClient, db_session, monkeypatch):
    user = User(email="answer@test.com", password_hash="hash")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    material = StudyMaterial(
        user_id=user.id,
        title="Answer Material",
        raw_input="Topic 1",
        parsed_structure='{"topics": [{"name": "T1", "subtopics": [], "key_concepts": []}]}',
    )
    db_session.add(material)
    await db_session.commit()
    await db_session.refresh(material)

    async def fake_route_ai(prompt, task_type, db):
        return {"response": _fake_mcq_response(2), "provider": "stub", "model": "stub"}

    monkeypatch.setattr(study_router, "route_ai", fake_route_ai)

    start_res = await client.post(
        "/api/v1/study/exam/start",
        json={"material_id": material.id, "exam_type": "neco"},
        headers=_auth_header(user.id),
    )
    session_id = start_res.json()["session_id"]

    res = await client.post(
        f"/api/v1/study/exam/{session_id}/answer",
        json={"session_id": session_id, "question_id": 1, "selected_answer": "Option A"},
        headers=_auth_header(user.id),
    )
    assert res.status_code == 200
    data = res.json()
    assert data["question_id"] == 1
    assert data["is_correct"] is True

    answer_row = await db_session.execute(
        select(ExamAnswer).where(ExamAnswer.session_id == session_id, ExamAnswer.question_id == 1)
    )
    assert answer_row.scalar_one_or_none() is not None


@pytest.mark.asyncio
async def test_submit_exam_grades_server_side(client: AsyncClient, db_session, monkeypatch):
    user = User(email="grade@test.com", password_hash="hash")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    material = StudyMaterial(
        user_id=user.id,
        title="Grade Material",
        raw_input="Topic 1",
        parsed_structure='{"topics": [{"name": "T1", "subtopics": [], "key_concepts": []}]}',
    )
    db_session.add(material)
    await db_session.commit()
    await db_session.refresh(material)

    async def fake_route_ai(prompt, task_type, db):
        return {"response": _fake_mcq_response(4), "provider": "stub", "model": "stub"}

    monkeypatch.setattr(study_router, "route_ai", fake_route_ai)

    start_res = await client.post(
        "/api/v1/study/exam/start",
        json={"material_id": material.id, "exam_type": "nabteb"},
        headers=_auth_header(user.id),
    )
    session_id = start_res.json()["session_id"]

    for q in start_res.json()["questions"]:
        await client.post(
            f"/api/v1/study/exam/{session_id}/answer",
            json={"session_id": session_id, "question_id": q["id"], "selected_answer": _correct_answer_for_question(q["id"])},
            headers=_auth_header(user.id),
        )

    res = await client.post(
        f"/api/v1/study/exam/{session_id}/submit",
        headers=_auth_header(user.id),
    )
    assert res.status_code == 200
    data = res.json()
    assert data["score"] == 100
    assert data["correct_count"] == 4
    assert data["wrong_count"] == 0
    assert data["passed"] is True
    assert data["total_questions"] == 4

    session = await db_session.get(ExamSession, session_id)
    assert session.status == "submitted"
    assert session.score == 100


@pytest.mark.asyncio
async def test_exam_history_lists_attempts(client: AsyncClient, db_session, monkeypatch):
    user = User(email="hist@test.com", password_hash="hash")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    material = StudyMaterial(
        user_id=user.id,
        title="History Material",
        raw_input="Topic 1",
        parsed_structure='{"topics": [{"name": "T1", "subtopics": [], "key_concepts": []}]}',
    )
    db_session.add(material)
    await db_session.commit()
    await db_session.refresh(material)

    async def fake_route_ai(prompt, task_type, db):
        return {"response": _fake_mcq_response(3), "provider": "stub", "model": "stub"}

    monkeypatch.setattr(study_router, "route_ai", fake_route_ai)

    start_res = await client.post(
        "/api/v1/study/exam/start",
        json={"material_id": material.id, "exam_type": "custom"},
        headers=_auth_header(user.id),
    )
    session_id = start_res.json()["session_id"]

    for q in start_res.json()["questions"]:
        await client.post(
            f"/api/v1/study/exam/{session_id}/answer",
            json={"session_id": session_id, "question_id": q["id"], "selected_answer": _correct_answer_for_question(q["id"])},
            headers=_auth_header(user.id),
        )
    await client.post(
        f"/api/v1/study/exam/{session_id}/submit",
        headers=_auth_header(user.id),
    )

    res = await client.get(
        "/api/v1/study/exam/history",
        headers=_auth_header(user.id),
    )
    assert res.status_code == 200
    data = res.json()
    assert len(data) == 1
    assert data[0]["exam_type"] == "custom"
    assert data[0]["score"] == 100
    assert data[0]["passed"] is True


@pytest.mark.asyncio
async def test_exam_result_detail(client: AsyncClient, db_session, monkeypatch):
    user = User(email="detail@test.com", password_hash="hash")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    material = StudyMaterial(
        user_id=user.id,
        title="Detail Material",
        raw_input="Topic 1",
        parsed_structure='{"topics": [{"name": "T1", "subtopics": [], "key_concepts": []}]}',
    )
    db_session.add(material)
    await db_session.commit()
    await db_session.refresh(material)

    async def fake_route_ai(prompt, task_type, db):
        return {"response": _fake_mcq_response(2), "provider": "stub", "model": "stub"}

    monkeypatch.setattr(study_router, "route_ai", fake_route_ai)

    start_res = await client.post(
        "/api/v1/study/exam/start",
        json={"material_id": material.id, "exam_type": "jamb"},
        headers=_auth_header(user.id),
    )
    session_id = start_res.json()["session_id"]

    for q in start_res.json()["questions"]:
        await client.post(
            f"/api/v1/study/exam/{session_id}/answer",
            json={"session_id": session_id, "question_id": q["id"], "selected_answer": _correct_answer_for_question(q["id"])},
            headers=_auth_header(user.id),
        )
    await client.post(
        f"/api/v1/study/exam/{session_id}/submit",
        headers=_auth_header(user.id),
    )

    res = await client.get(
        f"/api/v1/study/exam/{session_id}/result",
        headers=_auth_header(user.id),
    )
    assert res.status_code == 200
    data = res.json()
    assert data["session_id"] == session_id
    assert data["score"] == 100
    assert len(data["questions"]) == 2
    assert data["questions"][0]["is_correct"] is True
    assert data["questions"][0]["correct_answer"] == "Option A"


@pytest.mark.asyncio
async def test_exam_result_other_user_404(client: AsyncClient, db_session, monkeypatch):
    user_a = User(email="a_result@test.com", password_hash="hash")
    user_b = User(email="b_result@test.com", password_hash="hash")
    db_session.add_all([user_a, user_b])
    await db_session.commit()
    await db_session.refresh(user_a)
    await db_session.refresh(user_b)

    material = StudyMaterial(
        user_id=user_a.id,
        title="Private Result",
        raw_input="Topic 1",
        parsed_structure='{"topics": [{"name": "T1", "subtopics": [], "key_concepts": []}]}',
    )
    db_session.add(material)
    await db_session.commit()
    await db_session.refresh(material)

    async def fake_route_ai(prompt, task_type, db):
        return {"response": _fake_mcq_response(1), "provider": "stub", "model": "stub"}

    monkeypatch.setattr(study_router, "route_ai", fake_route_ai)

    start_res = await client.post(
        "/api/v1/study/exam/start",
        json={"material_id": material.id, "exam_type": "custom"},
        headers=_auth_header(user_a.id),
    )
    session_id = start_res.json()["session_id"]

    for q in start_res.json()["questions"]:
        await client.post(
            f"/api/v1/study/exam/{session_id}/answer",
            json={"session_id": session_id, "question_id": q["id"], "selected_answer": _correct_answer_for_question(q["id"])},
            headers=_auth_header(user_a.id),
        )
    await client.post(
        f"/api/v1/study/exam/{session_id}/submit",
        headers=_auth_header(user_a.id),
    )

    res = await client.get(
        f"/api/v1/study/exam/{session_id}/result",
        headers=_auth_header(user_b.id),
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_submit_exam_without_answers_counts_wrong(client: AsyncClient, db_session, monkeypatch):
    user = User(email="blank@test.com", password_hash="hash")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    material = StudyMaterial(
        user_id=user.id,
        title="Blank Exam",
        raw_input="Topic 1",
        parsed_structure='{"topics": [{"name": "T1", "subtopics": [], "key_concepts": []}]}',
    )
    db_session.add(material)
    await db_session.commit()
    await db_session.refresh(material)

    async def fake_route_ai(prompt, task_type, db):
        return {"response": _fake_mcq_response(3), "provider": "stub", "model": "stub"}

    monkeypatch.setattr(study_router, "route_ai", fake_route_ai)

    start_res = await client.post(
        "/api/v1/study/exam/start",
        json={"material_id": material.id, "exam_type": "custom"},
        headers=_auth_header(user.id),
    )
    session_id = start_res.json()["session_id"]

    res = await client.post(
        f"/api/v1/study/exam/{session_id}/submit",
        headers=_auth_header(user.id),
    )
    assert res.status_code == 200
    data = res.json()
    assert data["score"] == 0
    assert data["correct_count"] == 0
    assert data["wrong_count"] == 3
    assert data["passed"] is False


@pytest.mark.asyncio
async def test_exam_history_empty_when_none(client: AsyncClient, db_session):
    user = User(email="nohistory@test.com", password_hash="hash")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    res = await client.get(
        "/api/v1/study/exam/history",
        headers=_auth_header(user.id),
    )
    assert res.status_code == 200
    assert res.json() == []
