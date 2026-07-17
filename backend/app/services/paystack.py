"""Paystack API client.

Phase 4 — Payments. Wraps the four endpoints we actually call from
the payouts router:

  - GET   /bank?country=nigeria          — list Nigerian banks (replaces
                                            the hardcoded nigerian-banks.ts
                                            on the client)
  - GET   /bank/resolve                  — resolve account_number + bank_code
                                            → account_name
  - POST  /transferrecipient             — create a transfer recipient for
                                            a validated account; we store
                                            the returned `recipient_code`
                                            on the user's payout_accounts row
  - POST  /transfer                      — initiate a withdrawal

Plus the webhook signature verifier (HMAC-SHA512 of the raw body
with `paystack_webhook_secret`).

`httpx.AsyncClient` is reused across calls. We use a module-level
singleton built lazily on first use so that `paystack_secret_key`
being None at import time (e.g. in tests that override settings)
doesn't crash.

Errors are typed (`PaystackError`) so callers can branch on the cause
without parsing string messages.
"""

from __future__ import annotations

import hashlib
import hmac
import time
from dataclasses import dataclass
from typing import Any

import httpx

from app.config import settings


PAYSTACK_BASE_URL = "https://api.paystack.co"
_HTTP_TIMEOUT_SECONDS = 10.0
_BANKS_CACHE_TTL_SECONDS = 3600  # 1h — Nigerian bank list changes rarely


class PaystackError(Exception):
    """Raised for any non-2xx from Paystack or any signature failure.

    `status` is the HTTP status code we got from Paystack (None for
    network errors or signature failures). `body` is the raw response
    text so callers can log it without re-fetching.
    """


@dataclass
class Bank:
    """One Nigerian bank — the lean shape we expose to the client."""
    code: str
    name: str


@dataclass
class ResolvedAccount:
    """Result of /bank/resolve — the canonical name on the account."""
    account_number: str
    account_name: str


@dataclass
class TransferReceipt:
    """Result of /transfer — the transfer_code + reference Paystack echoed."""
    transfer_code: str
    reference: str
    status: str  # "pending" | "success" | "failed" | ...


@dataclass
class RefundReceipt:
    """Result of /refund — the Paystack transaction + reference of the refund."""
    reference: str
    transaction_id: int | None
    amount_kobo: int | None
    status: str  # "pending" | "success" | "failed" | "received" | ...


# ── Bank-list cache ───────────────────────────────────────────────────
# The same TTL pattern as `fx.py` — but longer (1h) because banks
# rarely change and Paystack's rate limit on /bank is tighter than
# the FX endpoint's.

_BANKS_CACHE: tuple[float, list[Bank]] | None = None


def _get_secret_key() -> str:
    """Return the configured Paystack secret key or raise.

    We raise rather than silently returning empty strings so callers
    can decide whether to treat the absence as "skip" (the v1 stub
    path in the payouts router) or as a hard error.
    """
    key = settings.paystack_secret_key
    if not key:
        raise PaystackError("PAYSTACK_SECRET_KEY is not configured")
    return key


def _auth_headers(secret_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {secret_key}",
        "Content-Type": "application/json",
    }


