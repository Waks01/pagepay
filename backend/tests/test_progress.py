"""Cover the reading-progress router.

The progress router is the seam between the catalog and the reader:
`/continue` tells the client what slice to open next, `/bookmark` saves
scroll position, `/finish` advances the pointer, `/start` begins tracking,
and `GET /` lists all in-progress works. These tests pin the contract
so the reader flow can't silently regress.
"""

import pytest
from httpx import AsyncClient

from app.models import ContentCatalog


AUTH = {"email": "reader@example.com", "password": "Secret123!"}


async def _register(client: AsyncClient) -> str:
    """Register a fresh user and return their bearer token."""
    r = await client.post("/api/v1/auth/register", json=AUTH)
    assert r.status_code == 201
    return r.json()["access_token"]


async def _seed_work(db_session, *, title: str = "Test Book", n_slices: int = 3):
    """Insert a parent + n slice rows. Returns (parent_id, [slice_ids])."""
    parent = ContentCatalog(
        title=title,
        content_type="book",
        category="fiction",
        body_text="Long enough text. " * 2000,
        author="Tester",
        estimated_read_minutes=n_slices,
    )
    db_session.add(parent)
    await db_session.commit()
    await db_session.refresh(parent)

    slices = []
    for i in range(1, n_slices + 1):
        s = ContentCatalog(
            title=f"{title} — Part {i} of {n_slices}",
            content_type="book",
            category="fiction",
            body_text=f"Slice {i} body. " * 100,
            author="Tester",
            estimated_read_minutes=1,
            parent_work_id=parent.id,
            read_order=i,
            total_slices=n_slices,
            char_count=1500,
            word_count=300,
        )
        db_session.add(s)
        slices.append(s)
    await db_session.commit()
    for s in slices:
        await db_session.refresh(s)
    return parent.id, [s.id for s in slices]


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_continue_returns_no_progress_for_new_user(client: AsyncClient):
    token = await _register(client)
    r = await client.get("/api/v1/progress/continue", headers=_h(token))
    assert r.status_code == 200
    body = r.json()
    assert body["has_in_progress"] is False
    assert body["slice_id"] is None
    assert body["total_slices"] == 0


@pytest.mark.asyncio
async def test_start_then_continue_returns_first_slice(client: AsyncClient, db_session):
    token = await _register(client)
    parent_id, slice_ids = await _seed_work(db_session)

    r = await client.post(f"/api/v1/progress/start?work_id={parent_id}", headers=_h(token))
    assert r.status_code == 200
    assert r.json()["already_tracked"] is False

    r = await client.get("/api/v1/progress/continue", headers=_h(token))
    assert r.status_code == 200
    body = r.json()
    assert body["has_in_progress"] is True
    assert body["slice_id"] == slice_ids[0]
    assert body["slice_order"] == 1
    assert body["total_slices"] == len(slice_ids)
    assert body["percent_complete"] == 0


@pytest.mark.asyncio
async def test_start_is_idempotent(client: AsyncClient, db_session):
    token = await _register(client)
    parent_id, _ = await _seed_work(db_session)

    r1 = await client.post(f"/api/v1/progress/start?work_id={parent_id}", headers=_h(token))
    r2 = await client.post(f"/api/v1/progress/start?work_id={parent_id}", headers=_h(token))
    assert r1.json()["already_tracked"] is False
    assert r2.json()["already_tracked"] is True


@pytest.mark.asyncio
async def test_finish_advances_to_next_slice(client: AsyncClient, db_session):
    token = await _register(client)
    parent_id, slice_ids = await _seed_work(db_session)
    await client.post(f"/api/v1/progress/start?work_id={parent_id}", headers=_h(token))

    r = await client.post(f"/api/v1/progress/finish?slice_id={slice_ids[0]}", headers=_h(token))
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["is_finished"] is False
    assert body["next_slice_id"] == slice_ids[1]

    # Continue should now point at slice 2 with 1/3 complete.
    r = await client.get("/api/v1/progress/continue", headers=_h(token))
    body = r.json()
    assert body["slice_id"] == slice_ids[1]
    assert body["slice_order"] == 2
    assert body["percent_complete"] == 33  # 1/3 ≈ 33%


