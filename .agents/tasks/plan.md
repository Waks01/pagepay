# Paystack Payment Flow Investigation & Implementation Plan

## Root Cause Analysis

### Finding 1: Browser/Webview Behavior
After thorough investigation of the codebase, the **expo-paystack** package (v0.1.0) uses an **internal WebView** to handle Paystack payment flows, NOT an external browser. The `initializePayment()` method opens an in-app modal/webview controlled by the Paystack SDK.

However, the **actual problem is NOT the browser type** — it's the **improper callback handling and polling logic** in `fund-wallet.tsx` that prevents the app from correctly tracking payment completion.

### Finding 2: The Real Issue
Comparing `fund-wallet.tsx` vs `premium/index.tsx`:

**Premium (WORKING CORRECTLY):**
- Calls `initializePayment()` with proper `onSuccess`, `onCancel`, `onError` callbacks
- Each callback immediately shows appropriate alerts and refreshes data
- Relies on **webhook + on-focus refresh** pattern (backend webhook updates payment status, frontend refreshes data after delay)
- NO polling after payment
- App flow: payment → callbacks fire → data refresh → return to app normally

**Fund Wallet (BROKEN):**
- Calls `initializePayment()` with empty callback bodies (only logging)
- After payment modal closes, calls `pollPaymentStatus()` which attempts to poll user data 10 times
- **CRITICAL BUG**: `await initializePayment()` — this causes the app to wait for the webview to close, but the webview doesn't close properly until the user returns
- User gets stuck: they complete payment in the webview, but the `await` is still blocking, causing navigation/app state confusion
- Polling is unreliable and adds unnecessary delay

### Finding 3: Callback Structure Mismatch
The `premium/index.tsx` implementation shows the correct pattern:
- `onSuccess`: Show success alert, refresh data with delay
- `onCancel`: Call backend cancel endpoint, show cancellation alert, refresh data
- `onError`: Call backend fail endpoint, show error alert, refresh data

The `fund-wallet.tsx` has empty callback bodies, relying entirely on post-payment polling, which doesn't work reliably.

---

## Implementation Plan

### 1. Fix `fund-wallet.tsx` callback handlers to match `premium/index.tsx` pattern
Add proper implementations for `onSuccess`, `onCancel`, and `onError` callbacks in the `initializePayment()` call. These callbacks will handle payment status updates immediately rather than polling.

**Reason for change:** The callbacks fire as soon as the user completes/cancels/errors in the payment flow. This is more reliable than polling and allows the app to return to normal state immediately.

**Files:**
- `c:\Users\kenik\OneDrive\Pictures\pagepay\page\src\app\(app)\home\fund-wallet.tsx`

**Verify:**
```
cd c:\Users\kenik\OneDrive\Pictures\pagepay\page
npm run lint -- --fix src/app/\(app\)/home/fund-wallet.tsx
```
Check that the file has no syntax errors and the format matches the project style.

---

### 2. Remove the `await` before `initializePayment()` call
The `await` blocks further execution while the webview is open. Remove it so the function returns immediately after opening the payment modal. The callbacks will handle completion logic, not post-execution code.

**Reason for change:** `initializePayment()` opens an async modal but the function should return immediately. The `await` causes the app to hang waiting for the webview to close, which interferes with navigation.

**Files:**
- `c:\Users\kenik\OneDrive\Pictures\pagepay\page\src\app\(app)\home\fund-wallet.tsx`

**Verify:**
```
cd c:\Users\kenik\OneDrive\Pictures\pagepay\page
npm run lint -- --fix src/app/\(app\)/home/fund-wallet.tsx
```

---

### 3. Remove the polling logic entirely
Delete the `pollPaymentStatus()` function and the call to it after `initializePayment()`. The callback handlers will trigger data refresh automatically.

**Reason for change:** Polling is an anti-pattern for payment flows. The webhook sent by Paystack to the backend is the single source of truth. Frontend polling attempts to race with the webhook and often fail. The correct pattern is:
1. Payment modal closes (webhook is already in flight)
2. Callback fires immediately
3. Callback refreshes data after a short delay (3s) to allow webhook to process
4. Data reflects actual payment status

**Files:**
- `c:\Users\kenik\OneDrive\Pictures\pagepay\page\src\app\(app)\home\fund-wallet.tsx`

**Verify:**
```
cd c:\Users\kenik\OneDrive\Pictures\pagepay\page
npm run lint -- --fix src/app/\(app\)/home/fund-wallet.tsx
```

