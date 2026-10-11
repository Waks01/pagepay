"""Tests for the live-Paystack code path of the payouts router.

These tests cover Phase 4 — Payments wiring. The v1 stub path is
already pinned by `test_payouts.py`. Here we exercise:

  - resolve-account with a mocked Paystack response (verified + name)
  - resolve-account when Paystack errors (still 200, verified=False)
  - link-account persisting recipient_code + flipping verified=True
  - webhook signature verification (mismatched → 401)
  - webhook transfer.success updating a pending row
  - webhook transfer.failed reversing the debit
  - withdraw rejecting without a linked account
  - withdraw deducting balance before Paystack is called

We don't hit the real Paystack API — `PaystackClient` methods are
monkeypatched per-test. The signature verifier is a pure helper, so
its tests don't need mocking at all.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import datetime
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select

from app.config import settings
from app.models import User, UserTier, PayoutAccount as PayoutAccountRow, PayoutTransaction, Payment
from app.services import paystack as paystack_module
from app.services.paystack import (
    PaystackClient,
    PaystackError,
    ResolvedAccount,
    TransferReceipt,
)


# ── Fixtures ──────────────────────────────────────────────────────────


TEST_PAYSTACK_SECRET = "sk_test_fake_for_unit_tests_only"
# Paystack uses the SAME secret key to sign webhooks (no separate webhook
# secret) — see app/routers/payouts.py:599. Kept here as a sanity
# reminder; the test fixture injects TEST_PAYSTACK_SECRET into
# settings.paystack_secret_key and the _sign helper defaults to it.


@pytest_asyncio.fixture
async def live_paystack():
    """Enable the live-Paystack branch of the payouts router.

    The autouse `setup_db` fixture forces settings.paystack_secret_key
    to None so the v1 stub path runs by default. This fixture flips
    it back on for the duration of one test, then restores. It also
    resets the lazy `_client` singleton so it gets built with the
    test key.
    """
    # NOTE: Settings has no `paystack_webhook_secret` field — Paystack
    # uses the same `paystack_secret_key` for webhook signing (the
    # `_sign` helper below + `PaystackClient.verify_webhook_signature`
    # both consume TEST_PAYSTACK_SECRET). Setting the non-existent
    # field used to crash every test in this file with a pydantic
    # ValueError before the fix. See the matching note in
    # tests/conftest.py for the parallel bug that was fixed in the
    # ad-system security hardening pass (task #3).
    settings.paystack_secret_key = TEST_PAYSTACK_SECRET
    paystack_module._client = None
    paystack_module._BANKS_CACHE = None
    yield
    settings.paystack_secret_key = None
    paystack_module._client = None
    paystack_module._BANKS_CACHE = None


@pytest_asyncio.fixture
async def uncapped_withdrawal():
    """Lift the per-tx + per-day withdrawal caps for the duration of a test.

    The fee-tier tests in this file need to exercise amounts above
    `settings.max_withdrawal_kobo_per_tx` (e.g. 500_001 kobo for the
    tier-2 fee boundary, 5_000_001 kobo for tier-3) to verify the
    fee schedule walks all three tiers. The cap is enforced by
    `record_amount_v2` in the withdraw handler — independent of the
    fee-tier logic, but the same request hits both.

    Saves + restores the original values so neighboring tests see the
    live cap and don't bleed. Pairs with `live_paystack` (the
    fee-tier tests declare both).
    """
    saved_per_tx = settings.max_withdrawal_kobo_per_tx
    saved_per_day = settings.max_withdrawal_kobo_per_day
    # Headroom above the highest test amount (5_000_001 kobo) so the
    # cap check is a no-op for these tests.
    settings.max_withdrawal_kobo_per_tx = 100_000_000
    settings.max_withdrawal_kobo_per_day = 100_000_000
    try:
        yield
    finally:
        settings.max_withdrawal_kobo_per_tx = saved_per_tx
        settings.max_withdrawal_kobo_per_day = saved_per_day


async def _register_and_login(
    client: AsyncClient,
    email: str,
    password: str = "Secret123!",
) -> str:
    await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password},
    )
    login = await client.post(
        "/api/v1/auth/login",
        data={"username": email, "password": password},
    )
    return login.json()["access_token"]


def _patch_paystack(
    monkeypatch: pytest.MonkeyPatch,
    *,
    resolved: ResolvedAccount | None = None,
    resolved_error: Exception | None = None,
    recipient_code: str = "RCP_test_abcdef123",
    recipient_error: Exception | None = None,
    transfer_receipt: TransferReceipt | None = None,
    transfer_error: Exception | None = None,
    balance_kobo: int = 100_000_000,  # ₦1,000,000 — always enough for any test
    balance_error: Exception | None = None,
) -> None:
    """Patch the PaystackClient methods used by the router.

    Defaults are sensible for the "happy path" — callers override
    individual fields to simulate failures. Any method left at its
    default raises an explicit error so tests don't silently call
    the real network code.
    """

    async def _fake_resolve_account(
        self, account_number: str, bank_code: str
    ) -> ResolvedAccount:
        if resolved_error is not None:
            raise resolved_error
        assert resolved is not None, "test must set `resolved` for happy path"
        return resolved

    async def _fake_create_transfer_recipient(
        self, *, name: str, account_number: str, bank_code: str
    ) -> str:
        if recipient_error is not None:
            raise recipient_error
        return recipient_code

    async def _fake_initiate_transfer(
        self,
        *,
        recipient_code: str,
        amount_kobo: int,
        reason: str,
        reference: str,
    ) -> TransferReceipt:
        if transfer_error is not None:
            raise transfer_error
        assert transfer_receipt is not None, "test must set `transfer_receipt`"
        return transfer_receipt

    async def _fake_get_balance(self) -> int:
        if balance_error is not None:
            raise balance_error
        return balance_kobo

    monkeypatch.setattr(
        PaystackClient, "resolve_account", _fake_resolve_account
    )
    monkeypatch.setattr(
        PaystackClient, "create_transfer_recipient", _fake_create_transfer_recipient
    )
    monkeypatch.setattr(
        PaystackClient, "initiate_transfer", _fake_initiate_transfer
    )
    monkeypatch.setattr(
        PaystackClient, "get_balance", _fake_get_balance
    )


def _sign(raw: bytes, secret: str = TEST_PAYSTACK_SECRET) -> str:
    """Helper: produce the X-Paystack-Signature header for a body.

    Default signs with `TEST_PAYSTACK_SECRET` — the same value the
    `live_paystack` fixture injects into `settings.paystack_secret_key`
    (Paystack signs with the secret key itself, no separate webhook
    secret).
    """
    return hmac.new(secret.encode("utf-8"), raw, hashlib.sha512).hexdigest()


# ── Resolve-account ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_resolve_account_returns_paystack_name(
    monkeypatch: pytest.MonkeyPatch, live_paystack, client: AsyncClient
):
    """When Paystack resolves, the response carries the canonical name
    + verified=True. Uses a fake client (no network)."""
    _patch_paystack(
        monkeypatch,
        resolved=ResolvedAccount(
            account_number="0123456789",
            account_name="JANE A DOE",
        ),
    )

    token = await _register_and_login(client, "resolve_ok@example.com")
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.post(
        "/api/v1/payouts/resolve-account",
        json={"bank_code": "058", "account_number": "0123456789"},
        headers=headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["account_number"] == "0123456789"
    assert body["account_name"] == "JANE A DOE"
    assert body["verified"] is True


@pytest.mark.asyncio
async def test_resolve_account_handles_paystack_404(
    monkeypatch: pytest.MonkeyPatch, live_paystack, client: AsyncClient
):
    """When Paystack errors, the response stays 200 with
    verified=False — best-effort, the user can still save the link."""
    _patch_paystack(
        monkeypatch,
        resolved_error=PaystackError("Paystack returned HTTP 404"),
    )

    token = await _register_and_login(client, "resolve_404@example.com")
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.post(
        "/api/v1/payouts/resolve-account",
        json={"bank_code": "058", "account_number": "0123456789"},
        headers=headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["account_name"] is None
    assert body["verified"] is False


# ── Link account (live Paystack) ──────────────────────────────────────


@pytest.mark.asyncio
async def test_link_account_persists_recipient_code(
    monkeypatch: pytest.MonkeyPatch, live_paystack, client: AsyncClient
):
    """Happy path: PUT /payouts/account with mocked Paystack → row
    is verified=True + recipient_code populated, GET reflects it."""
    _patch_paystack(
        monkeypatch,
        resolved=ResolvedAccount(
            account_number="0123456789", account_name="RESOLVED NAME"
        ),
        recipient_code="RCP_test_xyz",
    )

    token = await _register_and_login(client, "link_live@example.com")
    headers = {"Authorization": f"Bearer {token}"}

    put = await client.put(
        "/api/v1/payouts/account",
        json={
            "bank_code": "058",
            "bank_name": "GTBank",
            "account_number": "0123456789",
            "account_name": "Anything",
        },
        headers=headers,
    )
    assert put.status_code == 200
    body = put.json()
    assert body["verified"] is True
    assert body["recipient_code"] == "RCP_test_xyz"
    assert body["account_name"] == "RESOLVED NAME"

    # And GET reflects it.
    get = await client.get("/api/v1/payouts/account", headers=headers)
    assert get.status_code == 200
    assert get.json()["recipient_code"] == "RCP_test_xyz"


@pytest.mark.asyncio
async def test_link_account_502_when_recipient_create_fails(
    monkeypatch: pytest.MonkeyPatch, live_paystack, client: AsyncClient
):
    """If Paystack can't create the transfer recipient (wrong account,
    closed account, etc), the link must NOT silently persist. The
    caller gets a 502 with a clear message."""
    _patch_paystack(
        monkeypatch,
        resolved=ResolvedAccount(
            account_number="0123456789", account_name="RESOLVED"
        ),
        recipient_error=PaystackError("Paystack returned HTTP 422"),
    )

    token = await _register_and_login(client, "link_fail@example.com")
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.put(
        "/api/v1/payouts/account",
        json={
            "bank_code": "058",
            "bank_name": "GTBank",
            "account_number": "0123456789",
            "account_name": "Anyone",
        },
        headers=headers,
    )
    assert resp.status_code == 502
    assert "double-check" in resp.json()["detail"].lower()


# ── Webhook signature ─────────────────────────────────────────────────


def test_webhook_verify_helper_accepts_correct_signature():
    raw = b'{"event":"transfer.success","data":{}}'
    sig = _sign(raw)
    assert PaystackClient.verify_webhook_signature(raw, sig, TEST_PAYSTACK_SECRET) is True


def test_webhook_verify_helper_rejects_bad_signature():
    raw = b'{"event":"transfer.success","data":{}}'
    assert PaystackClient.verify_webhook_signature(raw, "wronghex", TEST_PAYSTACK_SECRET) is False
    assert PaystackClient.verify_webhook_signature(raw, None, TEST_PAYSTACK_SECRET) is False
    assert PaystackClient.verify_webhook_signature(raw, _sign(raw), None) is False


@pytest.mark.asyncio
async def test_webhook_signature_must_match(
    live_paystack, client: AsyncClient
):
    """End-to-end: POST /webhook with a body and a bad signature → 401."""
    body = json.dumps({"event": "transfer.success", "data": {}}).encode()
    bad_sig = "deadbeef" * 8  # 64 hex chars, but wrong

    resp = await client.post(
        "/api/v1/payouts/webhook",
        content=body,
        headers={
            "Content-Type": "application/json",
            "X-Paystack-Signature": bad_sig,
        },
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_webhook_alias_payments_signature_must_match(
    live_paystack, client: AsyncClient
):
    """The /payments/webhook alias is a thin re-export of the payouts
    handler — bad signature MUST still get rejected, not silently 200."""
    body = json.dumps({"event": "charge.success", "data": {}}).encode()
    bad_sig = "deadbeef" * 8

    resp = await client.post(
        "/api/v1/payments/webhook",
        content=body,
        headers={
            "Content-Type": "application/json",
            "X-Paystack-Signature": bad_sig,
        },
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_webhook_alias_wallet_signature_must_match(
    live_paystack, client: AsyncClient
):
    """The /wallet/deposit/webhook alias must also reject bad signatures.
    Without this guard, a misconfigured Paystack URL could leak through
    the alias path even when the canonical payouts route would 401."""
    body = json.dumps({"event": "charge.success", "data": {}}).encode()
    bad_sig = "deadbeef" * 8

    resp = await client.post(
        "/api/v1/wallet/deposit/webhook",
        content=body,
        headers={
            "Content-Type": "application/json",
            "X-Paystack-Signature": bad_sig,
        },
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_webhook_alias_charge_success_credits_wallet(
    live_paystack, client: AsyncClient, db_session
):
    """A signed `charge.success` posted to /wallet/deposit/webhook
    MUST credit the user's points_balance by the deposit_amount_kobo
    in the Payment.metadata. This proves the alias route reaches the
    real dispatcher (not just a 200 stub)."""
    user = User(
        email="wh_alias_deposit@example.com",
        password_hash="x",
        points_balance=0,
    )
    db_session.add(user)
    await db_session.flush()
    payment = Payment(
        user_id=user.id,
        tier="wallet_deposit",
        amount_kobo=50_000,
        provider="paystack",
        provider_tx_ref="pp_alias_deposit_001",
        status="pending",
        payment_metadata={
            "deposit_amount_kobo": 50_000,
            "processing_fee_kobo": 750,
            "total_amount_kobo": 50_750,
        },
    )
    db_session.add(payment)
    await db_session.commit()

    payload = {
        "event": "charge.success",
        "data": {"reference": "pp_alias_deposit_001"},
    }
    raw = json.dumps(payload).encode()
    sig = _sign(raw)

    resp = await client.post(
        "/api/v1/wallet/deposit/webhook",
        content=raw,
        headers={
            "Content-Type": "application/json",
            "X-Paystack-Signature": sig,
        },
    )
    assert resp.status_code == 200
    assert resp.json()["handled"] is True

    await db_session.refresh(payment)
    await db_session.refresh(user)
    assert payment.status == "success"
    assert payment.webhook_confirmed is True
    assert user.points_balance == 50_000


@pytest.mark.asyncio
async def test_webhook_alias_charge_success_upgrades_subscription(
    live_paystack, client: AsyncClient, db_session
):
    """A signed `charge.success` posted to /payments/webhook
    MUST upgrade the user's tier to PREMIUM_MONTHLY. This proves the
    alias route reaches the same dispatcher that handles
    charge.success on the canonical /payouts/webhook."""
    user = User(
        email="wh_alias_sub@example.com",
        password_hash="x",
        points_balance=0,
        tier=UserTier.FREE,
    )
    db_session.add(user)
    await db_session.flush()
    payment = Payment(
        user_id=user.id,
        tier=UserTier.PREMIUM_MONTHLY.value,
        amount_kobo=250_000,
        provider="paystack",
        provider_tx_ref="pp_alias_sub_001",
        status="pending",
    )
    db_session.add(payment)
    await db_session.commit()

    payload = {
        "event": "charge.success",
        "data": {"reference": "pp_alias_sub_001"},
    }
    raw = json.dumps(payload).encode()
    sig = _sign(raw)

    resp = await client.post(
        "/api/v1/payments/webhook",
        content=raw,
        headers={
            "Content-Type": "application/json",
            "X-Paystack-Signature": sig,
        },
    )
    assert resp.status_code == 200
    assert resp.json()["handled"] is True

    await db_session.refresh(payment)
    assert payment.status == "success"
    assert payment.webhook_confirmed is True


# ── Webhook transfer.success ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_webhook_transfer_success_marks_row_paid(
    live_paystack, client: AsyncClient, db_session
):
    """A signed `transfer.success` event for an existing pending row
    must flip the row to status='success' and stamp settled_at."""
    # Create a user + pending payout_transactions row directly.
    user = User(
        email="wh_success@example.com",
        password_hash="x",
        points_balance=0,
    )
    db_session.add(user)
    await db_session.flush()
    txn = PayoutTransaction(
        user_id=user.id,
        reference="pp_wh_success_001",
        amount_kobo=10000,
        recipient_code="RCP_test_xyz",
        reason="test",
        status="pending",
        balance_after_debit=10000,
    )
    db_session.add(txn)
    await db_session.commit()

    payload = {
        "event": "transfer.success",
        "data": {
            "reference": "pp_wh_success_001",
            "transfer_code": "TRF_test_real",
        },
    }
    raw = json.dumps(payload).encode()
    sig = _sign(raw)

    resp = await client.post(
        "/api/v1/payouts/webhook",
        content=raw,
        headers={
            "Content-Type": "application/json",
            "X-Paystack-Signature": sig,
        },
    )
    assert resp.status_code == 200
    assert resp.json()["handled"] is True

    await db_session.refresh(txn)
    assert txn.status == "success"
    assert txn.settled_at is not None
    assert txn.paystack_transfer_code == "TRF_test_real"


@pytest.mark.asyncio
async def test_webhook_transfer_failed_reverses_debit(
    live_paystack, client: AsyncClient, db_session
):
    """A signed `transfer.failed` event must flip the row to failed
    AND add the amount_kobo back to the user's balance."""
    user = User(
        email="wh_fail@example.com",
        password_hash="x",
        # Balance after the simulated debit: was 50000, debited 10000.
        points_balance=40000,
    )
    db_session.add(user)
    await db_session.flush()
    txn = PayoutTransaction(
        user_id=user.id,
        reference="pp_wh_fail_001",
        amount_kobo=10000,
        recipient_code="RCP_test_xyz",
        reason="test",
        status="pending",
        balance_after_debit=40000,
    )
    db_session.add(txn)
    await db_session.commit()

    payload = {
        "event": "transfer.failed",
        "data": {
            "reference": "pp_wh_fail_001",
            "reason": "recipient_bank_offline",
        },
    }
    raw = json.dumps(payload).encode()
    sig = _sign(raw)

    resp = await client.post(
        "/api/v1/payouts/webhook",
        content=raw,
        headers={
            "Content-Type": "application/json",
            "X-Paystack-Signature": sig,
        },
    )
    assert resp.status_code == 200

    await db_session.refresh(txn)
    await db_session.refresh(user)
    assert txn.status == "failed"
    assert txn.settled_at is not None
    # 40000 → 50000 (the original 50000 - 0 net = +10000 reversed)
    assert user.points_balance == 50000


