import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_and_end_session(client: AsyncClient):
    register = await client.post(
        "/api/v1/auth/register",
        json={"email": "dave@example.com", "password": "Secret123!"},
    )
    token = register.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    create = await client.post(
        "/api/v1/session/start",
        json={"content_id": 1},
        headers=headers,
    )
    assert create.status_code == 201
    session_id = create.json()["session_id"]

    await client.post(
        "/api/v1/session/heartbeat",
        json={"session_id": session_id, "scroll_events": 10, "app_state": "active"},
        headers=headers,
    )

    end = await client.post(
        "/api/v1/session/end",
        json={"session_id": session_id},
        headers=headers,
    )
    assert end.status_code == 200
    body = end.json()
    # Reward gate: /session/end does NOT credit points directly. It stages
    # them as pending_points and tells the client to call /session/claim.
    assert "pending_points" in body
    assert "requires_claim" in body