@pytest.mark.asyncio
async def test_finish_last_slice_marks_work_finished(client: AsyncClient, db_session):
    token = await _register(client)
    parent_id, slice_ids = await _seed_work(db_session, n_slices=2)
    await client.post(f"/api/v1/progress/start?work_id={parent_id}", headers=_h(token))

    # Finish slice 1.
    r = await client.post(f"/api/v1/progress/finish?slice_id={slice_ids[0]}", headers=_h(token))
    assert r.json()["is_finished"] is False

    # Finish slice 2 — last one.
    r = await client.post(f"/api/v1/progress/finish?slice_id={slice_ids[1]}", headers=_h(token))
    body = r.json()
    assert body["ok"] is True
    assert body["is_finished"] is True
    assert body["next_slice_id"] is None

    # Continue should now report no in-progress work.
    r = await client.get("/api/v1/progress/continue", headers=_h(token))
    assert r.json()["has_in_progress"] is False


@pytest.mark.asyncio
async def test_bookmark_saves_and_is_returned_in_continue(client: AsyncClient, db_session):
    token = await _register(client)
    parent_id, slice_ids = await _seed_work(db_session)
    await client.post(f"/api/v1/progress/start?work_id={parent_id}", headers=_h(token))

    r = await client.post(
        "/api/v1/progress/bookmark",
        headers=_h(token),
        json={"slice_id": slice_ids[0], "scroll_offset_px": 420},
    )
    assert r.status_code == 200
    assert r.json()["ok"] is True

    r = await client.get("/api/v1/progress/continue", headers=_h(token))
    assert r.json()["scroll_offset_px"] == 420


@pytest.mark.asyncio
async def test_bookmark_is_idempotent_latest_wins(client: AsyncClient, db_session):
    token = await _register(client)
    parent_id, slice_ids = await _seed_work(db_session)
    await client.post(f"/api/v1/progress/start?work_id={parent_id}", headers=_h(token))

    for offset in (100, 200, 350):
        await client.post(
            "/api/v1/progress/bookmark",
            headers=_h(token),
            json={"slice_id": slice_ids[0], "scroll_offset_px": offset},
        )

    r = await client.get("/api/v1/progress/continue", headers=_h(token))
    assert r.json()["scroll_offset_px"] == 350


@pytest.mark.asyncio
async def test_list_in_progress_returns_all_started_works(client: AsyncClient, db_session):
    token = await _register(client)
    p1, _ = await _seed_work(db_session, title="Book A", n_slices=2)
    p2, _ = await _seed_work(db_session, title="Book B", n_slices=4)

    await client.post(f"/api/v1/progress/start?work_id={p1}", headers=_h(token))
    await client.post(f"/api/v1/progress/start?work_id={p2}", headers=_h(token))

    r = await client.get("/api/v1/progress", headers=_h(token))
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 2
    titles = {w["work_title"] for w in body}
    assert titles == {"Book A", "Book B"}


@pytest.mark.asyncio
async def test_finish_unknown_slice_returns_404(client: AsyncClient):
    token = await _register(client)
    r = await client.post("/api/v1/progress/finish?slice_id=99999", headers=_h(token))
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_progress_endpoints_require_auth(client: AsyncClient):
    # No Authorization header → 401 from the auth dependency.
    r = await client.get("/api/v1/progress/continue")
    assert r.status_code == 401
    r = await client.get("/api/v1/progress")
    assert r.status_code == 401
    r = await client.post(
        "/api/v1/progress/bookmark",
        json={"slice_id": 1, "scroll_offset_px": 100},
    )
    assert r.status_code == 401
