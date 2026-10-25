# Implementation Plan: Wallet Deposit Bug Fixes

## Summary
Two confirmed bugs in the wallet deposit flow:
1. Transaction history shows ₦10,150 instead of ₦100 (total charge instead of deposit amount)
2. Wallet not credited after successful Paystack transaction

---

## Bug 1: Transaction History Wrong Amount

### Root Cause
In `backend/app/routers/transactionHistory.py`, line ~144:
```python
amount=tx.amount_kobo,
```
This uses the total charge (deposit + Paystack fee), not the actual deposit amount.

### Fix
When `tx.tier == "wallet_deposit"`, use `tx.payment_metadata['deposit_amount_kobo']` instead.

**Files to modify:**
- `backend/app/routers/transactionHistory.py`

**Lines around 139-152:**
```python
# Current (buggy):
for tx in payment_result.scalars().all():
    subtype = tx.tier
    description = "Wallet Deposit" if tx.tier == "wallet_deposit" else f"Premium Subscription ({tx.tier})"
    items.append(TransactionHistoryItem(
        id=tx.id,
        type="payment",
        subtype=subtype,
        status=tx.status,
        amount=tx.amount_kobo,  # BUG: total including fee
```

**Fix:**
```python
for tx in payment_result.scalars().all():
    subtype = tx.tier
    description = "Wallet Deposit" if tx.tier == "wallet_deposit" else f"Premium Subscription ({tx.tier})"
    
    # FIX: Use deposit_amount_kobo from metadata for wallet_deposit
    display_amount = tx.amount_kobo
    if tx.tier == "wallet_deposit" and tx.payment_metadata:
        metadata = tx.payment_metadata if isinstance(tx.payment_metadata, dict) else {}
        deposit_amount = metadata.get("deposit_amount_kobo")
        if deposit_amount:
            display_amount = deposit_amount
    
    items.append(TransactionHistoryItem(
        id=tx.id,
        type="payment",
        subtype=subtype,
        status=tx.status,
        amount=display_amount,  # FIX: actual deposit amount
```

**Verification:**
- Run backend tests: `pytest backend/tests/ -v -k "transaction"`
- Test manually: Make a wallet deposit and check transaction history shows correct amount

---

## Bug 2: Wallet Not Credited

### Root Cause
In `backend/app/routers/payouts.py`, the `_process_wallet_deposit()` function at line ~220 only credits if `deposit_amount_kobo` exists and is > 0:

```python
deposit_amount_kobo = metadata.get("deposit_amount_kobo")
if deposit_amount_kobo and deposit_amount_koho > 0:
    # credit wallet
else:
    logger.warning("⚠️  No deposit_amount_kobo in metadata or amount is 0")
```

If the metadata wasn't saved to the database, the wallet is silently not credited.

### Investigation Findings

1. **wallet.py (lines 188-196)** - Creates Payment with correct metadata:
   ```python
   payment = Payment(
       ...
       payment_metadata={
           "deposit_amount_kobo": payload.deposit_amount_kobo,
           "processing_fee_kobo": processing_fee,
           "total_amount_kobo": total_amount,
           "custom_amount": payload.custom_amount,
       },
   )
   ```

2. **Payment model** - `payment_metadata` is nullable and defaults to None:
   ```python
   payment_metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True)
   ```

3. **payouts.py (line 91-95)** - Checks metadata exists before processing:
   ```python
   if payment.tier == "wallet_deposit" and payment.payment_metadata:
       await _process_wallet_deposit(payment, reference, db, logger)
   ```

### Most Likely Cause
The Payment record's `payment_metadata` column is not being persisted to the database. This could happen if:
- The field is named wrong (using `metadata` instead of `payment_metadata`)
- The commit is failing silently
- There's an issue with JSON serialization

### Fix (Defensive)

Add a fallback in `_process_wallet_deposit()` to extract the deposit amount from the Payment's `amount_kobo` minus the processing_fee if metadata is missing. Also add explicit logging to diagnose.

**Files to modify:**
- `backend/app/routers/payouts.py`

**Lines around 216-220 (inside _process_wallet_deposit):**

```python
# Current (buggy):
metadata = payment.payment_metadata if isinstance(payment.payment_metadata, dict) else {}
deposit_amount_kobo = metadata.get("deposit_amount_kobo")

# FIX: Add fallback to amount_kobo - processing_fee
if not deposit_amount_kobo or deposit_amount_kobo <= 0:
    # Try to derive from amount_kobo (total - processing_fee)
    processing_fee = metadata.get("processing_fee_kobo", 0)
    if payment.amount_kobo and processing_fee:
        deposit_amount_kobo = payment.amount_kobo - processing_fee
        logger.warning(
            "⚠️  deposit_amount_kobo missing from metadata, derived from amount_kobo: %s - %s = %s",
            payment.amount_kobo, processing_fee, deposit_amount_kobo
        )
```

**Also add diagnostic logging at line ~233:**
```python
# Log what will be credited
logger.info(
    "🎯 About to credit wallet: user=%s deposit_kobo=%s points=%s split_enabled=%s",
    payment.user_id, deposit_amount_kobo, deposit_points, settings.wallet_split_enabled
)
```

**Verification:**
- Run backend tests: `pytest backend/tests/test_payouts_paystack.py -v -k "wallet"`
- Check server logs after a deposit to see the diagnostic messages

---

## Testing Checklist

1. **Backend unit tests:**
   ```bash
   pytest backend/tests/test_payouts_paystack.py -v -k "wallet_deposit"
   pytest backend/tests/ -v -k "transaction"
   ```

2. **Manual E2E test:**
   - Make a wallet deposit (e.g., ₦100)
   - Check transaction history shows ₦100 (not ₦10,150)
   - Check wallet balance increased by ~1,000 SV

---

## Rollback Plan
If issues arise, revert the changes in:
- `backend/app/routers/transactionHistory.py`
- `backend/app/routers/payouts.py`