---

### 4. Move `pollPaymentStatus()` call logic into the `onSuccess` callback
After payment succeeds, the app should:
1. Show success alert
2. Call the backend cancel/fail endpoints if needed (for failed payments, use `onError`)
3. Refresh wallet and user data after 3s delay
4. Return to previous screen

**Reason for change:** The success flow should be deterministic and in one place (the callback), not split between callback and post-function code.

**Files:**
- `c:\Users\kenik\OneDrive\Pictures\pagepay\page\src\app\(app)\home\fund-wallet.tsx`

**Verify:**
```
cd c:\Users\kenik\OneDrive\Pictures\pagepay\page
npm run lint -- --fix src/app/\(app\)/home/fund-wallet.tsx
```

---

### 5. Add `onCancel` handler to call backend cancel endpoint
When user cancels payment, POST to `/api/v1/wallet/deposit/cancel` (similar to premium flow's `/api/v1/payments/status/{reference}/cancel`).

**Reason for change:** Backend must know that the user cancelled so it can update the transaction status and prevent duplicate attempts.

**Files:**
- `c:\Users\kenik\OneDrive\Pictures\pagepay\page\src\app\(app)\home\fund-wallet.tsx`

**Verify:**
```
cd c:\Users\kenik\OneDrive\Pictures\pagepay\page
npm run lint -- --fix src/app/\(app\)/home/fund-wallet.tsx
```

---

### 6. Add `onError` handler to call backend fail endpoint
When payment errors, POST to `/api/v1/wallet/deposit/fail` with error details.

**Reason for change:** Backend must know about payment failures to update transaction status and allow user to retry.

**Files:**
- `c:\Users\kenik\OneDrive\Pictures\pagepay\page\src\app\(app)\home\fund-wallet.tsx`

**Verify:**
```
cd c:\Users\kenik\OneDrive\Pictures\pagepay\page
npm run lint -- --fix src/app/\(app\)/home/fund-wallet.tsx
```

---

### 7. Verify no other files need changes
Search for any other files that use `initializePayment()` or depend on `fund-wallet.tsx` behavior.

**Files to check:**
- Any imports of `fund-wallet.tsx` 
- Any other payment-related screens

**Verify:**
```
cd c:\Users\kenik\OneDrive\Pictures\pagepay\page
grep -r "fund-wallet" src/ 2>/dev/null || echo "No other imports found"
grep -r "pollPaymentStatus" src/ 2>/dev/null || echo "No other references to polling"
```

---

## Key Questions Answered

### Q: Does `initializePayment()` open an external browser or internal webview?
**A:** Internal WebView. The expo-paystack package handles everything in-app.

### Q: What was causing the app to get "stuck"?
**A:** The `await initializePayment()` was blocking execution while the user was in the payment webview. Even though the webview was internal, the `await` caused the JavaScript execution to pause, preventing the app from returning to normal state and accepting navigation. Combined with empty callbacks and the polling fallback, the user experienced a stuck/frozen state.

### Q: Why does `premium/index.tsx` work and `fund-wallet.tsx` doesn't?
**A:** Premium correctly implements all three callbacks with proper success/cancel/error handling. It also does NOT await the initializePayment call—it lets the function return immediately, then the callbacks handle the completion logic. Fund-wallet awaits the call, relies on polling, and has empty callbacks.

### Q: Why shouldn't we poll for payment status?
**A:** 
1. Race condition with backend webhook processing
2. Unreliable — polling may miss the webhook update
3. Adds 2-20 second delay unnecessarily
4. Webhook is the single source of truth, not client-side polling
5. Premium flow already proves webhook + delayed refresh works correctly

---

## Summary of Changes

All changes go to **`fund-wallet.tsx`** only:

1. ✅ Add proper `onSuccess` callback that shows alert + refreshes data
2. ✅ Add proper `onCancel` callback that calls backend + shows alert
3. ✅ Add proper `onError` callback that calls backend + shows alert  
4. ✅ Remove `await` before `initializePayment()`
5. ✅ Remove `pollPaymentStatus()` function entirely
6. ✅ Remove the call to `pollPaymentStatus()` after payment modal closes
7. ✅ Keep the rest of the deposit flow (initiate → open payment) unchanged

**Result:** Users will experience smooth payment flow:
- Click Pay → Payment modal opens (internal webview)
- Complete payment → Callback fires → Success alert shows → Data refreshes → User returns to home
- No waiting, no polling, no "stuck" state
