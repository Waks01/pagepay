/**
 * Money formatting for PagePay.
 *
 * The wallet's points balance, the server's `amount_kobo` field, and the
 * UI's Naira display all round-trip through the same unit: 1 point = 1
 * kobo = ₦0.01. The server is the source of truth for the rate
 * (see `compute_withdrawal_fee` / `withdrawal_fee_tiers` in
 * `backend/app/routers/payouts.py`); these helpers are pure presentation.
 *
 * NOTE: the project's spec at `.kilo/command/phase4-payments.md` Step 4
 * says prices will eventually be OTA-served via `GET /api/v1/config/public`.
 * When that endpoint lands, the per-impression math and tier fees move
 * server-side and these constants become display-only.
 */

/** Naira value of a single point. With 10 pts = ₦1, this is 0.1. */
export const NGN_PER_POINT = 0.1;

/**
 * Format a kobo amount as a Naira string with two decimal places and
 * thousands separators. Examples:
 *   formatKobo(0)        → "₦0.00"
 *   formatKobo(1500)     → "₦15.00"
 *   formatKobo(123456)   → "₦1,234.56"
 *   formatKobo(1_000_000) → "₦10,000.00"
 */
export function formatKobo(kobo: number): string {
  const ngn = kobo * NGN_PER_POINT;
  // toFixed(2) is locale-independent and always emits "123456.78" — we
  // split on "." and add the thousands separator manually so the output
  // is stable across Hermes versions.
  const [whole, frac = ''] = ngn.toFixed(2).split('.');
  const withSep = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `₦${withSep}.${frac.padEnd(2, '0')}`;
}

/**
 * Format a points balance for display in the wallet header / history.
 * Plain thousands-separated integer. Examples:
 *   formatPoints(0)        → "0"
 *   formatPoints(1234)     → "1,234"
 *   formatPoints(1_000_000) → "1,000,000"
 */
export function formatPoints(points: number): string {
  return points.toLocaleString();
}

/**
 * Withdrawal fee tier table. Duplicated from
 * `backend/app/config.py:Settings.withdrawal_fee_tiers` (the default
 * schedule) so the modal can show a live fee preview without a config
 * roundtrip.
 *
 *   ≤ ₦5,000          → ₦15  (Paystack ₦10, profit ₦5)
 *   ₦5,001 – ₦50,000  → ₦35  (Paystack ₦25, profit ₦10)
 *   > ₦50,000         → ₦70  (Paystack ₦50, profit ₦20)
 *
 * The server re-computes the fee on submit and is the source of truth;
 * this is only for the live UI preview.
 */
export const WITHDRAWAL_FEE_TIERS_KOBO: readonly (readonly [number | null, number])[] = [
  [500_000, 1_500],
  [5_000_000, 3_500],
  [null, 7_000],
];

/** Return the user-paid flat fee (in kobo) for a withdrawal of `amountKobo`. */
export function previewWithdrawalFeeKobo(amountKobo: number): number {
  for (const [maxKobo, feeKobo] of WITHDRAWAL_FEE_TIERS_KOBO) {
    if (maxKobo === null || amountKobo <= maxKobo) return feeKobo;
  }
  return WITHDRAWAL_FEE_TIERS_KOBO[WITHDRAWAL_FEE_TIERS_KOBO.length - 1]?.[1] ?? 0;
}
