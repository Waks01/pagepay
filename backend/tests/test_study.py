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
async def test_upload_sow_text(client: AsyncClient, db_session, monkeypatch):
    from app.routers import study as study_router

    # Stub the AI so the test is hermetic: no live Cloudflare call, and
    # the title comes from the stub instead of whatever the model
    # happens to return.
    async def fake_route_ai(prompt, task_type="heavy", db=None):
        return {
            "provider": "stub",
            "model": "stub-model",
            "response": '{"title": "Algebra Equations", "topics": []}',
        }

    monkeypatch.setattr(study_router, "route_ai", fake_route_ai)

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
    assert data["title"] == "Algebra Equations"

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
    # With the wallet split on, `points` (and its `sv` alias) debits
    # `service_credit_balance` — fund that wallet, not the legacy
    # `points_balance`.
    user = User(
        email="unlock@test.com",
        password_hash="hash",
        points_balance=200,
        service_credit_balance=200,
    )
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
async def test_unlock_ad_method_is_rejected(client: AsyncClient, db_session):
    """Asset unlock is points/service-credits only.

    The "ad" unlock method was UI fiction — the rewarded-ad pipeline was
    removed backend-wide, so the endpoint used to reject it after the
    fact (400) and the schema now refuses it at validation (422). Either
    way: no unlock, no ledger row.
    """
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
    assert res.status_code in (400, 422)

    txn = await db_session.execute(select(StudyTransaction).where(StudyTransaction.asset_id == asset.id))
    assert txn.scalar_one_or_none() is None


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

    async def fake_ocr(contents, content_type, **kwargs):
        return "Topic 1: Algebra. Subtopic. Equations."

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

    # The job row must exist in the DB (created by the endpoint handler).
    from app.models import SowUploadJob
    import uuid as _uuid
    job = await db_session.get(SowUploadJob, data["job_id"])
    assert job is not None
    assert job.user_id == user.id
    assert job.status == "queued"


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


def _build_scanned_pdf() -> bytes:
    """A PDF with no text layer — the shape a scan or a photo takes.

    The words live in the page image, so there is nothing for a text
    extractor to find. This is the case that used to reach the AI as an
    empty string.
    """
    fitz = pytest.importorskip("fitz")

    doc = fitz.open()
    page = doc.new_page(width=300, height=200)
    # A 1x1 black PNG is enough — the test asserts the page was
    # rendered and handed to OCR, not what the OCR made of it.
    page.draw_rect(fitz.Rect(10, 10, 290, 190), color=(0, 0, 0), fill=(0, 0, 0))
    data = doc.tobytes()
    doc.close()
    return data


@pytest.mark.asyncio
async def test_pdf_is_rendered_to_images_and_ocrd(monkeypatch):
    """A PDF is read as pictures, not as embedded text.

    Regression test for "the AI can't see the PDF". The document route
    used to extract the PDF's text layer, which a scan or a photo does
    not have, so the parser received an empty string. The PDF is now
    rendered page by page and each page is sent to the same vision
    model the image-upload route uses.
    """
    from app.routers import study as study_router

    rendered: list[list[int]] = []
    ocr_calls: list[bytes] = []

    def fake_render(contents: bytes, page_numbers: list[int]) -> list[bytes]:
        rendered.append(list(page_numbers))
        return [b"\xff\xd8\xff-jpeg-page-bytes" for _ in page_numbers]

    async def fake_ocr(contents: bytes, content_type: str, **kwargs) -> str:
        ocr_calls.append(contents)
        return "Scheme of Work. Topic 1: Algebra. Subtopic: Equations."

    monkeypatch.setattr(study_router, "_render_pdf_pages_for_ocr", fake_render)
    monkeypatch.setattr(study_router, "_ocr_image_with_cloudflare", fake_ocr)

    pdf_bytes = _build_scanned_pdf()
    text = await study_router._extract_document_text(
        pdf_bytes, "syllabus.pdf", selected_pages="[1]"
    )

    # The page was rendered and handed to the vision model.
    assert rendered == [[1]]
    assert len(ocr_calls) == 1
    assert ocr_calls[0] == b"\xff\xd8\xff-jpeg-page-bytes"
    # And the parser gets the words, not an empty string.
    assert "Algebra" in text


@pytest.mark.asyncio
async def test_pdf_page_selection_is_honoured(monkeypatch):
    """Only the pages the user ticked in the preview are read."""
    from app.routers import study as study_router

    rendered: list[list[int]] = []

    def fake_render(contents: bytes, page_numbers: list[int]) -> list[bytes]:
        rendered.append(list(page_numbers))
        return [b"jpeg" for _ in page_numbers]

    async def fake_ocr(contents: bytes, content_type: str, **kwargs) -> str:
        return "page text"

    monkeypatch.setattr(study_router, "_render_pdf_pages_for_ocr", fake_render)
    monkeypatch.setattr(study_router, "_ocr_image_with_cloudflare", fake_ocr)

    fitz = pytest.importorskip("fitz")
    doc = fitz.open()
    for _ in range(3):
        doc.new_page(width=300, height=200)
    pdf_bytes = doc.tobytes()
    doc.close()

    await study_router._extract_document_text(
        pdf_bytes, "syllabus.pdf", selected_pages="[1, 3]"
    )
    assert rendered == [[1, 3]]


@pytest.mark.asyncio
async def test_sow_job_status_reports_progress(client: AsyncClient, db_session):
    """The polling endpoint exposes the worker's real progress + stage.

    Without these the client had to fake progress with a 1%-per-poll
    tick, which left the user watching a bar crawl with no idea what
    was happening.
    """
    import uuid as _uuid

    user = User(email="progress@job.test", password_hash="hash")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    job = SowUploadJob(
        id=str(_uuid.uuid4()),
        user_id=user.id,
        status="processing",
        progress=45,
        stage="reading_pages",
    )
    db_session.add(job)
    await db_session.commit()

    res = await client.get(
        f"/api/v1/study/sow/jobs/{job.id}", headers=_auth_header(user.id)
    )
    assert res.status_code == 200
    body = res.json()
    assert body["progress"] == 45
    assert body["stage"] == "reading_pages"
