"""Diagnostic test for admin_tasks endpoints — reproduces the 500 errors
reported on production for /admin/tasks/admin/list and
/admin/tasks/submissions/flagged."""
import pytest


@pytest.mark.asyncio
async def test_admin_list_tasks(client):
    """GET /admin/tasks/admin/list — should NOT 500."""
    # First login
    r = await client.post(
        "/api/v1/admin/auth/login",
        json={"email": "admin@pagepay.app", "password": "admin123"},
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    token = r.cookies.get("pagepay_admin_token")
    assert token, f"No token cookie in response: {dict(r.cookies)}"

    r = await client.get(
        "/api/v1/admin/tasks/admin/list",
        params={"page": 1, "limit": 50},
        cookies={"pagepay_admin_token": token},
        headers={"X-Requested-With": "XMLHttpRequest"},
    )
    print(f"\n[admin/list] status={r.status_code} body={r.text[:500]}")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"


@pytest.mark.asyncio
async def test_flagged_submissions(client):
    """GET /admin/tasks/submissions/flagged — should NOT 500."""
    r = await client.post(
        "/api/v1/admin/auth/login",
        json={"email": "admin@pagepay.app", "password": "admin123"},
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    token = r.cookies.get("pagepay_admin_token")

    r = await client.get(
        "/api/v1/admin/tasks/submissions/flagged",
        params={"page": 1, "limit": 50},
        cookies={"pagepay_admin_token": token},
        headers={"X-Requested-With": "XMLHttpRequest"},
    )
    print(f"\n[submissions/flagged] status={r.status_code} body={r.text[:500]}")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"


@pytest.mark.asyncio
async def test_kyc_pending(client):
    """GET /admin/tasks/kyc/pending — known working."""
    r = await client.post(
        "/api/v1/admin/auth/login",
        json={"email": "admin@pagepay.app", "password": "admin123"},
    )
    token = r.cookies.get("pagepay_admin_token")
    r = await client.get(
        "/api/v1/admin/tasks/kyc/pending",
        params={"page": 1, "limit": 50},
        cookies={"pagepay_admin_token": token},
        headers={"X-Requested-With": "XMLHttpRequest"},
    )
    print(f"\n[kyc/pending] status={r.status_code} body={r.text[:300]}")
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_analytics(client):
    """GET /admin/tasks/analytics — known working."""
    r = await client.post(
        "/api/v1/admin/auth/login",
        json={"email": "admin@pagepay.app", "password": "admin123"},
    )
    token = r.cookies.get("pagepay_admin_token")
    r = await client.get(
        "/api/v1/admin/tasks/analytics",
        params={"days": 30},
        cookies={"pagepay_admin_token": token},
        headers={"X-Requested-With": "XMLHttpRequest"},
    )
    print(f"\n[analytics] status={r.status_code} body={r.text[:300]}")
    assert r.status_code == 200
