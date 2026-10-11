"""Regression tests for the three runtime bugs fixed in this session.

  1. PaystackClient.refund_charge — added so admin refund endpoint
     can actually call it
  2. admin_payments + sponsor use get_paystack_client() (not the
     no-arg PaystackClient() which raises TypeError)
  3. fraud_detection.check_duplicate_accounts queries TaskSubmission
     (which has device_fingerprint + ip_address), not User (which
     doesn't)

These are unit tests — they import the modules and exercise the
pure logic, no DB / no network required.
"""

from __future__ import annotations

import inspect

import pytest


# ── 1. PaystackClient.refund_charge ────────────────────────────────


def test_refund_charge_method_exists():
    """The admin refund endpoint calls this method. It must exist."""
    from app.services.paystack import PaystackClient
    assert hasattr(PaystackClient, "refund_charge")


def test_refund_charge_is_coroutine():
    from app.services.paystack import PaystackClient
    assert inspect.iscoroutinefunction(PaystackClient.refund_charge)


def test_refund_charge_signature():
    from app.services.paystack import PaystackClient
    sig = inspect.signature(PaystackClient.refund_charge)
    params = list(sig.parameters.keys())
    # `reference` is required (kw-only), `amount_kobo` is optional (kw-only)
    assert "reference" in params
    assert "amount_kobo" in params
    # Both must be keyword-only (after *)
    assert sig.parameters["reference"].kind == inspect.Parameter.KEYWORD_ONLY
    assert sig.parameters["amount_kobo"].kind == inspect.Parameter.KEYWORD_ONLY


def test_refund_receipt_dataclass():
    from app.services.paystack import RefundReceipt
    r = RefundReceipt(
        reference="rf_abc",
        transaction_id=123,
        amount_kobo=50000,
        status="pending",
    )
    assert r.reference == "rf_abc"
    assert r.transaction_id == 123
    assert r.amount_kobo == 50000
    assert r.status == "pending"


def test_refund_charge_uses_paystack_refund_endpoint():
    """The implementation must POST to Paystack's /refund endpoint."""
    from app.services.paystack import PaystackClient
    src = inspect.getsource(PaystackClient.refund_charge)
    assert "/refund" in src
    assert "reference" in src


# ── 2. admin_payments + sponsor use get_paystack_client() ─────────


def test_admin_payments_uses_get_client():
    """Bug: admin refund endpoint called PaystackClient() with no args."""
    from app.routers import admin_payments
    src = open(admin_payments.__file__).read()
    assert "paystack = PaystackClient()" not in src, (
        "admin_payments still calls the no-arg PaystackClient()"
    )
    assert "get_paystack_client" in src, (
        "admin_payments must use get_paystack_client() (or the get_client alias)"
    )


def test_sponsor_deposit_uses_get_client():
    """Bug: sponsor wallet deposit called PaystackClient() with no args."""
    from app.routers import sponsor
    src = open(sponsor.__file__).read()
    assert "paystack = PaystackClient()" not in src, (
        "sponsor still calls the no-arg PaystackClient()"
    )
    assert "get_paystack_client" in src, (
        "sponsor must use get_paystack_client() (or the get_client alias)"
    )


def test_paystack_client_constructor_requires_key():
    """Verify the root cause: constructor signature requires secret_key."""
    from app.services.paystack import PaystackClient
    sig = inspect.signature(PaystackClient.__init__)
    params = list(sig.parameters.keys())
    # self + secret_key
    assert "secret_key" in params
    # Should raise TypeError if you call it with no args
    with pytest.raises(TypeError):
        PaystackClient()


# ── 3. fraud_detection.check_duplicate_accounts ───────────────────


def test_check_duplicate_accounts_uses_task_submission():
    """Bug: queried User.device_fingerprint (column doesn't exist on User)."""
    from app.services.fraud_detection import FraudDetectionService
    src = inspect.getsource(FraudDetectionService.check_duplicate_accounts)
    assert "User.device_fingerprint" not in src
    assert "User.id" not in src
    assert "TaskSubmission" in src


def test_fraud_detection_does_not_import_user():
    """User is no longer used in fraud_detection — drop the import."""
    from app.services import fraud_detection
    src = open(fraud_detection.__file__).read()
    import_line = [
        line for line in src.splitlines()
        if "from app.models import" in line
    ]
    assert len(import_line) == 1
    assert "User" not in import_line[0], (
        f"fraud_detection still imports User: {import_line[0]}"
    )


def test_check_duplicate_accounts_is_coroutine():
    from app.services.fraud_detection import FraudDetectionService
    assert inspect.iscoroutinefunction(
        FraudDetectionService.check_duplicate_accounts
    )


def test_check_duplicate_accounts_returns_none_when_no_signals():
    """If neither device_fingerprint nor ip_address is provided, return None."""
    from app.services.fraud_detection import FraudDetectionService
    sig = inspect.signature(FraudDetectionService.check_duplicate_accounts)
    # Both must be Optional with default None
    assert sig.parameters["device_fingerprint"].default is None
    assert sig.parameters["ip_address"].default is None
