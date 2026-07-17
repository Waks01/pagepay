"""Payouts router.

Phase 4 — Payments (Paystack). The endpoints here:

  GET   /payouts/account          — return the user's linked account, or 404
  PUT   /payouts/account          — link (or replace) the bank account,
                                    create a Paystack transfer recipient,
                                    flip verified=True
  POST  /payouts/resolve-account  — call Paystack's /bank/resolve; returns
                                    the resolved name + verified=True when
                                    it matches the user's typed name
  GET   /payouts/banks            — list Nigerian banks (proxies Paystack's
                                    /bank?country=nigeria)
  POST  /payouts/withdraw         — initiate a transfer to the linked
                                    recipient (debits balance atomically,
                                    creates a payout_transactions row,
                                    calls Paystack /transfer)
  GET   /payouts/transactions     — list the user's withdrawals
  POST  /payouts/webhook          — receive Paystack events; flips
                                    payout_transactions.status and
                                    reverses debits on transfer.failed

Behavior when `PAYSTACK_SECRET_KEY` is unset: we fall back to the v1
stub path on `/account` and `/resolve-account` (verified=False,
account_name=None, recipient_code=None). The wallet surfaces this as
"Pending validation". Withdraw + webhook endpoints REQUIRE the key
set — they return 503 if not, rather than silently 200ing.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import User, PayoutAccount as PayoutAccountRow, PayoutTransaction
from app.routers.auth import get_current_user
from app.schemas import (
    AccountResolveRequest,
    AccountResolveResponse,
    Bank,
    PayoutAccount,
    PayoutAccountLink,
    WithdrawalRequest,
    WithdrawalResponse,
)
from app.services.encryption import decrypt, encrypt
from app.services.paystack import (
    PaystackError,
    get_client as get_paystack_client,
)
from app.services.money_caps import record_amount_v2


logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/payouts", tags=["payouts"])


# ── Mapping helpers ───────────────────────────────────────────────────


def _to_response(row: PayoutAccountRow) -> PayoutAccount:
    """Map a DB row to the response schema.

    Centralizing this means we never accidentally echo the full
    account number back over the wire. The response exposes only
    `account_number_last4`, never the 10-digit NUBAN.
    """
    decrypted = decrypt(row.account_number) or "0000000000"
    return PayoutAccount(
        bank_code=row.bank_code,
        bank_name=row.bank_name,
        # Last four of the saved number. Safe to log / display.
        account_number_last4=decrypted[-4:],
        account_name=row.account_name,
        verified=row.verified,
        linked_at=row.linked_at,
        recipient_code=row.recipient_code,
    )


# ── Withdrawal fee ────────────────────────────────────────────────────


def compute_withdrawal_fee(amount_kobo: int) -> int:
    """Return the flat fee the user pays for a withdrawal of `amount_kobo`.

    Walks the parsed `settings.withdrawal_fee_tiers_parsed` list and
    returns the fee for the first tier whose `max_kobo` is None
    (highest tier) or `>= amount_kobo`. The user fee mirrors
    Paystack's flat schedule with a fixed markup on top
    (see `Settings.withdrawal_fee_tiers`).

    Called by the withdraw handler. Kept as a free function (not a
    method on `Settings`) so it's trivially testable from a unit
    test that builds its own tier list, and so the router doesn't
    have to re-parse the env value on every call (the property
    already does that work).
    """
    tiers = settings.withdrawal_fee_tiers_parsed
    for max_kobo, fee_kobo in tiers:
        if max_kobo is None or amount_kobo <= max_kobo:
            return fee_kobo
    # Defensive: if the tier list has no None sentinel (operator
    # misconfig), the last tier wins. This matches the spirit of
    # "tiers are sorted ascending and the last one is the catch-all."
    return tiers[-1][1] if tiers else 0


# ── Read endpoints ────────────────────────────────────────────────────


@router.get("/account", response_model=PayoutAccount | None)
async def get_payout_account(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the user's linked payout account, or 404 if none.

    The profile screen calls this on mount to decide whether to show
    "Not linked" vs the linked-account row. Returning 404 (rather than
    200 with a null body) keeps the contract obvious: the caller gets
    a single, unambiguous "is there a row?" signal.
    """
    row = (
        await db.execute(
            select(PayoutAccountRow).where(PayoutAccountRow.user_id == current_user.id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="No payout account linked")
    return _to_response(row)


@router.get("/banks", response_model=list[Bank])
async def list_nigerian_banks(
    current_user: User = Depends(get_current_user),
):
    """Return the Nigerian bank list, proxied from Paystack.

    Replaces the hardcoded `client/src/shared/lib/nigerian-banks.ts`
    once the client is updated. Cached server-side for 1h to spare
    Paystack's rate limit. Returns 503 if Paystack is unconfigured or
    unreachable so the client can fall back to the offline list.
    """
    if not settings.paystack_secret_key:
        raise HTTPException(
            status_code=503,
            detail="PAYSTACK_SECRET_KEY is not configured on the server",
        )
    try:
        banks = await get_paystack_client().list_banks()
    except PaystackError as exc:
        logger.warning("Paystack /bank failed: %s", exc)
        raise HTTPException(
            status_code=503,
            detail="Unable to fetch bank list from Paystack",
        ) from exc
    return [Bank(code=b.code, name=b.name) for b in banks]


@router.get("/transactions")
async def list_transactions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List the user's withdrawals, newest first.

    Phase 4 list view — not yet rendered in the wallet UI but already
    useful for ops debugging and for the future withdrawal-history
    surface. Returns the same shape as the response without the
    recipient_code (which the user doesn't need to see).
    """
    rows = (
        await db.execute(
            select(PayoutTransaction)
            .where(PayoutTransaction.user_id == current_user.id)
            .order_by(PayoutTransaction.created_at.desc())
            .limit(100)
        )
    ).scalars().all()

    return {
        "data": [
            {
                "reference": r.reference,
                "amount_kobo": r.amount_kobo,
                "fee_kobo": r.fee_kobo or 0,
                "status": r.status,
                "reason": r.reason,
                "paystack_transfer_code": r.paystack_transfer_code,
                "balance_after_debit": r.balance_after_debit,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "settled_at": r.settled_at.isoformat() if r.settled_at else None,
            }
            for r in rows
        ],
        "meta": {"page": 1, "total": len(rows)},
    }


# ── Write endpoints ───────────────────────────────────────────────────


@router.post("/resolve-account", response_model=AccountResolveResponse)
async def resolve_account(
    payload: AccountResolveRequest,
    current_user: User = Depends(get_current_user),
):
    """Look up the account name from bank code + account number.

    Calls Paystack's `/bank/resolve`. On Paystack 200 → returns the
    canonical name + `verified=True`. On Paystack failure (network,
    wrong account, etc) → returns `account_name=None`,
    `verified=False`, and a 200 — best-effort so the user still sees
    "Pending validation" instead of a crash.

    When `PAYSTACK_SECRET_KEY` is unset (dev-without-Paystack), the
    v1 stub path runs: `verified=False, account_name=None`.
    """
    if not settings.paystack_secret_key:
        return AccountResolveResponse(
            account_number=payload.account_number,
            account_name=None,
            verified=False,
        )

    try:
        resolved = await get_paystack_client().resolve_account(
            payload.account_number, payload.bank_code
        )
    except PaystackError as exc:
        # Best-effort: don't 500 the user. The link flow can still
        # proceed with "Pending validation".
        logger.warning(
            "Paystack resolve_account failed for user=%s bank=%s ···%s: %s",
            current_user.id,
            payload.bank_code,
            payload.account_number[-4:],
            exc,
        )
        return AccountResolveResponse(
            account_number=payload.account_number,
            account_name=None,
            verified=False,
        )

    return AccountResolveResponse(
        account_number=resolved.account_number,
        account_name=resolved.account_name,
        verified=True,
    )


@router.put("/account", response_model=PayoutAccount)
async def link_payout_account(
    payload: PayoutAccountLink,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Link (or replace) the user's payout bank account.

    Upserts by `user_id`. When `PAYSTACK_SECRET_KEY` is configured we:

      1. Resolve the account name from Paystack (best-effort: fall
         back to the typed name on error).
      2. Create a Paystack transfer recipient with Paystack and store
         the returned `recipient_code` on the row.
      3. Flip `verified=True` once the recipient is created.

    On recipient-creation failure we return 502 — the user can't
    withdraw against an unstored recipient, and silently accepting
    a broken link would just produce a later-withdrawn-then-failed
    cycle that the user wouldn't understand.

    When keys are unset we keep the v1 stub path (verified=False,
    recipient_code=None) so dev-without-Paystack still links.

    Important: in the live path we resolve the recipient_code BEFORE
    adding the row to the session. If Paystack errors out, we never
    touch the DB — no need for `await db.rollback()` which is fragile
    inside async handler scope.
    """
    # ── Stub path: no Paystack configured ───────────────────────
    if not settings.paystack_secret_key:
        row = (
            await db.execute(
                select(PayoutAccountRow).where(PayoutAccountRow.user_id == current_user.id)
            )
        ).scalar_one_or_none()
        if row is None:
            row = PayoutAccountRow(user_id=current_user.id)
            db.add(row)
        row.bank_code = payload.bank_code
        row.bank_name = payload.bank_name
        row.account_number = encrypt(payload.account_number)
        row.account_name = payload.account_name or "Pending validation"
        row.recipient_code = None
        row.verified = False
        row.linked_at = datetime.utcnow()

        await db.commit()
        await db.refresh(row)
        logger.info(
            "User %s linked payout account (stub) bank=%s ···%s verified=%s",
            current_user.id,
            row.bank_name,
            decrypt(row.account_number or "")[-4:],
            row.verified,
        )
        return _to_response(row)

    # ── Live path: resolve + create recipient via Paystack ──────
    # Best-effort resolve — a 4xx/5xx here shouldn't block linking.
    account_name: str = payload.account_name or "Pending validation"
    try:
        resolved = await get_paystack_client().resolve_account(
            payload.account_number, payload.bank_code
        )
        if resolved.account_name:
            account_name = resolved.account_name
    except PaystackError as exc:
        logger.warning(
            "Paystack resolve_account failed at link time for user=%s: %s",
            current_user.id,
            exc,
        )

    # Recipient create is the real gate — without a recipient_code we
    # can't withdraw. Surface failures as 502 so the client can
    # prompt "please double-check your details".
    try:
        recipient_code = await get_paystack_client().create_transfer_recipient(
            name=account_name,
            account_number=payload.account_number,
            bank_code=payload.bank_code,
        )
    except PaystackError as exc:
        logger.error(
            "Paystack create_transfer_recipient failed for user=%s: %s",
            current_user.id,
            exc,
        )
        raise HTTPException(
            status_code=502,
            detail=(
                "We couldn't link this account with Paystack. "
                "Please double-check the bank, account number, and try again."
            ),
        ) from exc

    # Paystack succeeded — now persist. Upsert by user_id.
    row = (
        await db.execute(
            select(PayoutAccountRow).where(PayoutAccountRow.user_id == current_user.id)
        )
    ).scalar_one_or_none()
    if row is None:
        row = PayoutAccountRow(user_id=current_user.id)
        db.add(row)

    row.bank_code = payload.bank_code
    row.bank_name = payload.bank_name
    row.account_number = encrypt(payload.account_number)
    row.account_name = account_name
    row.recipient_code = recipient_code
    row.verified = True
    row.linked_at = datetime.utcnow()

    await db.commit()
    await db.refresh(row)
    logger.info(
        "User %s linked payout account via Paystack bank=%s ···%s recipient=%s",
        current_user.id,
        row.bank_name,
        decrypt(row.account_number or "")[-4:],
        recipient_code,
    )
    return _to_response(row)


@router.post("/withdraw", response_model=WithdrawalResponse)
async def withdraw(
    payload: WithdrawalRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Initiate a Paystack transfer to the user's linked account.

    Steps:
      1. Confirm a verified payout_accounts row exists. 400 otherwise.
      2. Compute the flat fee from `settings.withdrawal_fee_tiers`
         (mirrors Paystack's schedule with a markup).
      3. Confirm the user has at least `amount_kobo + fee_kobo`
         points. 400 otherwise — the user is paying the fee out of
         their wallet, not out of the amount they receive.
      4. Create a `payout_transactions` row (status=pending) BEFORE
         the Paystack call. The unique `reference` is the join key
         for the webhook handler.
      5. Debit the wallet by the GROSS amount (withdrawal + fee,
         atomic with step 4 in the same SQLAlchemy session).
      6. Call Paystack `/transfer` with the NET amount (just the
         withdrawal — fee stays in our balance). On failure, raise
         502; the webhook handler will reverse the gross debit when
         Paystack reports `transfer.failed`.
      7. Return the receipt including the fee, so the client can
         show "You paid ₦X fee, you received ₦Y."

    Requires `PAYSTACK_SECRET_KEY` configured. Without it we return
    503 — the wallet UI doesn't expose the withdraw button when the
    bank isn't verified, so this should be unreachable in practice.
    """
    if not settings.paystack_secret_key:
        raise HTTPException(
            status_code=503,
            detail="PAYSTACK_SECRET_KEY is not configured on the server",
        )

    payout_row = (
        await db.execute(
            select(PayoutAccountRow).where(PayoutAccountRow.user_id == current_user.id)
        )
    ).scalar_one_or_none()
    if payout_row is None or not payout_row.recipient_code:
        raise HTTPException(
            status_code=400,
            detail="Link and verify your payout account before withdrawing.",
        )

    # Re-fetch the user inside this session so the balance we read is
    # the one we're going to debit (avoids stale-row issues when the
    # current_user passed by the auth dep is from a different session).
    user_row = (
        await db.execute(
            select(User).where(User.id == current_user.id).with_for_update()
        )
    ).scalar_one_or_none()
    if user_row is None:
        raise HTTPException(status_code=404, detail="User not found")

    # Compute the fee BEFORE the balance check so the error message
    # can tell the user exactly how much more they need.
    fee_kobo = compute_withdrawal_fee(payload.amount_kobo)
    total_debit_kobo = payload.amount_kobo + fee_kobo

    # M2 audit fix: enforce per-tx + 24h-rolling withdrawal caps BEFORE
    # talking to Paystack. The cap is on the user-visible withdrawal
    # amount (not the gross debit including fee) — what the user typed
    # in the input is what gets counted against the cap.
    allowed, current_24h = record_amount_v2(
        user_id=user_row.id,
        kind="withdrawal",
        amount_kobo=payload.amount_kobo,
        max_per_tx=settings.max_withdrawal_kobo_per_tx,
        max_per_day=settings.max_withdrawal_kobo_per_day,
    )
    if not allowed:
        if current_24h == 0:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Withdrawal amount exceeds the per-transaction limit of "
                    f"{settings.max_withdrawal_kobo_per_tx} kobo."
                ),
            )
        raise HTTPException(
            status_code=429,
            detail=(
                f"24-hour withdrawal limit reached. You've withdrawn {current_24h} of "
                f"{settings.max_withdrawal_kobo_per_day} kobo allowed per day."
            ),
        )

    # Check Paystack balance BEFORE debiting the user's wallet. If
    # Paystack has insufficient balance (because of auto-settlement),
    # return 503 so the client can show "temporarily unavailable".
    try:
        platform_balance_kobo = await get_paystack_client().get_balance()
    except PaystackError as exc:
        logger.error(
            "Failed to fetch Paystack balance for user=%s: %s",
            user_row.id,
            exc,
        )
        raise HTTPException(
            status_code=503,
            detail="Unable to check platform balance. Please try again later.",
        ) from exc

    # The NET amount we send to Paystack is just the withdrawal (the fee
    # stays in our balance). If Paystack's balance < net amount, block.
    if platform_balance_kobo < payload.amount_kobo:
        logger.warning(
            "Insufficient Paystack balance: have=%d, need=%d for user=%s",
            platform_balance_kobo,
            payload.amount_kobo,
            user_row.id,
        )
        raise HTTPException(
            status_code=503,
            detail="Withdrawals temporarily unavailable. Please try again later.",
        )

    if user_row.points_balance < total_debit_kobo:
        # Surface the exact shortfall so the client can show
        # "you need ₦X more to cover the fee" instead of a generic
        # "insufficient balance" error.
        shortfall_kobo = total_debit_kobo - user_row.points_balance
        raise HTTPException(
            status_code=400,
            detail=(
                f"Insufficient points balance. You need {shortfall_kobo} more "
                f"kobo to cover the {fee_kobo} kobo withdrawal fee."
            ),
        )

    # Step 4: create the transaction row. fee_kobo is persisted so the
    # audit trail shows the gross debit, and so the webhook reversal
    # can refund the right amount even if the schedule changes later.
    reference = f"pp_{uuid.uuid4().hex[:24]}"
    txn = PayoutTransaction(
        user_id=user_row.id,
        reference=reference,
        amount_kobo=payload.amount_kobo,
        fee_kobo=fee_kobo,
        recipient_code=payout_row.recipient_code,
        reason=payload.reason,
        status="pending",
        balance_after_debit=user_row.points_balance - total_debit_kobo,
    )
    db.add(txn)

    # Step 5: debit the wallet by the GROSS amount (withdrawal + fee).
    user_row.points_balance -= total_debit_kobo

    # Step 6: call Paystack with the NET amount (just the withdrawal —
    # the user paid the fee separately and it stays in our balance).
    try:
        receipt = await get_paystack_client().initiate_transfer(
            recipient_code=payout_row.recipient_code,
            amount_kobo=payload.amount_kobo,
            reason=payload.reason or "PagePay withdrawal",
            reference=reference,
        )
    except PaystackError as exc:
        await db.rollback()
        logger.error(
            "Paystack /transfer failed for user=%s ref=%s: %s",
            user_row.id,
            reference,
            exc,
        )
        raise HTTPException(
            status_code=502,
            detail=(
                "Paystack rejected the transfer. Please try again, "
                "or contact support if the issue persists."
            ),
        ) from exc

    txn.paystack_transfer_code = receipt.transfer_code or None
    txn.status = receipt.status if receipt.status in ("pending", "success", "failed") else "pending"

    await db.commit()
    await db.refresh(txn)
    await db.refresh(user_row)

    logger.info(
        "User %s withdrew %d kobo (fee=%d) → ref=%s status=%s new_balance=%d",
        user_row.id,
        payload.amount_kobo,
        fee_kobo,
        reference,
        txn.status,
        user_row.points_balance,
    )

    return WithdrawalResponse(
        transfer_reference=reference,
        status=txn.status,
        new_balance_points=user_row.points_balance,
        fee_kobo=fee_kobo,
        amount_kobo=payload.amount_kobo,
    )


# ── Webhook ───────────────────────────────────────────────────────────


@router.post("/webhook")
async def paystack_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Receive Paystack events.

    Auth: HMAC-SHA512(secret, raw_body) compared to the
    `X-Paystack-Signature` header in constant time. Mismatch → 401.
    Verified body is dispatched on `event`:

      - `transfer.success`  → mark the matching `payout_transactions`
                              row as `status=success, settled_at=now`.
                              The debit already happened at withdraw
                              time so this is just the confirmation.
      - `transfer.failed` / `transfer.reversed` → mark the row as
                              `status=failed, settled_at=now` AND
                              reverse the debit (add the points back
                              to the user's balance).
      - anything else (including `charge.success` for Phase 3
        premium) → 200 no-op with a log line so Paystack doesn't
        retry.

    We read the raw body BEFORE parsing JSON so the signature check
    runs against the exact bytes Paystack signed. Parsing JSON before
    verification would let an attacker craft a payload that survives
    parsing but fails the signature.
    """
    raw_body = await request.body()
    signature = request.headers.get("X-Paystack-Signature")
    # Paystack signs with your secret key, not a separate webhook secret
    secret = settings.paystack_secret_key

    if not _verify_webhook_signature(raw_body, signature, secret):
        logger.warning(
            "Paystack webhook rejected: bad signature (had=%r, secret_set=%s)",
            bool(signature),
            bool(secret),
        )
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    try:
        event = json.loads(raw_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        logger.warning("Paystack webhook body was not valid JSON: %s", exc)
        raise HTTPException(status_code=400, detail="Invalid JSON body") from exc

    if not isinstance(event, dict):
        raise HTTPException(status_code=400, detail="Webhook payload must be a JSON object")

    event_name = event.get("event")
    data = event.get("data") or {}
    if not isinstance(data, dict):
        data = {}

    # We only care about transfer events for Phase 4. Charges
    # (premium subscriptions) are Phase 3 — log and move on so
    # Paystack doesn't retry.
    if event_name not in ("transfer.success", "transfer.failed", "transfer.reversed"):
        logger.info("Paystack webhook: ignoring event=%s", event_name)
        return {"received": True, "handled": False}

    reference = str(data.get("reference") or "").strip()
    if not reference:
        logger.warning(
            "Paystack webhook %s arrived with no reference; cannot reconcile",
            event_name,
        )
        # Still return 200 — Paystack would retry forever otherwise.
        return {"received": True, "handled": False, "reason": "no_reference"}

    txn = (
        await db.execute(
            select(PayoutTransaction).where(PayoutTransaction.reference == reference)
        )
    ).scalar_one_or_none()
    if txn is None:
        # Idempotency / foreign-key: this could be a transfer we
        # never created (operator-created test transfer) or a
        # replay after a delete. Log and 200.
        logger.warning(
            "Paystack webhook %s for unknown reference=%s; ignoring",
            event_name,
            reference,
        )
        return {"received": True, "handled": False, "reason": "unknown_reference"}

    event_id = str(data.get("id") or "").strip()
    if event_id and txn.paystack_event_id == event_id:
        logger.info(
            "Paystack webhook %s for reference=%s already processed (event_id=%s); ignoring replay",
            event_name,
            reference,
            event_id,
        )
        return {"received": True, "handled": True, "event": event_name, "reason": "duplicate_event"}

    if event_id:
        txn.paystack_event_id = event_id

    # Update the row + (for failed) reverse the debit. We commit
    # inside the handler so the next webhook or list call sees the
    # new state.
    settled = datetime.utcnow()

    if event_name == "transfer.success":
        txn.status = "success"
        txn.settled_at = settled
        # Pull the live transfer_code off the event if we don't have one.
        if not txn.paystack_transfer_code:
            txn.paystack_transfer_code = str(data.get("transfer_code") or "") or None
    else:  # transfer.failed or transfer.reversed
        # Reverse the debit ONLY if we haven't already (idempotent
        # webhooks — Paystack may retry).
        if txn.status != "failed":
            user_row = (
                await db.execute(
                    select(User).where(User.id == txn.user_id)
                )
            ).scalar_one_or_none()
            if user_row is not None:
                # Refund the GROSS debit (amount + fee) so the user
                # lands at the same balance they had before the
                # withdraw call. The fee stays in our balance on
                # success, leaves with the refund on failure.
                refund_kobo = txn.amount_kobo + (txn.fee_kobo or 0)
                user_row.points_balance = user_row.points_balance + refund_kobo
                logger.info(
                    "Reversed %d kobo debit (amount=%d + fee=%d) for user=%s ref=%s (event=%s)",
                    refund_kobo,
                    txn.amount_kobo,
                    txn.fee_kobo or 0,
                    txn.user_id,
                    txn.reference,
                    event_name,
                )
            else:
                # User row deleted — log and continue. We still flip
                # the txn row so the audit trail is consistent.
                logger.error(
                    "Cannot reverse debit for missing user_id=%s ref=%s",
                    txn.user_id,
                    txn.reference,
                )
            txn.status = "failed"
            txn.settled_at = settled

    await db.commit()
    return {"received": True, "handled": True, "event": event_name}


def _verify_webhook_signature(
    raw_body: bytes, signature_header: str | None, secret: str | None
) -> bool:
    """HMAC-SHA512(secret_key, raw_body) === X-Paystack-Signature (hex).
    
    Paystack signs webhooks using your SECRET KEY (not a separate webhook secret).

    Constant-time compare to prevent timing attacks. Missing header
    or secret → False. Caller treats False as 401.
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
    return hmac.compare_digest(computed, signature_header.strip())