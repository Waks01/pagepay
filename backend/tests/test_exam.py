"""Phase 3: Exam mode endpoint tests."""

import json
import re
from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models import User, StudyMaterial, ExamSession, ExamAnswer
from app.routers import study as study_router


def _auth_header(user_id: int) -> dict[str, str]:
    from app.services.auth import create_access_token
    return {"Authorization": f"Bearer {create_access_token(user_id)}"}


# Mirrors what MCQ_ALL_TOPICS_GENERATOR actually asks the model to
# return: `correct_index` plus no per-question id and no literal answer.
# Deliberately NOT the normalized shape — emitting the normalized shape
# here would hide the field-mismatch bug _normalize_exam_questions fixes.
_FAKE_OPTIONS = ["Option A", "Option B", "Option C", "Option D"]
_FAKE_CORRECT_INDEX = 1


def _fake_mcq_response(count: int = 5) -> str:
    questions = []
    for i in range(count):
        questions.append({
            "question": f"Test question {i + 1}?",
            "options": list(_FAKE_OPTIONS),
            "correct_index": _FAKE_CORRECT_INDEX,
            "explanation": f"Explanation for question {i + 1}",
            "topic": "T1",
        })
    return json.dumps({"questions": questions})


def _correct_answer_for_question(qid: int) -> str:
    return _FAKE_OPTIONS[_FAKE_CORRECT_INDEX]


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
    assert data["duration_seconds"] == 1200
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
        json={"session_id": session_id, "question_id": 1, "selected_answer": _correct_answer_for_question(1)},
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
    assert data["questions"][0]["correct_answer"] == _FAKE_OPTIONS[_FAKE_CORRECT_INDEX]


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


# ── Exam-type registry: single source of truth / client sync ─────────


def test_exam_types_registry_is_consistent():
    """The derived dicts must agree with the registry they come from.

    Guards against a board being added to the registry without its
    duration or question count being picked up, and against the
    re-exported EXAM_DURATIONS in the router drifting from the spec.
    """
    from app.exam_types import (
        EXAM_TYPE_KEYS,
        EXAM_TYPE_SPECS,
        EXAM_DURATIONS,
        EXAM_QUESTION_COUNTS,
    )

    assert EXAM_TYPE_KEYS == tuple(spec.key for spec in EXAM_TYPE_SPECS)
    assert len(set(EXAM_TYPE_KEYS)) == len(EXAM_TYPE_KEYS), "keys must be unique"
    assert EXAM_DURATIONS == {s.key: s.duration_minutes for s in EXAM_TYPE_SPECS}
    assert EXAM_QUESTION_COUNTS == {s.key: s.question_count for s in EXAM_TYPE_SPECS}

    # The router re-exports these names; they must be the same objects.
    assert study_router.EXAM_DURATIONS == EXAM_DURATIONS
    assert study_router.EXAM_QUESTION_COUNTS == EXAM_QUESTION_COUNTS

    for spec in EXAM_TYPE_SPECS:
        assert spec.duration_minutes > 0
        assert spec.question_count > 0
        assert spec.label


def test_normalize_exam_type_accepts_casing_and_whitespace():
    from app.exam_types import normalize_exam_type

    assert normalize_exam_type("JAMB") == "jamb"
    assert normalize_exam_type("  waec  ") == "waec"
    assert normalize_exam_type("Nabteb") == "nabteb"
    assert normalize_exam_type(None) is None
    assert normalize_exam_type("   ") is None

    with pytest.raises(ValueError):
        normalize_exam_type("postutme")


