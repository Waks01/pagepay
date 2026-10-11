import pytest
from httpx import AsyncClient
from datetime import datetime, timezone


@pytest.mark.asyncio
async def test_background_pauses_and_resume(client: AsyncClient):
    register = await client.post(
        "/api/v1/auth/register",
        json={"email": "pause@example.com", "password": "Secret123!"},
    )
    token = register.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    create = await client.post(
        "/api/v1/session/start",
        json={"content_id": 1},
        headers=headers,
    )
    session_id = create.json()["session_id"]

    # Active heartbeat
    resp1 = await client.post(
        "/api/v1/session/heartbeat",
        json={"session_id": session_id, "scroll_events": 5, "app_state": "active"},
        headers=headers,
    )
    assert resp1.status_code == 200
    assert resp1.json()["paused"] is False

    # Background heartbeat
    resp2 = await client.post(
        "/api/v1/session/heartbeat",
        json={"session_id": session_id, "scroll_events": 0, "app_state": "background"},
        headers=headers,
    )
    assert resp2.status_code == 200
    assert resp2.json()["paused"] is True

    # Resume heartbeat
    resp3 = await client.post(
        "/api/v1/session/heartbeat",
        json={"session_id": session_id, "scroll_events": 3, "app_state": "active"},
        headers=headers,
    )
    assert resp3.status_code == 200
    assert resp3.json()["paused"] is False

    end = await client.post(
        "/api/v1/session/end",
        json={"session_id": session_id},
        headers=headers,
    )
    assert end.status_code == 200
    body = end.json()
    # Reward gate: /session/end stages pending_points rather than crediting
    # the wallet directly. The actual credit happens in /session/claim.
    assert "pending_points" in body
    assert "requires_claim" in body
