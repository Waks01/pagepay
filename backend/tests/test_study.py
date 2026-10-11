"""Phase 3: AI Study Prep endpoint tests."""

import asyncio
import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models import SowUploadJob, StudyMaterial, StudyAsset, StudyTransaction, User
from app.routers.auth import get_current_user


def _auth_header(user_id: int) -> dict[str, str]:
    from app.services.auth import create_access_token
    return {"Authorization": f"Bearer {create_access_token(user_id)}"}


@pytest.mark.asyncio
async def test_upload_sow_text(client: AsyncClient, db_session):
    user = User(email="study@test.com", password_hash="hash")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    res = await client.post(
        "/api/v1/study/sow/upload",
        json={"text": "Topic 1: Algebra. Subtopic: Equations."},
        headers=_auth_header(user.id),
    )
    assert res.status_code == 201
    data = res.json()
    assert data["material_id"] > 0
    assert data["title"] == "Untitled Material"

    stored = await db_session.execute(select(StudyMaterial).where(StudyMaterial.user_id == user.id))
    assert stored.scalar_one_or_none() is not None


@pytest.mark.asyncio
async def test_list_materials_empty(client: AsyncClient, db_session):
    user = User(email="empty@test.com", password_hash="hash")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    res = await client.get("/api/v1/study/materials", headers=_auth_header(user.id))
    assert res.status_code == 200
    assert res.json() == []


@pytest.mark.asyncio
async def test_unlock_with_points(client: AsyncClient, db_session):
    user = User(email="unlock@test.com", password_hash="hash", points_balance=200)
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    material = StudyMaterial(user_id=user.id, title="Math", raw_input="x=1", parsed_structure='{"topics":[]}')
    db_session.add(material)
    await db_session.commit()
    await db_session.refresh(material)

    asset = StudyAsset(material_id=material.id, asset_type="mcq", content_json='{"questions":[]}', points_to_unlock=50)
    db_session.add(asset)
    await db_session.commit()
    await db_session.refresh(asset)

    res = await client.post(
        "/api/v1/study/unlock",
        json={"asset_id": asset.id, "method": "points"},
        headers=_auth_header(user.id),
    )
    assert res.status_code == 200
    data = res.json()
    assert data["unlocked"] is True
    assert data["new_balance"] == 150

    txn = await db_session.execute(select(StudyTransaction).where(StudyTransaction.asset_id == asset.id))
    assert txn.scalar_one_or_none() is not None


@pytest.mark.asyncio
async def test_unlock_insufficient_points(client: AsyncClient, db_session):
    user = User(email="poor@test.com", password_hash="hash", points_balance=10)
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    material = StudyMaterial(user_id=user.id, title="Math", raw_input="x=1", parsed_structure='{"topics":[]}')
    db_session.add(material)
    await db_session.commit()
    await db_session.refresh(material)

    asset = StudyAsset(material_id=material.id, asset_type="mcq", content_json='{"questions":[]}', points_to_unlock=50)
    db_session.add(asset)
    await db_session.commit()
    await db_session.refresh(asset)

    res = await client.post(
        "/api/v1/study/unlock",
        json={"asset_id": asset.id, "method": "points"},
        headers=_auth_header(user.id),
    )
    assert res.status_code == 402


@pytest.mark.asyncio
async def test_unlock_ad_creates_pending_transaction(client: AsyncClient, db_session):
    user = User(email="ad@test.com", password_hash="hash", points_balance=200)
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    material = StudyMaterial(user_id=user.id, title="Math", raw_input="x=1", parsed_structure='{"topics":[]}')
    db_session.add(material)
    await db_session.commit()
    await db_session.refresh(material)

    asset = StudyAsset(material_id=material.id, asset_type="mcq", content_json='{"questions":[]}', points_to_unlock=50)
    db_session.add(asset)
    await db_session.commit()
    await db_session.refresh(asset)

    res = await client.post(
        "/api/v1/study/unlock",
        json={"asset_id": asset.id, "method": "ad"},
        headers=_auth_header(user.id),
    )
    assert res.status_code == 200
    data = res.json()
    assert data["unlocked"] is False
    assert data["method"] == "ad"


# ── Async SOW job flow (image / document) ───────────────────────────


@pytest.mark.asyncio
async def test_upload_sow_image_returns_job_id(
    client: AsyncClient, db_session, monkeypatch
):
    """The image upload endpoint should return 202 + a job_id immediately,
    NOT block on Cloudflare Vision. The actual AI work happens in a
    background task that we monkey-patch to a fast stub."""
    user = User(email="imgjob@test.com", password_hash="hash")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    # Patch the AI parser to a no-op so the background worker doesn't
    # need a real LLM key. The OCR step is patched too (Cloudflare
    # Vision would otherwise try to hit the live API).
    from app.routers import study as study_router

    async def fake_ocr(contents, content_type):
        return "Topic 1: Algebra. Subtopic: Equations."

    async def fake_parser(extracted_text):
        return ({"title": "Fake Material", "topics": []}, "stub", "{}")

    monkeypatch.setattr(study_router, "_ocr_image_with_cloudflare", fake_ocr)
    monkeypatch.setattr(study_router, "_run_sow_parser", fake_parser)

    res = await client.post(
        "/api/v1/study/sow/upload-image",
        files={"file": ("test.jpg", b"\x00" * 16, "image/jpeg")},
        headers=_auth_header(user.id),
    )
    assert res.status_code == 202
    data = res.json()
    assert "job_id" in data and data["status"] == "queued"

    # Wait for the background worker to flip the job to completed.
    job_id = data["job_id"]
    deadline = asyncio.get_event_loop().time() + 5.0
    while asyncio.get_event_loop().time() < deadline:
        poll = await client.get(
            f"/api/v1/study/sow/jobs/{job_id}", headers=_auth_header(user.id)
        )
        assert poll.status_code == 200
        body = poll.json()
        if body["status"] in ("completed", "failed"):
            break
        await asyncio.sleep(0.05)
    assert body["status"] == "completed", body
    assert isinstance(body["material_id"], int) and body["material_id"] > 0

    # The material row should exist in the DB.
    material = await db_session.get(StudyMaterial, body["material_id"])
    assert material is not None
    assert material.user_id == user.id
    assert material.title == "Fake Material"


@pytest.mark.asyncio
async def test_get_sow_job_status_other_user_404(
    client: AsyncClient, db_session
):
    """User A's job_id must be invisible to user B — 404 on the polling
    endpoint, not 403 (don't leak the existence of the row)."""
    a = User(email="a@job.test", password_hash="hash")
    b = User(email="b@job.test", password_hash="hash")
    db_session.add_all([a, b])
    await db_session.commit()
    await db_session.refresh(a)
    await db_session.refresh(b)

    # Create a job row owned by user A directly (skip the upload
    # endpoint to keep the test focused on the polling authorization
    # check).
    from app.models import SowUploadJob
    import uuid as _uuid
    job = SowUploadJob(id=str(_uuid.uuid4()), user_id=a.id, status="processing")
    db_session.add(job)
    await db_session.commit()

    # User A sees it.
    ok = await client.get(
        f"/api/v1/study/sow/jobs/{job.id}", headers=_auth_header(a.id)
    )
    assert ok.status_code == 200
    assert ok.json()["job_id"] == job.id

    # User B does NOT.
    forbidden = await client.get(
        f"/api/v1/study/sow/jobs/{job.id}", headers=_auth_header(b.id)
    )
    assert forbidden.status_code == 404
