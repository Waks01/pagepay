"""Cover the catalog filters and /content/continue shortcut."""

import pytest
from httpx import AsyncClient

from app.models import ContentCatalog, ReadingProgress


AUTH = {"email": "reader@example.com", "password": "Secret123!"}


async def _register(client: AsyncClient) -> str:
    r = await client.post("/api/v1/auth/register", json=AUTH)
    assert r.status_code == 201
    return r.json()["access_token"]


async def _seed(db_session, *, parents=2, slices_per_parent=2, finished_work_id=None):
    """Insert N parent works with M slices each. Optionally mark one finished."""
    ids = []
    for i in range(parents):
        p = ContentCatalog(
            title=f"Book {i}",
            content_type="book",
            category="fiction",
            body_text="x" * 1500,
            author=f"Author {i}",
            estimated_read_minutes=slices_per_parent,
        )
        db_session.add(p)
        await db_session.commit()
        await db_session.refresh(p)
        ids.append(p.id)
        for j in range(slices_per_parent):
            db_session.add(ContentCatalog(
                title=f"Book {i} — Part {j+1} of {slices_per_parent}",
                content_type="book",
                category="fiction",
                body_text="x" * 1500,
                author=f"Author {i}",
                estimated_read_minutes=1,
                parent_work_id=p.id,
                read_order=j + 1,
                total_slices=slices_per_parent,
                char_count=1500,
                word_count=300,
            ))
        await db_session.commit()
    return ids


@pytest.mark.asyncio
async def test_catalog_anonymous_returns_parents_only(client: AsyncClient, db_session):
    """Anonymous users can browse the catalog, and child slices are filtered out."""
    await _seed(db_session, parents=2, slices_per_parent=2)
    r = await client.get("/api/v1/content/catalog")
    assert r.status_code == 200
    items = r.json()
    # 2 parents, NOT 6 (parents + children)
    assert len(items) == 2
    for it in items:
        assert "Part" not in it["title"]


@pytest.mark.asyncio
async def test_catalog_exclude_read_filters_finished_works(client: AsyncClient, db_session):
    """When authenticated, exclude_read=true hides works the user has finished."""
    ids = await _seed(db_session, parents=2)
    token = await _register(client)
    h = {"Authorization": f"Bearer {token}"}

    # Mark the first work as finished.
    rp = ReadingProgress(
        user_id=1,  # first registered user is id 1 in fresh DB
        work_id=ids[0],
        current_slice_order=2,
        slices_completed=2,
        total_slices=2,
        is_finished=True,
    )
    db_session.add(rp)
    await db_session.commit()

    # Without filter — both works visible.
    r = await client.get("/api/v1/content/catalog", headers=h)
    assert len(r.json()) == 2

    # With exclude_read=true — finished work hidden.
    r = await client.get("/api/v1/content/catalog?exclude_read=true", headers=h)
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 1
    assert items[0]["id"] == ids[1]


@pytest.mark.asyncio
async def test_catalog_exclude_read_requires_auth(client: AsyncClient, db_session):
    """Anonymous user with exclude_read=true should get 401, not silently get all."""
    await _seed(db_session, parents=1)
    r = await client.get("/api/v1/content/catalog?exclude_read=true")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_content_continue_requires_auth(client: AsyncClient):
    r = await client.get("/api/v1/content/continue")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_content_continue_returns_no_progress_for_new_user(client: AsyncClient):
    token = await _register(client)
    r = await client.get("/api/v1/content/continue", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["has_in_progress"] is False


@pytest.mark.asyncio
async def test_catalog_filter_by_category(client: AsyncClient, db_session):
    p = ContentCatalog(
        title="Sci-Fi Book",
        content_type="book",
        category="scifi",
        body_text="x" * 1500,
        author="X",
        estimated_read_minutes=5,
    )
    db_session.add(p)
    await db_session.commit()
    r = await client.get("/api/v1/content/catalog?category=scifi")
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 1
    assert items[0]["category"] == "scifi"
