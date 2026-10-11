import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_register_success(client: AsyncClient):
    resp = await client.post(
        "/api/v1/auth/register",
        json={"email": "alice@example.com", "password": "Secret123!"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert "access_token" in body
    assert body["token_type"] == "bearer"


@pytest.mark.asyncio
async def test_register_duplicate(client: AsyncClient):
    await client.post(
        "/api/v1/auth/register",
        json={"email": "bob@example.com", "password": "Secret123!"},
    )
    resp = await client.post(
        "/api/v1/auth/register",
        json={"email": "bob@example.com", "password": "Secret123!"},
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_login_success(client: AsyncClient):
    await client.post(
        "/api/v1/auth/register",
        json={"email": "carol@example.com", "password": "Secret123!"},
    )
    resp = await client.post(
        "/api/v1/auth/login",
        data={"username": "carol@example.com", "password": "Secret123!"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "access_token" in body


@pytest.mark.asyncio
async def test_change_password_succeeds(client: AsyncClient):
    """Change password, then log in with the new password.

    The round-trip through login proves the new hash actually verifies
    against the bcrypt path. If we hashed with a different scheme than
    registration uses, this would 401.
    """
    await client.post(
        "/api/v1/auth/register",
        json={"email": "dave@example.com", "password": "OldSecret1!"},
    )
    login = await client.post(
        "/api/v1/auth/login",
        data={"username": "dave@example.com", "password": "OldSecret1!"},
    )
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    change = await client.post(
        "/api/v1/auth/change-password",
        json={"current_password": "OldSecret1!", "new_password": "NewSecret1!"},
        headers=headers,
    )
    assert change.status_code == 200
    assert change.json() == {"ok": True}

    # Old password must no longer work.
    bad = await client.post(
        "/api/v1/auth/login",
        data={"username": "dave@example.com", "password": "OldSecret1!"},
    )
    assert bad.status_code == 401

    # New password must work.
    good = await client.post(
        "/api/v1/auth/login",
        data={"username": "dave@example.com", "password": "NewSecret1!"},
    )
    assert good.status_code == 200


@pytest.mark.asyncio
async def test_change_password_wrong_current_rejected(client: AsyncClient):
    """A wrong current_password must 401 — without it, anyone with a
    leaked JWT could lock the legitimate user out of their account."""
    await client.post(
        "/api/v1/auth/register",
        json={"email": "eve@example.com", "password": "RightSecret1!"},
    )
    login = await client.post(
        "/api/v1/auth/login",
        data={"username": "eve@example.com", "password": "RightSecret1!"},
    )
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    bad = await client.post(
        "/api/v1/auth/change-password",
        json={"current_password": "wrongguess", "new_password": "anewpass1"},
        headers=headers,
    )
    assert bad.status_code == 401

    # Original password must still work — failed change must not have
    # mutated the hash.
    still = await client.post(
        "/api/v1/auth/login",
        data={"username": "eve@example.com", "password": "RightSecret1!"},
    )
    assert still.status_code == 200


@pytest.mark.asyncio
async def test_logout_returns_204(client: AsyncClient):
    """`POST /auth/logout` is a no-op 204 in v1 (stateless JWTs); we
    just need the route to exist and to return 204 with no body so
    the client can call it cleanly."""
    await client.post(
        "/api/v1/auth/register",
        json={"email": "frank@example.com", "password": "Secret123!"},
    )
    login = await client.post(
        "/api/v1/auth/login",
        data={"username": "frank@example.com", "password": "Secret123!"},
    )
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    resp = await client.post("/api/v1/auth/logout", headers=headers)
    assert resp.status_code == 204
    # 204 forbids a body. httpx surfaces empty body as "".
    assert resp.content == b""
