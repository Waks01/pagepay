import pytest
from httpx import AsyncClient
from sqlalchemy import select


@pytest.mark.asyncio
async def test_content_detail_not_found(client: AsyncClient):
    resp = await client.get("/api/v1/content/9999")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_content_detail_returns_body(client: AsyncClient):
    # Manually create a content row through the same ORM the test app uses.
    from app.models import ContentCatalog
    from tests.conftest import AsyncTestSession

    async with AsyncTestSession() as s:
        s.add(ContentCatalog(
            title="Test Book",
            content_type="book",
            category="fiction",
            source_url="https://example.com/book",
            body_text="Chapter 1. It was a dark and stormy night.",
            author="Tester",
            estimated_read_minutes=5,
        ))
        await s.commit()

    resp = await client.get("/api/v1/content/1")
    assert resp.status_code == 200
    body = resp.json()
    assert body["title"] == "Test Book"
    assert "stormy night" in (body["body_text"] or "")


@pytest.mark.asyncio
async def test_admin_import_unknown_source(client: AsyncClient):
    resp = await client.post(
        "/api/v1/admin/content/import?source=nope",
        headers={"X-Admin-Token": "dev-admin-token"},
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_admin_import_requires_token(client: AsyncClient):
    # No header → 401
    r = await client.post("/api/v1/admin/content/import?source=gutenberg")
    assert r.status_code == 401
    # Wrong token → 401
    r = await client.post(
        "/api/v1/admin/content/import?source=gutenberg",
        headers={"X-Admin-Token": "wrong"},
    )
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_session_end_unverified_returns_zero_points(client: AsyncClient):
    """If scroll_events == 0, the session is unverified. No slice bonus is
    credited and the session does NOT appear in the wallet history (no
    balance impact, nothing to show)."""
    from app.models import ContentCatalog
    from tests.conftest import AsyncTestSession

    reg = await client.post(
        "/api/v1/auth/register",
        json={"email": "unver@example.com", "password": "Secret123!"},
    )
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    async with AsyncTestSession() as s:
        s.add(ContentCatalog(
            title="Cheat Book",
            content_type="book",
            category="fiction",
            source_url="https://example.com/cheat",
            body_text="",
            author="Tester",
            estimated_read_minutes=5,
        ))
        await s.commit()

    create = await client.post(
        "/api/v1/session/start",
        json={"content_id": 1},
        headers=headers,
    )
    sid = create.json()["session_id"]

    # No heartbeat → 0 scroll events. Session ends unverified.
    end = await client.post(
        "/api/v1/session/end",
        json={"session_id": sid},
        headers=headers,
    )
    assert end.status_code == 200
    body = end.json()
    # New shape: no bonus, not eligible, not verified.
    assert body["bonus_eligible"] is False
    assert body["slice_bonus_credited"] == 0
    assert body["verified"] is False


@pytest.mark.asyncio
async def test_session_end_unknown_id_returns_404(client: AsyncClient):
    reg = await client.post(
        "/api/v1/auth/register",
        json={"email": "noent@example.com", "password": "Secret123!"},
    )
    token = reg.json()["access_token"]
    resp = await client.post(
        "/api/v1/session/end",
        json={"session_id": 9999},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_session_heartbeat_unknown_id_returns_404(client: AsyncClient):
    reg = await client.post(
        "/api/v1/auth/register",
        json={"email": "noent2@example.com", "password": "Secret123!"},
    )
    token = reg.json()["access_token"]
    resp = await client.post(
        "/api/v1/session/heartbeat",
        json={"session_id": 9999, "scroll_events": 1, "app_state": "active"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_session_cannot_be_ended_by_other_user(client: AsyncClient):
    from app.models import ContentCatalog
    from tests.conftest import AsyncTestSession

    # User A creates content
    async with AsyncTestSession() as s:
        s.add(ContentCatalog(
            title="Private Book",
            content_type="book",
            category="fiction",
            source_url="https://example.com/private",
            body_text="",
            author="Tester",
            estimated_read_minutes=5,
        ))
        await s.commit()

    # User A starts a session
    reg_a = await client.post(
        "/api/v1/auth/register",
        json={"email": "alice2@example.com", "password": "Secret123!"},
    )
    headers_a = {"Authorization": f"Bearer {reg_a.json()['access_token']}"}
    create = await client.post(
        "/api/v1/session/start",
        json={"content_id": 1},
        headers=headers_a,
    )
    sid = create.json()["session_id"]

    # User B cannot end User A's session
    reg_b = await client.post(
        "/api/v1/auth/register",
        json={"email": "bob2@example.com", "password": "Secret123!"},
    )
    headers_b = {"Authorization": f"Bearer {reg_b.json()['access_token']}"}
    end = await client.post(
        "/api/v1/session/end",
        json={"session_id": sid},
        headers=headers_b,
    )
    assert end.status_code == 404


# ---------------------------------------------------------------------------
# Reward-gate tests. Phase 1+ settles the slice-completion bonus directly at
# /session/end. /session/claim is a deprecated no-op kept for back-compat
# with old clients (it returns already_claimed=True, points_earned=0).
# These tests pin the new end-to-end contract.
# ---------------------------------------------------------------------------


async def _register_async(client: AsyncClient, email: str) -> dict:
    reg = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "Secret123!"},
    )
    return {"Authorization": f"Bearer {reg.json()['access_token']}"}


async def _make_content(client: AsyncClient, source_url: str = "https://example.com/claim", title: str = "Claim Book") -> None:
    from app.models import ContentCatalog
    from tests.conftest import AsyncTestSession
    async with AsyncTestSession() as s:
        s.add(ContentCatalog(
            title=title,
            content_type="book",
            category="fiction",
            source_url=source_url,
            body_text="Some body.",
            author="Tester",
            estimated_read_minutes=5,
        ))
        await s.commit()


@pytest.mark.asyncio
async def test_session_end_settles_slice_bonus_directly(client: AsyncClient):
    """End of a verified session credits the slice bonus directly to the
    wallet. /session/claim is no longer required."""
    from datetime import datetime, timedelta, timezone

    from app.config import settings
    from app.models import ReadingSession
    from tests.conftest import AsyncTestSession

    await _make_content(client, "https://example.com/claim1", "Bonus Book")
    headers = await _register_async(client, "p1@example.com")

    create = await client.post("/api/v1/session/start", json={"content_id": 1}, headers=headers)
    sid = create.json()["session_id"]

    # The end-of-session bonus requires ≥30s of effective reading. Rather
    # than sleeping in the test (slow + flaky), backdate start_time so the
    # server-side duration check sees a 60s slice.
    async with AsyncTestSession() as s:
        row = (await s.execute(select(ReadingSession).where(ReadingSession.id == sid))).scalar_one()
        row.start_time = datetime.now(timezone.utc) - timedelta(seconds=60)
        await s.commit()

    await client.post(
        "/api/v1/session/heartbeat",
        json={"session_id": sid, "scroll_events": 5, "app_state": "active"},
        headers=headers,
    )
    end = await client.post("/api/v1/session/end", json={"session_id": sid}, headers=headers)
    assert end.status_code == 200
    body = end.json()
    assert body["bonus_eligible"] is True
    assert body["slice_bonus_credited"] == settings.reading_slice_bonus_points
    assert body["verified"] is True
    assert body["session_id"] == sid
    assert body["new_balance"] == settings.reading_slice_bonus_points

    me = await client.get("/api/v1/auth/me", headers=headers)
    assert me.json()["points_balance"] == settings.reading_slice_bonus_points


@pytest.mark.asyncio
async def test_claim_is_deprecated_noop(client: AsyncClient):
    """POST /session/claim is a deprecated no-op for back-compat. It
    always returns already_claimed=True, points_earned=0 and does not
    re-credit anything."""
    await _make_content(client, "https://example.com/claim2", "Claimable Book")
    headers = await _register_async(client, "c1@example.com")

    from app.models import ReadingSession
    from tests.conftest import AsyncTestSession
    from datetime import datetime, timezone

    create = await client.post("/api/v1/session/start", json={"content_id": 1}, headers=headers)
    sid = create.json()["session_id"]

    # Manually stamp a non-zero pending_points on the row to verify the
    # claim endpoint does NOT consume it (no-op behavior).
    async with AsyncTestSession() as s:
        row = (await s.execute(select(ReadingSession).where(ReadingSession.id == sid))).scalar_one()
        row.scroll_events = 5
        row.verified = True
        row.end_time = datetime.now(timezone.utc)
        row.pending_points = 15  # would have been credit in the old model
        await s.commit()

    claim = await client.post("/api/v1/session/claim", json={"session_id": sid}, headers=headers)
    assert claim.status_code == 200
    body = claim.json()
    # Deprecated endpoint must return 0 + already_claimed, regardless of
    # whatever is sitting in pending_points.
    assert body["points_earned"] == 0
    assert body["already_claimed"] is True

    me = await client.get("/api/v1/auth/me", headers=headers)
    # No points credited by the deprecated claim endpoint.
    assert me.json()["points_balance"] == 0


@pytest.mark.asyncio
async def test_claim_does_not_double_credit(client: AsyncClient):
    """Calling /session/claim multiple times must not move any points —
    the endpoint is a no-op."""
    await _make_content(client, "https://example.com/claim3", "Idempotent Book")
    headers = await _register_async(client, "idem@example.com")

    create = await client.post("/api/v1/session/start", json={"content_id": 1}, headers=headers)
    sid = create.json()["session_id"]

    first = await client.post("/api/v1/session/claim", json={"session_id": sid}, headers=headers)
    assert first.json()["points_earned"] == 0
    assert first.json()["already_claimed"] is True

    second = await client.post("/api/v1/session/claim", json={"session_id": sid}, headers=headers)
    body = second.json()
    assert body["points_earned"] == 0
    assert body["already_claimed"] is True

    me = await client.get("/api/v1/auth/me", headers=headers)
    assert me.json()["points_balance"] == 0


@pytest.mark.asyncio
async def test_claim_unknown_session_returns_404(client: AsyncClient):
    """Claiming a non-existent session must 404 (user B cannot claim
    user A's session by guessing the id)."""
    headers = await _register_async(client, "zeroclaim@example.com")
    resp = await client.post("/api/v1/session/claim", json={"session_id": 9999}, headers=headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_cannot_claim_someone_elses_session(client: AsyncClient):
    """User B claiming User A's session must 404, not silently grant."""
    from app.models import ReadingSession
    from tests.conftest import AsyncTestSession
    from datetime import datetime, timezone

    headers_a = await _register_async(client, "alicec@example.com")
    create = await client.post("/api/v1/session/start", json={"content_id": 1}, headers=headers_a)
    sid = create.json()["session_id"]
    async with AsyncTestSession() as s:
        row = (await s.execute(select(ReadingSession).where(ReadingSession.id == sid))).scalar_one()
        row.pending_points = 5
        await s.commit()

    headers_b = await _register_async(client, "bobc@example.com")
    resp = await client.post("/api/v1/session/claim", json={"session_id": sid}, headers=headers_b)
    assert resp.status_code == 404