def test_exam_types_match_client():
    """The client registry must mirror the backend one.

    Parses page/src/shared/lib/exam-types.ts and asserts the keys,
    durations and question counts match. This is the guard that keeps
    the Exam Mode setup screen from showing a duration the server
    disagrees with — a drift that shipped once already.
    """
    import re
    from pathlib import Path
    from app.exam_types import EXAM_TYPE_SPECS

    spec_by_key = {spec.key: spec for spec in EXAM_TYPE_SPECS}

    # Repo root is two levels above this file's directory (backend/tests).
    repo_root = Path(__file__).resolve().parents[2]
    ts_path = repo_root / "page" / "src" / "shared" / "lib" / "exam-types.ts"
    assert ts_path.exists(), f"client registry not found at {ts_path}"

    source = ts_path.read_text(encoding="utf-8")

    # Each entry looks like:
    #   { key: "jamb", label: "JAMB", duration: 20, questions: 20 },
    parsed = {
        m.group("key"): (
            m.group("label"),
            int(m.group("duration")),
            int(m.group("questions")),
        )
        for m in re.finditer(
            r'\{\s*key:\s*"(?P<key>\w+)"\s*,\s*'
            r'label:\s*"(?P<label>[^"]*)"\s*,\s*'
            r'duration:\s*(?P<duration>\d+)\s*,\s*'
            r'questions:\s*(?P<questions>\d+)\s*\}',
            source,
        )
    }
    assert parsed, "no exam type entries parsed from client registry"

    assert set(parsed) == set(spec_by_key), (
        f"client keys {sorted(parsed)} != backend keys {sorted(spec_by_key)}"
    )

    for key, spec in spec_by_key.items():
        client_label, client_duration, client_questions = parsed[key]
        assert client_duration == spec.duration_minutes, (
            f"{key}: client duration {client_duration} != "
            f"backend {spec.duration_minutes}"
        )
        assert client_questions == spec.question_count, (
            f"{key}: client questions {client_questions} != "
            f"backend {spec.question_count}"
        )
        assert client_label == spec.label, (
            f"{key}: client label {client_label!r} != backend {spec.label!r}"
        )


# ── MCQ context builder: real content, not just the outline ─────────
"""Refresh the material-context tests for the teaching-layer contract.

The context builder was reworked: the teaching layer (the material
rewritten in plain language) is now the primary source, the outline
travels with it, and the verbatim source is included only where there is
room. The exam/MCQ generators deliberately drop the verbatim source -
a question has no room for two versions of the same material.

These tests were written against the earlier outline-plus-source
contract and had to be rewritten to match.
"""


class _FakeMaterial:
    """A stand-in for StudyMaterial with the fields the builder reads."""

    def __init__(self, parsed, raw, explanation=None):
        self.parsed_structure = parsed
        self.raw_input = raw
        self.explanation_structure = explanation


_TEST_OUTLINE = (
    '{"topics": [{"name": "Cell Biology", '
    '"subtopics": ["Mitochondria"], '
    '"key_concepts": ["ATP synthesis"]}]}'
)
_TEST_RAW = (
    "The mitochondrion is the site of aerobic respiration. Its inner "
    "membrane is folded into cristae, which increase surface area for "
    "the electron transport chain. ATP synthase enzymes use the proton "
    "gradient to phosphorylate ADP into ATP."
)
# A minimal teaching layer: the material rewritten in plain language.
# The shape is {"blocks": [...]} with a "type" per block - "body" for
# prose, which is what the generators read.
_TEST_LESSON = {
    "blocks": [
        {
            "type": "body",
            "text": (
                "The mitochondrion is the powerhouse of the cell. It folds "
                "its inner membrane into cristae so the electron transport "
                "chain has room to work, and ATP synthase uses the "
                "resulting proton gradient to make ATP."
            ),
        }
    ]
}


def test_mcq_context_is_built_from_the_teaching_layer():
    """The generator must receive the lesson, not just an outline.

    Questions built from topic headings alone come out shallow and
    purely recall-shaped, which is what the outline-only context
    produced. The lesson is what the student was actually taught, so it
    is what the questions should be written from.
    """
    from app.routers.study import _build_mcq_context

    ctx = _build_mcq_context(
        _FakeMaterial(_TEST_OUTLINE, _TEST_RAW, _TEST_LESSON)
    )
    assert "Cell Biology" in ctx, "topic outline should be included"
    assert "Mitochondria" in ctx
    assert "powerhouse of the cell" in ctx, "the lesson must be included"
    assert "cristae" in ctx


def test_mcq_context_drops_the_verbatim_source():
    """The exam prompt has room for one version of the material, not two.

    The lesson is the version to question from, and the source is
    dropped so the context stays inside the budget.
    """
    from app.routers.study import _build_mcq_context

    ctx = _build_mcq_context(
        _FakeMaterial(_TEST_OUTLINE, _TEST_RAW, _TEST_LESSON)
    )
    assert "ATP synthase enzymes use the proton" not in ctx, (
        "the verbatim source should be dropped for exam questions"
    )


def test_mcq_context_falls_back_when_there_is_no_lesson():
    """A material uploaded before the teaching layer existed still works."""
    from app.routers.study import _build_mcq_context

    ctx = _build_mcq_context(_FakeMaterial(_TEST_OUTLINE, ""))
    assert "Cell Biology" in ctx
    assert "truncated" not in ctx


