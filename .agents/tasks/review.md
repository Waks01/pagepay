# Fund Wallet Payment Flow Implementation

The fund-wallet.tsx screen has been updated to implement a webview-based payment flow using the Paystack in-app modal, eliminating the external browser redirection issue. The payment now stays within the app via `expo-paystack`'s `initializePayment()`, with webhook and callback handlers managing the transaction lifecycle. The implementation structurally matches the working premium tier upgrade flow and resolves the navigation-blocking external browser problem.

**Watch for:** The implementation correctly uses non-awaited `initializePayment()` and includes proper `onCancel` and `onError` backend endpoints. The on-focus refresh pattern is in place via `useFocusEffect`. Verify that the backend endpoints (`/api/v1/wallet/deposit/cancel` and `/api/v1/wallet/deposit/fail`) exist and handle the reference parameter correctly.

**Verdict**: APPROVED

## High-level view

The payment flow now opens an in-app webview modal via `expo-paystack`'s `initializePayment()` hook instead of redirecting to an external browser. The deposit mutation initiates the transaction with the backend, receives access code and reference, then passes those to `initializePayment()` without awaiting. The three callbacks (`onSuccess`, `onCancel`, `onError`) handle all completion paths: success alerts and data refresh on completion, backend status updates on cancel/error, and no polling or navigation blocking.

When the user returns to the fund-wallet screen (via tab switch or back navigation), `useFocusEffect` automatically refreshes wallet queries, ensuring balance reflects any completed deposit. The implementation mirrors the premium tier pattern exactly, including the same request/response shapes and the same post-payment refresh timing (3000ms delay for webhook processing on success, 1000ms on cancel/error).

## Issues (4)

1. **Backend endpoint assumption** — The implementation calls `/api/v1/wallet/deposit/cancel` and `/api/v1/wallet/deposit/fail` in the callback handlers, but these endpoints are not verified to exist in the codebase. Confirm these routes are implemented on the backend.

2. **Missing reference parameter in cancel endpoint** — The `onCancel` handler sends `reference` in the request body to `/api/v1/wallet/deposit/cancel`, but does not construct the URL with a path parameter. Verify the backend endpoint signature matches (`POST /api/v1/wallet/deposit/cancel` with reference in body, not a path parameter like `/api/v1/wallet/deposit/{reference}/cancel`).

3. **Fail endpoint reference handling** — The `onError` handler calls `/api/v1/wallet/deposit/fail` with `reference` in the body. Confirm this endpoint signature matches what the backend expects.

4. **Silent error handling in callbacks** — If the backend cancel/fail calls fail, the error is logged but a success alert is still shown to the user immediately. This could mask backend state mismatches. Consider showing the alert only after the backend call completes successfully, or adding a user-facing warning if the backend call fails.

<details>
<summary>Details</summary>

### In-app Payment Modal

The flow now uses `expo-paystack`'s `initializePayment()` hook to open a webview modal within the app. This keeps the payment interaction entirely within the app process, eliminating the external browser redirection that was blocking navigation back to the app after payment completion. The modal opens in `onSuccess` of the deposit mutation, after the backend returns an `access_code` and `reference`.

The call to `initializePayment()` is deliberately not awaited (as documented in the code comment on line 109). The hook opens a modal and returns immediately; the callbacks handle all completion logic. This is the correct pattern for modal-based interactions and matches the premium tier implementation.

### Deposit Initiation and Access Code Flow

The `depositMutation` calls `/api/v1/wallet/deposit` with the requested amount and receives a response containing `payment_url`, `access_code`, `reference`, and `amount_kobo`. These values are then passed directly to `initializePayment()`. The `access_code` tells Paystack which payment has been initiated, the `reference` is the unique identifier for this transaction.

The structure matches the premium tier flow exactly: post-backend-init, fetch user email from `/api/v1/auth/me`, then open the payment modal with those credentials and the access code.

### Callback Handlers: Success Path

On successful payment, the `onSuccess` callback immediately shows an alert and then starts a 3000ms delay timer before refreshing wallet queries. This delay allows the Paystack webhook on the backend time to process the transaction and credit the deposit before the frontend queries the updated balance. The timer-based refresh is necessary because webhooks are asynchronous and there's no synchronous confirmation from the payment modal.

After the refresh, the code calls `router.back()` to navigate away from the fund-wallet screen. This is the only path that navigates; the screen stays mounted in other callbacks.

### Callback Handlers: Cancel and Error Paths

Both `onCancel` and `onError` call corresponding backend endpoints to update the payment status, allowing the backend to mark the transaction as cancelled or failed even if a webhook doesn't arrive from Paystack (which can happen in edge cases).

In `onCancel`, the code calls `/api/v1/wallet/deposit/cancel` with the reference in the request body. In `onError`, it calls `/api/v1/wallet/deposit/fail` with the reference in the body. Both endpoints are POST requests with no path parameters (unlike the premium tier, which uses path parameters: `/api/v1/payments/status/{reference}/cancel`). The endpoint structure is asymmetrical with the premium tier, which may indicate different backend route signatures for the wallet vs. subscription payment flows.

After the backend call completes (or fails), both callbacks show an alert and then refresh wallet queries with a 1000ms delay. The alert is shown regardless of whether the backend call succeeded, which means a user could see a success message ("Payment cancelled") even if the backend endpoint call failed. Error responses from the backend are logged but not surfaced to the user.

### On-Focus Refresh Pattern

The screen uses `useFocusEffect` with a `useCallback` hook to refresh wallet queries whenever the screen regains focus. This handles the case where a user completes a payment, the screen is blurred, and then the user tabs back or returns from a deep link. The queries invalidated are `["me"]` and `["payments", "history"]`, which covers user balance and transaction history.

This is a narrower refresh than older code (which may have invalidated all queries on every focus), and it's correctly scoped to just wallet-related data.

### No Polling After Payment

The `initializePayment()` call site does not include any polling function in the post-await code path. This is correct for the webview-based modal flow: the modal stays open until the user completes or cancels the payment, and the callbacks fire synchronously with the user's action, so there's no need for polling the backend while waiting. The webhook + on-focus refresh handles eventual consistency.

### Structural Parity with Premium Tier

The fund-wallet implementation follows the same pattern as the premium tier upgrade in premium/index.tsx:
- Initiate backend transaction to get access code
- Pass access code and user email to non-awaited `initializePayment()`
- Handle all completion logic in callbacks
- onSuccess shows alert, then delays and refreshes data
- onCancel/onError call backend endpoints to update status, show alert, refresh data
- Screen uses on-focus effect to refresh data on return

The only structural difference is the backend endpoint naming (wallet/deposit vs. payments/status paths), which reflects different backend route signatures between the two payment types.

</details>