async def _request(
    method: str,
    path: str,
    *,
    json: dict[str, Any] | None = None,
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Issue an authenticated Paystack call and return the `data` field.

    Raises `PaystackError` on non-2xx, network failure, or any response
    where `status != true`. Paystack's API returns HTTP 200 for almost
    every error (their "success" envelope wraps application errors),
    so we also check the inner `status` field.
    """
    secret_key = _get_secret_key()
    url = f"{PAYSTACK_BASE_URL}{path}"
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_SECONDS) as client:
            resp = await client.request(
                method,
                url,
                headers=_auth_headers(secret_key),
                json=json,
                params=params,
            )
    except httpx.HTTPError as exc:
        raise PaystackError(f"Paystack request failed: {exc}") from exc

    if resp.status_code < 200 or resp.status_code >= 300:
        raise PaystackError(
            f"Paystack returned HTTP {resp.status_code} for {method} {path}: {resp.text[:500]}"
        )

    try:
        body = resp.json()
    except ValueError as exc:
        raise PaystackError(f"Paystack returned non-JSON for {method} {path}") from exc

    if not isinstance(body, dict) or body.get("status") is not True:
        raise PaystackError(
            f"Paystack status != true for {method} {path}: {body!r}"
        )

    data = body.get("data")
    if data is None:
        raise PaystackError(f"Paystack response missing data: {body!r}")
    return data if isinstance(data, dict) else {"data": data}


class PaystackClient:
    """Thin async wrapper around the four Paystack endpoints we use.

    Constructed with an explicit secret key so tests can use a fake key
    without mutating global settings. The lazy module-level singleton
    (`get_client`) wires up the real key.
    """

    def __init__(self, secret_key: str) -> None:
        self._secret_key = secret_key

    # ── Banks ──────────────────────────────────────────────────────

    async def list_banks(self, *, force_refresh: bool = False) -> list[Bank]:
        """Return the Nigerian bank list, cached for 1h.

        `force_refresh=True` bypasses the cache (used by tests that
        want to assert the network call path).
        """
        global _BANKS_CACHE
        now = time.monotonic()
        if not force_refresh and _BANKS_CACHE is not None:
            cached_at, cached_list = _BANKS_CACHE
            if (now - cached_at) < _BANKS_CACHE_TTL_SECONDS:
                return list(cached_list)

        data = await self._list_banks_request()

        banks = [
            Bank(code=str(item["code"]), name=str(item["name"]))
            for item in data
            if item.get("active") and not item.get("is_deleted") and item.get("code")
        ]
        # Stable order: by name. Paystack returns newest-first by default.
        banks.sort(key=lambda b: b.name)
        _BANKS_CACHE = (now, banks)
        return list(banks)

    async def _list_banks_request(self) -> list[dict[str, Any]]:
        """Issue the actual /bank GET and return the raw data list.

        Splits the auth-header logic so `list_banks` can use the
        module-level `_request` (which always uses the configured
        secret) but is also overridable in tests by passing a custom
        `PaystackClient`.
        """
        url = f"{PAYSTACK_BASE_URL}/bank"
        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_SECONDS) as client:
                resp = await client.get(
                    url,
                    headers=_auth_headers(self._secret_key),
                    params={"country": "nigeria", "perPage": 100},
                )
        except httpx.HTTPError as exc:
            raise PaystackError(f"Paystack request failed: {exc}") from exc

        if resp.status_code < 200 or resp.status_code >= 300:
            raise PaystackError(
                f"Paystack returned HTTP {resp.status_code} for GET /bank: {resp.text[:500]}"
            )
        try:
            body = resp.json()
        except ValueError as exc:
            raise PaystackError("Paystack returned non-JSON for GET /bank") from exc
        if not isinstance(body, dict) or body.get("status") is not True:
            raise PaystackError(f"Paystack status != true for GET /bank: {body!r}")
        data = body.get("data") or []
        if not isinstance(data, list):
            raise PaystackError(f"Paystack /bank data was not a list: {body!r}")
        return data

    # ── Account resolution ─────────────────────────────────────────

    async def resolve_account(
        self, account_number: str, bank_code: str
    ) -> ResolvedAccount:
        """Return the canonical account name Paystack has on file.

        Raises `PaystackError` if Paystack can't resolve (wrong number,
        closed account, network down). The payouts router turns the
        error into a `verified=False` response so the user still sees
        "Pending validation" instead of a crash.
        """
        url = f"{PAYSTACK_BASE_URL}/bank/resolve"
        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_SECONDS) as client:
                resp = await client.get(
                    url,
                    headers=_auth_headers(self._secret_key),
                    params={
                        "account_number": account_number,
                        "bank_code": bank_code,
                    },
                )
        except httpx.HTTPError as exc:
            raise PaystackError(f"Paystack request failed: {exc}") from exc

        if resp.status_code < 200 or resp.status_code >= 300:
            raise PaystackError(
                f"Paystack returned HTTP {resp.status_code} for /bank/resolve: {resp.text[:500]}"
            )
        try:
            body = resp.json()
        except ValueError as exc:
            raise PaystackError("Paystack returned non-JSON for /bank/resolve") from exc
        if not isinstance(body, dict) or body.get("status") is not True:
            raise PaystackError(f"Paystack status != true for /bank/resolve: {body!r}")
        data = body.get("data") or {}
        account_name = str(data.get("account_name") or "").strip()
        if not account_name:
            raise PaystackError(f"Paystack /bank/resolve returned no account_name: {body!r}")
        return ResolvedAccount(
            account_number=str(data.get("account_number") or account_number),
            account_name=account_name,
        )

    # ── Transfer recipient ─────────────────────────────────────────

    async def create_transfer_recipient(
        self,
        *,
        name: str,
        account_number: str,
        bank_code: str,
    ) -> str:
        """Create a Paystack transfer recipient and return its `recipient_code`.

        The recipient_code is what we pass to `/transfer` when the user
        withdraws. Storing it on `payout_accounts.recipient_code` avoids
        re-creating the recipient on every withdrawal.

        `currency` is hardcoded to NGN — we only support NGN payouts.
        """
        url = f"{PAYSTACK_BASE_URL}/transferrecipient"
        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_SECONDS) as client:
                resp = await client.post(
                    url,
                    headers=_auth_headers(self._secret_key),
                    json={
                        "type": "nuban",
                        "name": name,
                        "account_number": account_number,
                        "bank_code": bank_code,
                        "currency": "NGN",
                    },
                )
        except httpx.HTTPError as exc:
            raise PaystackError(f"Paystack request failed: {exc}") from exc

        if resp.status_code < 200 or resp.status_code >= 300:
            raise PaystackError(
                f"Paystack returned HTTP {resp.status_code} for POST /transferrecipient: {resp.text[:500]}"
            )
        try:
            body = resp.json()
        except ValueError as exc:
            raise PaystackError("Paystack returned non-JSON for POST /transferrecipient") from exc
        if not isinstance(body, dict) or body.get("status") is not True:
            raise PaystackError(f"Paystack status != true for POST /transferrecipient: {body!r}")
        data = body.get("data") or {}
        code = str(data.get("recipient_code") or "").strip()
        if not code:
            raise PaystackError(f"Paystack /transferrecipient returned no recipient_code: {body!r}")
        return code

    # ── Balance ────────────────────────────────────────────────────

    async def get_balance(self) -> int:
        """Return the available Paystack balance in kobo.

        Calls `GET /balance` and returns the `balance` field (in kobo).
        Raises `PaystackError` on network failure or non-2xx response.
        """
        url = f"{PAYSTACK_BASE_URL}/balance"
        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_SECONDS) as client:
                resp = await client.get(
                    url,
                    headers=_auth_headers(self._secret_key),
                )
        except httpx.HTTPError as exc:
            raise PaystackError(f"Paystack request failed: {exc}") from exc

        if resp.status_code < 200 or resp.status_code >= 300:
            raise PaystackError(
                f"Paystack returned HTTP {resp.status_code} for GET /balance: {resp.text[:500]}"
            )
        try:
            body = resp.json()
        except ValueError as exc:
            raise PaystackError("Paystack returned non-JSON for GET /balance") from exc
        if not isinstance(body, dict) or body.get("status") is not True:
            raise PaystackError(f"Paystack status != true for GET /balance: {body!r}")
        data = body.get("data") or []
        if not isinstance(data, list) or not data:
            raise PaystackError(f"Paystack /balance data was not a list: {body!r}")
        # The balance endpoint returns an array of currencies. We only care about NGN.
        for item in data:
            if isinstance(item, dict) and item.get("currency") == "NGN":
                balance_kobo = item.get("balance", 0)
                return int(balance_kobo) if isinstance(balance_kobo, (int, float)) else 0
        raise PaystackError("Paystack /balance did not return NGN currency balance")

    # ── Transfer ───────────────────────────────────────────────────

    async def initiate_transfer(
        self,
        *,
        recipient_code: str,
        amount_kobo: int,
        reason: str,
        reference: str,
    ) -> TransferReceipt:
        """Send a `/transfer` request and return the receipt.

        `amount` is in KOBO per Paystack's contract. The wallet UI
        converts points → kobo at request time (1 pt = 10 kobo, the
        project-wide rate).
        """
        url = f"{PAYSTACK_BASE_URL}/transfer"
        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_SECONDS) as client:
                resp = await client.post(
                    url,
                    headers=_auth_headers(self._secret_key),
                    json={
                        "source": "balance",
                        "amount": int(amount_kobo),
                        "recipient": recipient_code,
                        "reason": reason or "PagePay withdrawal",
                        "reference": reference,
                        "currency": "NGN",
                    },
                )
        except httpx.HTTPError as exc:
            raise PaystackError(f"Paystack request failed: {exc}") from exc

        # Paystack returns HTTP 502 with an `Unable to send` envelope
        # when the merchant balance is insufficient OR the recipient
        # is unverified. We surface that as PaystackError so the
        # caller can decide what to do (reverse the debit, etc).
        if resp.status_code < 200 or resp.status_code >= 300:
            raise PaystackError(
                f"Paystack returned HTTP {resp.status_code} for POST /transfer: {resp.text[:500]}"
            )
        try:
            body = resp.json()
        except ValueError as exc:
            raise PaystackError("Paystack returned non-JSON for POST /transfer") from exc
        if not isinstance(body, dict) or body.get("status") is not True:
            raise PaystackError(f"Paystack status != true for POST /transfer: {body!r}")
        data = body.get("data") or {}
        return TransferReceipt(
            transfer_code=str(data.get("transfer_code") or ""),
            reference=str(data.get("reference") or reference),
            status=str(data.get("status") or "pending"),
        )

    # ── Payment initialization ─────────────────────────────────────

    async def initialize_transaction(
        self,
        *,
        email: str,
        amount_kobo: int,
        reference: str,
        callback_url: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Initialize a Paystack payment transaction.
        
        Returns a dict with:
        - authorization_url: URL to redirect user to for payment
        - access_code: Transaction access code
        - reference: Transaction reference (echoed back)
        
        Raises PaystackError on any failure.
        """
        url = f"{PAYSTACK_BASE_URL}/transaction/initialize"
        payload: dict[str, Any] = {
            "email": email,
            "amount": int(amount_kobo),
            "reference": reference,
            "currency": "NGN",
        }
        
        if callback_url:
            payload["callback_url"] = callback_url
        
        if metadata:
            payload["metadata"] = metadata
        
        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_SECONDS) as client:
                resp = await client.post(
                    url,
                    headers=_auth_headers(self._secret_key),
                    json=payload,
                )
        except httpx.HTTPError as exc:
            raise PaystackError(f"Paystack request failed: {exc}") from exc

        if resp.status_code < 200 or resp.status_code >= 300:
            raise PaystackError(
                f"Paystack returned HTTP {resp.status_code} for POST /transaction/initialize: {resp.text[:500]}"
            )
        try:
            body = resp.json()
        except ValueError as exc:
            raise PaystackError("Paystack returned non-JSON for POST /transaction/initialize") from exc
        if not isinstance(body, dict) or body.get("status") is not True:
            raise PaystackError(f"Paystack status != true for POST /transaction/initialize: {body!r}")
        
        data = body.get("data") or {}
        if not data.get("authorization_url"):
            raise PaystackError(f"Paystack /transaction/initialize returned no authorization_url: {body!r}")
        
        return data

    # ── Refund ──────────────────────────────────────────────────────

    async def refund_charge(
        self,
        *,
        reference: str,
        amount_kobo: int | None = None,
    ) -> RefundReceipt:
        """Refund a Paystack transaction.

        `amount_kobo` is optional — if omitted Paystack refunds the full
        original amount. The caller (admin refund endpoint) passes the
        original charge amount so we can do partial refunds.
        """
        url = f"{PAYSTACK_BASE_URL}/refund"
        payload: dict[str, Any] = {
            "transaction": reference,
        }
        if amount_kobo is not None:
            payload["amount"] = int(amount_kobo)

        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_SECONDS) as client:
                resp = await client.post(
                    url,
                    headers=_auth_headers(self._secret_key),
                    json=payload,
                )
        except httpx.HTTPError as exc:
            raise PaystackError(f"Paystack refund request failed: {exc}") from exc

        if resp.status_code < 200 or resp.status_code >= 300:
            raise PaystackError(
                f"Paystack returned HTTP {resp.status_code} for POST /refund: {resp.text[:500]}"
            )
        try:
            body = resp.json()
        except ValueError as exc:
            raise PaystackError("Paystack returned non-JSON for POST /refund") from exc
        if not isinstance(body, dict) or body.get("status") is not True:
            raise PaystackError(f"Paystack status != true for POST /refund: {body!r}")

        data = body.get("data") or {}
        return RefundReceipt(
            reference=str(data.get("reference") or ""),
            transaction_id=data.get("transaction_id"),
            amount_kobo=data.get("amount"),
            status=str(data.get("status") or "pending"),
        )

    # ── Webhook signature ──────────────────────────────────────────

    @staticmethod
    def verify_webhook_signature(
        raw_body: bytes,
        signature_header: str | None,
        secret: str | None,
    ) -> bool:
        """Return True if the X-Paystack-Signature header matches the body.

        Paystack signs webhooks with HMAC-SHA512(secret, raw_body) and
        sends the hex digest in `X-Paystack-Signature`. We compare in
        constant time to avoid timing attacks.

        Missing header, missing secret, or any failure → False. Callers
        should treat False as 401 — never as "let it through anyway."
        """
        if not signature_header or not secret:
            return False
        try:
            computed = hmac.new(
                secret.encode("utf-8"),
                raw_body,
                hashlib.sha512,
            ).hexdigest()
        except (TypeError, ValueError):
            return False
        # Constant-time comparison prevents a timing side-channel.
        return hmac.compare_digest(computed, signature_header.strip())


# ── Module-level singleton ────────────────────────────────────────────

_client: PaystackClient | None = None


def get_client() -> PaystackClient:
    """Return a process-wide PaystackClient, built on first use.

    Lazy because `settings.paystack_secret_key` may be None at import
    time (e.g. in tests) and we don't want a hard import-time crash.
    """
    global _client
    if _client is None:
        _client = PaystackClient(_get_secret_key())
    return _client


def reset_banks_cache() -> None:
    """Clear the cached bank list. Used in tests to force a refetch."""
    global _BANKS_CACHE
    _BANKS_CACHE = None