def test_mcq_context_handles_missing_fields():
    """A material with no parsed structure and no lesson must degrade."""
    from app.routers.study import _build_mcq_context

    ctx = _build_mcq_context(_FakeMaterial(None, "", None))
    assert "no study material" in ctx

    # A corrupt structure must not raise either.
    ctx2 = _build_mcq_context(_FakeMaterial("{not json", "", None))
    assert "no study material" in ctx2


def test_mcq_context_truncates_oversized_material():
    """An oversized lesson is marked, not silently cut."""
    from app.routers.study import _build_mcq_context, _MCQ_CONTEXT_CHARS

    big_lesson = {
        "blocks": [
            {"type": "body", "text": "x" * (_MCQ_CONTEXT_CHARS * 2)}
        ]
    }
    ctx = _build_mcq_context(_FakeMaterial(_TEST_OUTLINE, "", big_lesson))
    assert len(ctx) <= _MCQ_CONTEXT_CHARS + 500
    assert "continues beyond the space" in ctx


def test_asset_context_uses_the_lesson_only():
    """Assets carry the teaching layer, not the verbatim source.

    The lesson is the material rewritten in plain language, and it is
    what a flashcard or an essay should be built on. The verbatim
    source is only kept where there is room for both - which is the
    tutor, the one place a dropped fact would actually mislead a
    student mid-explanation.
    """
    from app.routers.study import _build_asset_context

    ctx = _build_asset_context(
        _FakeMaterial(_TEST_OUTLINE, _TEST_RAW, _TEST_LESSON)
    )
    assert "powerhouse of the cell" in ctx, "the lesson must be present"
    assert "ATP synthase enzymes use the proton" not in ctx, (
        "the verbatim source is dropped for asset generation"
    )


def test_tutor_context_keeps_both_versions():
    """The tutor is the one context that carries the source as well.

    If a fact was dropped when the lesson was rewritten, the tutor must
    still be able to find it.
    """
    from app.routers.study import build_material_context

    ctx = build_material_context(
        _TEST_OUTLINE,
        _TEST_RAW,
        budget=100_000,
        outline_label="Syllabus outline (the topics this material covers):",
        explanation_structure=_TEST_LESSON,
        include_source=True,
    )
    assert "powerhouse of the cell" in ctx, "the lesson must be present"
    assert "ATP synthase enzymes use the proton" in ctx, (
        "the verbatim source must be present for the tutor"
    )


# ── Prompt wiring: difficulty and board style actually reach the prompt ─


def test_mcq_prompt_has_no_literal_difficulty():
    """`difficulty` must be interpolated, not baked as the literal 'medium'.

    The template previously contained "- Difficulty: medium" while
    callers passed difficulty=... which Python silently ignored, making
    the difficulty control a no-op.
    """
    from app.ai.prompts import MCQ_ALL_TOPICS_GENERATOR

    assert "{difficulty}" in MCQ_ALL_TOPICS_GENERATOR
    assert "{exam_style}" in MCQ_ALL_TOPICS_GENERATOR
    assert "Difficulty: medium" not in MCQ_ALL_TOPICS_GENERATOR


def test_mcq_prompt_renders_all_fields():
    """The prompt renders through render_prompt, which fills in the
    teach-from-lesson rule by default."""
    from app.ai.prompts import (
        MCQ_ALL_TOPICS_GENERATOR,
        EXAM_STYLE_GUIDES,
        DIFFICULTY_GUIDES,
        render_prompt,
    )

    rendered = render_prompt(
        MCQ_ALL_TOPICS_GENERATOR,
        context="ctx",
        count=5,
        exam_style=EXAM_STYLE_GUIDES["jamb"],
        difficulty=DIFFICULTY_GUIDES["hard"],
    )
    assert "ctx" in rendered
    assert "Exactly 5 questions" in rendered
    assert "Application and analysis" in rendered
    assert "JAMB-style objective questions" in rendered
    assert "Write from it" in rendered, "the teach-from-lesson rule is missing"
    assert not re.search(r"\{[a-z_]+\}", rendered), "no unformatted placeholders"


def test_exam_style_guides_cover_every_board():
    from app.ai.prompts import DIFFICULTY_GUIDES, EXAM_STYLE_GUIDES
    from app.exam_types import EXAM_TYPE_KEYS

    missing = set(EXAM_TYPE_KEYS) - set(EXAM_STYLE_GUIDES)
    assert not missing, f"no style guide for: {sorted(missing)}"
    # Difficulty must include all three levels a caller can request.
    for level in ("easy", "medium", "hard"):
        assert level in DIFFICULTY_GUIDES, f"no difficulty guide for {level}"

