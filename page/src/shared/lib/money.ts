/**
 * Money formatting + points ↔ naira conversion for PagePay.
 *
 * Three units in play throughout the app:
 *   - kobo     : smallest NGN unit (100 kobo = ₦1)
 *   - naira    : NGN whole unit (1 naira = 100 kobo)
 *   - points   : in-app wallet unit (POINTS_PER_NAIRA points = ₦1)
 *
 * The conversion rate `POINTS_PER_NAIRA` is configured once per
 * environment (`.env` files) so a future revaluation is a one-line
 * change:
 *   backend/.env     → POINTS_PER_NAIRA=10
 *   client/.env      → EXPO_PUBLIC_POINTS_PER_NAIRA=10
 *
 * Both sides must agree, otherwise the worker will see one number in
 * the wallet header and a different number on the task card. The
 * helpers below guarantee both display paths use the same number.
 */

/** Read the points-per-naira rate from the Expo public env. Default 10. */
const POINTS_PER_NAIRA = parseInt(
  // EXPO_PUBLIC_* is inlined at build time; falls back to 10 if the
  // env var is missing (e.g. local dev before .env was copied).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_POINTS_PER_NAIRA : null) ?? '10',
  10,
);

/** NGN value of one wallet point. Derived from the env rate, not hardcoded. */
export const NGN_PER_POINT = 1 / POINTS_PER_NAIRA;

/** Points value of one whole NGN. Derived from the env rate, not hardcoded. */
export const POINTS_PER_NAIRA_VALUE = POINTS_PER_NAIRA;

/**
 * Format a kobo amount as a Naira string with two decimal places and
 * thousands separators. Examples (with POINTS_PER_NAIRA=10):
 *   formatKobo(0)        → "₦0.00"
 *   formatKobo(1500)     → "₦15.00"
 *   formatKobo(123456)   → "₦1,234.56"
 *   formatKobo(1_000_000) → "₦10,000.00"
 *
 * 1 kobo = ₦0.01 (a fixed NGN convention, NOT derived from
 * POINTS_PER_NAIRA — kobo is a currency sub-unit, independent of the
 * in-app points rate).
 */
export function formatKobo(kobo: number): string {
  const ngn = kobo / 100;
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
 * Compact points formatter for tight UI like the home header chip.
 * Rounds to one decimal and appends k / m. Examples:
 *   formatPointsCompact(0)       → "0"
 *   formatPointsCompact(999)     → "999"
 *   formatPointsCompact(1000)    → "1k"
 *   formatPointsCompact(1100)    → "1.1k"
 *   formatPointsCompact(10_000)  → "10k"
 *   formatPointsCompact(1_200_000) → "1.2m"
 */
export function formatPointsCompact(points: number): string {
  const abs = Math.abs(points);
  if (abs >= 1_000_000) {
    const val = points / 1_000_000;
    return `${val.toFixed(2)}m`;
  }
  if (abs >= 1000) {
    const val = points / 1000;
    return `${val.toFixed(2)}k`;
  }
  return String(points);
}

/**
 * Convert a kobo-denominated reward (e.g. `task.reward_amount` from
 * the API, or `submission.reward_paid`) into the wallet points the
 * worker will be credited. With POINTS_PER_NAIRA=10:
 *   koboToPoints(10000)   → 1000    (₦100 reward = 1,000 pts)
 *   koboToPoints(50000)   → 5000    (₦500 reward = 5,000 pts)
 */
export function koboToPoints(kobo: number): number {
  return Math.round((kobo / 100) * POINTS_PER_NAIRA);
}

/**
 * Convert a kobo-denominated reward into the naira string the worker
 * sees on the task card. Thin wrapper around `formatKobo` kept here
 * so call sites read like the rest of the conversions.
 */
export function koboToNairaString(kobo: number): string {
  return formatKobo(kobo);
}

/**
 * Convert wallet points back to the naira string. With
 * POINTS_PER_NAIRA=10:
 *   pointsToNairaString(1000) → "₦100.00"
 *   pointsToNairaString(5000) → "₦500.00"
 */
export function pointsToNairaString(points: number): string {
  return formatKobo(points * (100 / POINTS_PER_NAIRA));
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