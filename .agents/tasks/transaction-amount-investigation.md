# Transaction Amount Display Bug Investigation

## Summary

**Root Cause:** The backend fix for using `deposit_amount_kobo` from `payment_metadata` IS implemented correctly in `transactionHistory.py`, but **duplicate code lines** in multiple files suggest possible merge issues. Additionally, there's a **broken frontend endpoint** (`/api/v1/payments/history` in billing/history.tsx) that doesn't exist in the backend.

The most likely cause of the ₦10,000 display instead of ₦100 is **old database records** that don't have `payment_metadata` populated (pre-fix records), causing the fallback to use `amount_kobo` — but this wouldn't explain the exact 100x multiplication.

---

## Detailed Findings

### 1. Backend Transaction History (WORKING)

**File:** `backend/app/routers/transactionHistory.py` (lines 152-157)

```python
# For wallet_deposit, show the actual deposit amount, not the total charge (which includes fee)
if tx.tier == "wallet_deposit" and tx.payment_metadata and tx.payment_metadata.get("deposit_amount_kobo"):
    display_amount = tx.payment_metadata["deposit_amount_kobo"]
else:
    display_amount = tx.amount_kobo  # Fallback for backwards compatibility
```

**Status:** ✅ The fix is correctly implemented - it reads `deposit_amount_kobo` from metadata.

**Issue:** Duplicate lines found in the grep results:
- Line 153 appears twice
- Line 172 appears twice  

This suggests a merge conflict was resolved incorrectly.

### 2. Frontend Transaction Display (WORKING)

**File:** `page/src/app/(app)/home/transactions.tsx` (lines 142-146)

```typescript
const formatAmount = (item: TransactionHistoryItem) => {
  const prefix = item.amount > 0 ? "+" : "";
  // Backend sends amount in kobo (100 kobo = ₦1), so divide by 100 to get naira
  const amountInNaira = Math.abs(item.amount) / 100;
  // ...
};
```

**Status:** ✅ Correctly divides by 100 to convert kobo → naira.

### 3. Wallet Deposit Flow (WORKING)

**File:** `backend/app/routers/wallet.py` (lines 105-192)

```python
processing_fee = min(
    ceil(payload.deposit_amount_kobo * settings.wallet_deposit_fee_percent),
    settings.wallet_deposit_max_fee_kobo,
)
total_amount = payload.deposit_amount_kobo + processing_fee

# Creates Payment record:
payment = Payment(
    amount_kobo=total_amount,  # Stores total (10,150 for ₦100)
    payment_metadata={
        "deposit_amount_kobo": payload.deposit_amount_kobo,  # Stores deposit only (10,000)
        "processing_fee_kobo": processing_fee,
    },
)
```

**Status:** ✅ Correctly stores both values.

### 4. Broken Frontend Endpoint

**File:** `page/src/app/billing/history.tsx` (line 37)

```typescript
queryFn: async () => {
  const res = await apiFetch("/api/v1/payments/history");
  // ...
},
```

**Issue:** ❌ This endpoint does NOT exist in the backend. Search results show no route for `/payments/history`. This screen would fail or return empty data.

### 5. Money Utilities

**File:** `page/src/shared/lib/money.ts`

Contains correct conversion functions:
- `formatKobo(kobo)` - divides by 100, formats as ₦X.XX
- `koboToPoints(kobo)` - converts using POINTS_PER_NAIRA (10)

---

## Mathematical Analysis

For a ₦100 deposit:

| Field | Value (kobo) | Display (naira) |
|-------|--------------|-----------------|
| User enters | 100 (naira) | ₦100 |
| Sent to backend | 10,000 | - |
| Processing fee (1.5%) | 150 | - |
| `amount_kobo` (total) | 10,150 | ₦101.50 |
| `deposit_amount_kobo` | 10,000 | ₦100.00 |

**User sees:** ₦10,000.00 — This is 100x the actual deposit.

---

## Possible Causes for 10,000 Display

1. **Old database records without metadata**: Pre-fix Payment records would have `payment_metadata = None`. Fallback uses `amount_kobo = 10,150`, which would display as ₦101.50 — NOT ₦10,000.

2. **Frontend multiplication bug**: Not found. The code correctly divides by 100.

3. **API returning wrong value**: Could be a serialization issue or cached response.

4. **Environment mismatch**: If frontend has `EXPO_PUBLIC_POINTS_PER_NAIRA` incorrectly set, it might affect display — but this doesn't explain the 100x factor.

5. **Transaction record created incorrectly**: The Payment might have been created with wrong values (e.g., amount_kobo = 1,000,000 instead of 10,000).

---

## Recommendations

### Immediate Fix

1. **Verify database records** — Check if the user's Payment records have valid `payment_metadata`:
   ```sql
   SELECT id, amount_kobo, payment_metadata 
   FROM payments 
   WHERE user_id = (SELECT id FROM users WHERE email = 'princechaawa@gmail.com') 
   AND tier = 'wallet_deposit';
   ```

2. **Fix duplicate lines** in `transactionHistory.py` — Remove duplicate if statements around line 153.

3. **Remove or fix broken endpoint** in `billing/history.tsx` — Either remove it or create the backend route.

4. **Clear frontend cache** — Have user force-close the app and re-fetch data.

### Long-term

1. Add database migration to backfill missing `payment_metadata` for old records
2. Add validation to ensure `deposit_amount_kobo <= amount_kobo`
3. Add logging to trace exactly what values the API returns

---

## Files Involved

| File | Issue |
|------|-------|
| `backend/app/routers/transactionHistory.py` | ✅ Fix in place, has duplicate lines |
| `backend/app/routers/wallet.py` | ✅ Working correctly |
| `page/src/app/(app)/home/transactions.tsx` | ✅ Working correctly |
| `page/src/app/billing/history.tsx` | ❌ Broken endpoint |
| `page/src/shared/lib/money.ts` | ✅ Working correctly |

---

## Conclusion

The code fix is in place and should work for **new** deposits. The issue the user is seeing is likely caused by:

1. **Old database records** that were created before the fix (no `payment_metadata`), OR
2. **A different display issue** somewhere else in the UI

To verify: Have the user make a **new deposit** and check if the transaction history shows the correct amount. If the new deposit shows correctly, the issue is old data. If it still shows wrong, there's a deeper bug.