"""Tests for the payouts router (Phase 1 Profile/Settings support).

Pins the v1 surface: PUT /payouts/account stores the link as-entered
and returns `verified=False`; POST /payouts/resolve-account is a stub
that returns `account_name=None`. Paystack validation lands in Phase 4.
"""

import pytest
from httpx import AsyncClient


async def _register_and_login(
    client: AsyncClient, email: str = "pay@example.com", password: str = "Secret123!"
) -> str:
    """Register a fresh user and return a bearer token.

    A fresh user per test keeps rows in `payout_accounts` from leaking
    between cases (the table is one-row-per-user with a UNIQUE
    constraint, so collisions would break the "replaces old" test).
    """
    await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password},
    )
    login = await client.post(
        "/api/v1/auth/login",
        data={"username": email, "password": password},
    )
    return login.json()["access_token"]


@pytest.mark.asyncio
async def test_link_payout_account_succeeds(client: AsyncClient):
    token = await _register_and_login(client, "link1@example.com")
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.put(
        "/api/v1/payouts/account",
        json={
            "bank_code": "058",
            "bank_name": "Guaranty Trust Bank",
            "account_number": "0123456789",
            "account_name": "Jane Doe",
        },
        headers=headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["bank_code"] == "058"
    assert body["bank_name"] == "Guaranty Trust Bank"
    assert body["account_number_last4"] == "6789"
    assert body["account_name"] == "Jane Doe"
    # v1 stubs the verification — Paystack wires this in Phase 4.
    assert body["verified"] is False
    assert "linked_at" in body


@pytest.mark.asyncio
async def test_link_payout_account_replaces_old(client: AsyncClient):
    """Second PUT for the same user must overwrite the prior row,
    not append. The PayoutAccount row is keyed by user_id (UNIQUE)."""
    token = await _register_and_login(client, "link2@example.com")
    headers = {"Authorization": f"Bearer {token}"}

    first = await client.put(
        "/api/v1/payouts/account",
        json={
            "bank_code": "058",
            "bank_name": "GTBank",
            "account_number": "0123456789",
            "account_name": "First Account",
        },
        headers=headers,
    )
    assert first.status_code == 200
    assert first.json()["account_number_last4"] == "6789"

    second = await client.put(
        "/api/v1/payouts/account",
        json={
            "bank_code": "057",
            "bank_name": "Zenith Bank",
            "account_number": "9876543210",
            "account_name": "Second Account",
        },
        headers=headers,
    )
    assert second.status_code == 200
    body = second.json()
    assert body["bank_code"] == "057"
    assert body["bank_name"] == "Zenith Bank"
    assert body["account_number_last4"] == "3210"
    assert body["account_name"] == "Second Account"


@pytest.mark.asyncio
async def test_link_payout_account_validates_input(client: AsyncClient):
    """A 9-digit account number must 422 (Pydantic enforces 10-digit
    NUBANs via Field(min_length=10, max_length=10))."""
    token = await _register_and_login(client, "link3@example.com")
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.put(
        "/api/v1/payouts/account",
        json={
            "bank_code": "058",
            "bank_name": "GTBank",
            "account_number": "123456789",  # 9 chars
            "account_name": "Anyone",
        },
        headers=headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_link_payout_account_never_exposes_full_number(client: AsyncClient):
    """The response must surface only the last 4 digits of the
    account number, never the full NUBAN. Otherwise we'd be leaking
    the only secret protecting the user's bank account."""
    token = await _register_and_login(client, "link4@example.com")
    headers = {"Authorization": f"Bearer {token}"}
    full_number = "0123456789"

    resp = await client.put(
        "/api/v1/payouts/account",
        json={
            "bank_code": "058",
            "bank_name": "GTBank",
            "account_number": full_number,
            "account_name": "Hidden",
        },
        headers=headers,
    )
    body = resp.json()
    # Field exists and is exactly 4 chars.
    assert "account_number_last4" in body
    assert len(body["account_number_last4"]) == 4
    # Full number must not appear anywhere in the response body.
    assert full_number not in resp.text
    # And the response must not include a field called `account_number`
    # that holds the full thing.
    assert "account_number" not in body


@pytest.mark.asyncio
async def test_resolve_account_returns_unverified_in_v1(client: AsyncClient):
    """Phase 1 stub: `resolve-account` always returns `account_name=None`
    and `verified=False` because we don't call Paystack yet. The
    client UI shows "Pending validation" until Phase 4 wires it."""
    token = await _register_and_login(client, "link5@example.com")
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.post(
        "/api/v1/payouts/resolve-account",
        json={"bank_code": "058", "account_number": "0123456789"},
        headers=headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["account_number"] == "0123456789"
    assert body["account_name"] is None
    assert body["verified"] is False


@pytest.mark.asyncio
async def test_payout_endpoints_require_auth(client: AsyncClient):
    """Both endpoints sit behind the standard `get_current_user`
    dependency. Anonymous callers get 401, not 200 with empty data."""
    put_anon = await client.put(
        "/api/v1/payouts/account",
        json={
            "bank_code": "058",
            "bank_name": "GTBank",
            "account_number": "0123456789",
        },
    )
    assert put_anon.status_code == 401

    resolve_anon = await client.post(
        "/api/v1/payouts/resolve-account",
        json={"bank_code": "058", "account_number": "0123456789"},
    )
    assert resolve_anon.status_code == 401


@pytest.mark.asyncio
async def test_get_payout_account_returns_link_or_404(client: AsyncClient):
    """GET /payouts/account is the read path the Profile screen uses
    to decide between the "Not linked" placeholder and the linked
    bank row. Pre-link it must 404; after a PUT it must return the
    stored account, never the full NUBAN."""
    token = await _register_and_login(client, "link6@example.com")
    headers = {"Authorization": f"Bearer {token}"}

    # Pre-link: 404 (the canonical "no row" signal).
    pre = await client.get("/api/v1/payouts/account", headers=headers)
    assert pre.status_code == 404

    # Link, then GET should reflect the link.
    await client.put(
        "/api/v1/payouts/account",
        json={
            "bank_code": "058",
            "bank_name": "GTBank",
            "account_number": "0123456789",
            "account_name": "Get Tester",
        },
        headers=headers,
    )
    after = await client.get("/api/v1/payouts/account", headers=headers)
    assert after.status_code == 200
    body = after.json()
    assert body["account_number_last4"] == "6789"
    assert body["account_name"] == "Get Tester"
    assert body["verified"] is False
    # Full number must never appear in the GET response either.
    assert "0123456789" not in after.text
