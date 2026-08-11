/**
 * Very small in-memory flag used to tell the Wallet screen that the
 * user just completed PIN verification and should be shown the
 * withdrawal modal immediately.
 *
 * This is intentionally not persisted — it only lives for the current
 * JS context lifetime and is cleared after first use.
 */

let pendingWithdrawAfterPin = false;

export function setPendingWithdrawAfterPin(value: boolean): void {
  pendingWithdrawAfterPin = value;
}

export function consumePendingWithdrawAfterPin(): boolean {
  const value = pendingWithdrawAfterPin;
  pendingWithdrawAfterPin = false;
  return value;
}