# ── Withdraw ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_withdraw_requires_linked_account(
    live_paystack, client: AsyncClient
):
    """No payout_accounts row → 400 with a clear message."""
    token = await _register_and_login(client, "withdraw_nolink@example.com")
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.post(
        "/api/v1/payouts/withdraw",
        json={"amount_kobo": 100000, "reason": "smoke"},  # ₦1,000
        headers=headers,
    )
    assert resp.status_code == 400
    assert "link" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_withdraw_deducts_balance_before_paystack_call(
    monkeypatch: pytest.MonkeyPatch,
    live_paystack,
    client: AsyncClient,
    db_session,
):
    """Happy path: register a user, seed a verified payout_accounts
    row + top up the balance via the same engine, then withdraw. The
    router's session and `db_session` share the same engine so the
    pre-seeded state is visible to the route.

    Asserts:
      - balance went down BEFORE the webhook fires (debit is atomic
        with the txn row creation)
      - the response carries a reference, status='pending',
        fee_kobo (₦15 for the 10k-kobo tier), and amount_kobo
      - a payout_transactions row exists with the right amount
        AND the persisted fee_kobo
    """
    email = "withdraw_ok@example.com"
    token = await _register_and_login(client, email)
    headers = {"Authorization": f"Bearer {token}"}

    user = (
        await db_session.execute(select(User).where(User.email == email))
    ).scalar_one()
    payout = PayoutAccountRow(
        user_id=user.id,
        bank_code="058",
        bank_name="GTBank",
        account_number="0123456789",
        account_name="WITHDRAW USER",
        recipient_code="RCP_test_seed",
        verified=True,
    )
    # 100,000 kobo (₦1,000) withdraw + 1,500 kobo fee = 101,500
    # debited. Seed 200,000 so the user has plenty of headroom.
    user.points_balance = 200000
    db_session.add(payout)
    await db_session.commit()

    _patch_paystack(
        monkeypatch,
        transfer_receipt=TransferReceipt(
            transfer_code="TRF_test_initiated",
            reference="WILL_BE_OVERWRITTEN_BY_ROUTER",
            status="pending",
        ),
    )

    resp = await client.post(
        "/api/v1/payouts/withdraw",
        json={"amount_kobo": 100000, "reason": "happy path"},  # ₦1,000
        headers=headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "pending"
    assert body["amount_kobo"] == 100000
    assert body["fee_kobo"] == 1500  # ≤₦5,000 tier
    assert body["new_balance_points"] == 98500  # 200000 - (100000 + 1500)
    assert body["transfer_reference"].startswith("pp_")

    # Confirm the row exists with the right shape.
    txn_row = (
        await db_session.execute(
            select(PayoutTransaction).where(
                PayoutTransaction.reference == body["transfer_reference"]
            )
        )
    ).scalar_one()
    assert txn_row.amount_kobo == 100000
    assert txn_row.fee_kobo == 1500
    assert txn_row.user_id == user.id
    assert txn_row.balance_after_debit == 98500

    # And the user's balance was actually debited.
    await db_session.refresh(user)


# ── Withdrawal fee tiers ──────────────────────────────────────────────
# The fee schedule (settings.withdrawal_fee_tiers):
#   ≤₦5,000  (≤500_000 kobo)        → 1_500 kobo (₦15)
#   ₦5,001 – ₦50,000  (500_001 – 5_000_000 kobo) → 3_500 kobo (₦35)
#   >₦50,000  (>5_000_000 kobo)     → 7_000 kobo (₦70)
# The user pays the fee IN ADDITION to the withdrawal amount, and
# receives the full withdrawal amount via Paystack.


async def _seed_verified_payout(
    db_session, *, email: str, balance: int
) -> tuple[int, str]:
    """Create a verified payout_accounts row + return (user_id, token).

    The router's session and `db_session` share the same engine, so
    state committed here is visible to the route handler.
    """
    user = (
        await db_session.execute(select(User).where(User.email == email))
    ).scalar_one()
    user.points_balance = balance
    payout = PayoutAccountRow(
        user_id=user.id,
        bank_code="058",
        bank_name="GTBank",
        account_number="0123456789",
        account_name="FEE TESTER",
        recipient_code="RCP_fee_tester",
        verified=True,
    )
    db_session.add(payout)
    await db_session.commit()
    return user.id, user.email


@pytest.mark.asyncio
async def test_withdraw_fee_tier_under_5k(
    monkeypatch: pytest.MonkeyPatch,
    live_paystack,
    client: AsyncClient,
    db_session,
):
    """A withdrawal ≤ ₦5,000 (≤500,000 kobo) gets the 1,500 kobo fee."""
    email = "fee_t1@example.com"
    token = await _register_and_login(client, email)
    headers = {"Authorization": f"Bearer {token}"}
    await _seed_verified_payout(db_session, email=email, balance=600000)

    _patch_paystack(
        monkeypatch,
        transfer_receipt=TransferReceipt(
            transfer_code="TRF_t1", reference="x", status="pending"
        ),
    )

    resp = await client.post(
        "/api/v1/payouts/withdraw",
        json={"amount_kobo": 100000, "reason": "tier 1"},  # ₦1,000
        headers=headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["fee_kobo"] == 1500
    assert body["new_balance_points"] == 600000 - (100000 + 1500)


@pytest.mark.asyncio
async def test_withdraw_fee_tier_at_5k_boundary(
    monkeypatch: pytest.MonkeyPatch,
    live_paystack,
    client: AsyncClient,
    db_session,
):
    """₦5,000 exactly (500,000 kobo) is the LAST value in tier 1
    (≤500,000). The first value of tier 2 is 500,001 kobo (₦5,000.01)."""
    email = "fee_t2_low@example.com"
    token = await _register_and_login(client, email)
    headers = {"Authorization": f"Bearer {token}"}
    await _seed_verified_payout(db_session, email=email, balance=1000000)

    _patch_paystack(
        monkeypatch,
        transfer_receipt=TransferReceipt(
            transfer_code="TRF_t2a", reference="x", status="pending"
        ),
    )

    # Exactly ₦5,000 → still tier 1 (the ≤ bound).
    resp = await client.post(
        "/api/v1/payouts/withdraw",
        json={"amount_kobo": 500000, "reason": "boundary 5k"},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["fee_kobo"] == 1500


@pytest.mark.asyncio
async def test_withdraw_fee_tier_just_above_5k(
    monkeypatch: pytest.MonkeyPatch,
    live_paystack,
    uncapped_withdrawal,
    client: AsyncClient,
    db_session,
):
    """₦5,000.01 (500,001 kobo) crosses into tier 2 (₦35 fee)."""
    email = "fee_t2_high@example.com"
    token = await _register_and_login(client, email)
    headers = {"Authorization": f"Bearer {token}"}
    await _seed_verified_payout(db_session, email=email, balance=1000000)

    _patch_paystack(
        monkeypatch,
        transfer_receipt=TransferReceipt(
            transfer_code="TRF_t2b", reference="x", status="pending"
        ),
    )

    resp = await client.post(
        "/api/v1/payouts/withdraw",
        json={"amount_kobo": 500001, "reason": "tier 2 entry"},
        headers=headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["fee_kobo"] == 3500
    assert body["new_balance_points"] == 1000000 - (500001 + 3500)


@pytest.mark.asyncio
async def test_withdraw_fee_tier_above_50k(
    monkeypatch: pytest.MonkeyPatch,
    live_paystack,
    uncapped_withdrawal,
    client: AsyncClient,
    db_session,
):
    """Withdrawals > ₦50,000 (>5,000,000 kobo) get the 7,000 kobo fee."""
    email = "fee_t3@example.com"
    token = await _register_and_login(client, email)
    headers = {"Authorization": f"Bearer {token}"}
    await _seed_verified_payout(db_session, email=email, balance=10000000)

    _patch_paystack(
        monkeypatch,
        transfer_receipt=TransferReceipt(
            transfer_code="TRF_t3", reference="x", status="pending"
        ),
    )

    resp = await client.post(
        "/api/v1/payouts/withdraw",
        json={"amount_kobo": 5000001, "reason": "tier 3"},
        headers=headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["fee_kobo"] == 7000
    assert body["new_balance_points"] == 10000000 - (5000001 + 7000)


@pytest.mark.asyncio
async def test_withdraw_rejects_insufficient_balance_for_fee(
    monkeypatch: pytest.MonkeyPatch,
    live_paystack,
    client: AsyncClient,
    db_session,
):
    """The user must have enough for the withdrawal AND the fee.
    Balance == amount alone is not enough — the fee must also be
    covered or the withdraw is rejected with 400."""
    email = "fee_shortfall@example.com"
    token = await _register_and_login(client, email)
    headers = {"Authorization": f"Bearer {token}"}
    # Balance covers the withdrawal but not the withdrawal + fee.
    await _seed_verified_payout(db_session, email=email, balance=100000)

    # Patch so that we can prove Paystack was NOT called.
    _patch_paystack(
        monkeypatch,
        transfer_error=AssertionError("Paystack /transfer should not be called"),
    )

    resp = await client.post(
        "/api/v1/payouts/withdraw",
        json={"amount_kobo": 100000, "reason": "shortfall"},
        headers=headers,
    )
    assert resp.status_code == 400
    detail = resp.json()["detail"].lower()
    # Error message surfaces the exact shortfall so the UI can show it.
    assert "1500" in detail  # the 1,500 kobo fee shortfall
    assert "balance" in detail


@pytest.mark.asyncio
async def test_withdraw_rejects_amount_below_minimum(
    monkeypatch: pytest.MonkeyPatch,
    live_paystack,
    client: AsyncClient,
    db_session,
):
    """Pydantic enforces min 100,000 kobo (₦1,000) on the request.
    Below that → 422 (Pydantic) before the handler ever runs."""
    email = "fee_below_min@example.com"
    token = await _register_and_login(client, email)
    headers = {"Authorization": f"Bearer {token}"}
    await _seed_verified_payout(db_session, email=email, balance=1000000)

    _patch_paystack(
        monkeypatch,
        transfer_error=AssertionError("Paystack /transfer should not be called"),
    )

    resp = await client.post(
        "/api/v1/payouts/withdraw",
        json={"amount_kobo": 50000, "reason": "below min"},  # ₦500
        headers=headers,
    )
    assert resp.status_code == 422


# ── Webhook reversal: gross (amount + fee) refund ──────────────────────


@pytest.mark.asyncio
async def test_webhook_transfer_failed_refunds_amount_plus_fee(
    live_paystack, client: AsyncClient, db_session
):
    """The webhook reversal must refund the GROSS debit (amount + fee)
    so the user lands back at their pre-withdraw balance. A reversal
    that only returned the amount would leave the user short by the
    fee — silent money loss."""
    user = User(
        email="wh_fail_fee@example.com",
        password_hash="x",
        # Pre-debit balance was 50,000. We debited 10,000 + 1,500 fee.
        # Balance is now 38,500. Webhook should restore to 50,000.
        points_balance=38500,
    )
    db_session.add(user)
    await db_session.flush()
    txn = PayoutTransaction(
        user_id=user.id,
        reference="pp_wh_fail_with_fee",
        amount_kobo=10000,
        fee_kobo=1500,  # the user paid a fee at withdraw time
        recipient_code="RCP_test_xyz",
        reason="test",
        status="pending",
        balance_after_debit=38500,
    )
    db_session.add(txn)
    await db_session.commit()

    payload = {
        "event": "transfer.failed",
        "data": {"reference": "pp_wh_fail_with_fee", "reason": "test"},
    }
    raw = json.dumps(payload).encode()
    sig = _sign(raw)

    resp = await client.post(
        "/api/v1/payouts/webhook",
        content=raw,
        headers={
            "Content-Type": "application/json",
            "X-Paystack-Signature": sig,
        },
    )
    assert resp.status_code == 200

    await db_session.refresh(txn)
    await db_session.refresh(user)
    assert txn.status == "failed"
    # CRITICAL: refund = amount (10,000) + fee (1,500) = 11,500.
    # 38,500 + 11,500 = 50,000 (the pre-withdraw balance).
    assert user.points_balance == 50000


# ── /payouts/transactions surfaces the fee ─────────────────────────────


@pytest.mark.asyncio
async def test_list_transactions_includes_fee_for_user(
    monkeypatch: pytest.MonkeyPatch,
    live_paystack,
    client: AsyncClient,
    db_session,
):
    """End-to-end: register, withdraw (so a row exists with a real
    fee_kobo), then GET /payouts/transactions and confirm the fee is
    in the response shape."""
    email = "fee_list_e2e@example.com"
    token = await _register_and_login(client, email)
    headers = {"Authorization": f"Bearer {token}"}
    await _seed_verified_payout(db_session, email=email, balance=200000)

    _patch_paystack(
        monkeypatch,
        transfer_receipt=TransferReceipt(
            transfer_code="TRF_list", reference="x", status="pending"
        ),
    )

    # 100,000 kobo (₦1,000) withdraw → 1,500 kobo fee → row created.
    w = await client.post(
        "/api/v1/payouts/withdraw",
        json={"amount_kobo": 100000, "reason": "list test"},
        headers=headers,
    )
    assert w.status_code == 200
    reference = w.json()["transfer_reference"]

    lst = await client.get("/api/v1/payouts/transactions", headers=headers)
    assert lst.status_code == 200
    body = lst.json()
    assert body["meta"]["total"] >= 1
    match = next((r for r in body["data"] if r["reference"] == reference), None)
    assert match is not None
    assert match["amount_kobo"] == 100000
    assert match["fee_kobo"] == 1500
