/**
 * Offline fallback list — DEPRECATED as the canonical source.
 *
 * @deprecated Use the live `/api/v1/payouts/banks` endpoint instead.
 * The payouts router proxies Paystack's `/bank?country=nigeria` and
 * is the authoritative list. This module is kept as an offline
 * fallback for `LinkPayoutAccountModal` — when the live fetch
 * fails (no network, server unconfigured), the modal renders the
 * curated top-N banks from this file so the user can still link a
 * popular bank.
 *
 * Codes are CBN bank codes — the same ones Paystack accepts in
 * `account_number` resolution requests.
 */
export type NigerianBank = {
  code: string;
  name: string;
  /** Short popular name shown in the picker (e.g. "GTBank" instead of
   *  "Guaranty Trust Bank"). Falls back to `name` when omitted. */
  short?: string;
};

export const NIGERIAN_BANKS: NigerianBank[] = [
  { code: '058', name: 'Guaranty Trust Bank', short: 'GTBank' },
  { code: '057', name: 'Zenith Bank', short: 'Zenith' },
  { code: '032', name: 'Union Bank of Nigeria', short: 'Union' },
  { code: '033', name: 'United Bank for Africa', short: 'UBA' },
  { code: '011', name: 'First Bank of Nigeria', short: 'First Bank' },
  { code: '044', name: 'Access Bank', short: 'Access' },
  { code: '014', name: 'Afribank Nigeria', short: 'Afribank' },
  { code: '023', name: 'Citibank Nigeria', short: 'Citibank' },
  { code: '050', name: 'Ecobank Nigeria', short: 'Ecobank' },
  { code: '070', name: 'Fidelity Bank', short: 'Fidelity' },
  { code: '069', name: 'First City Monument Bank', short: 'FCMB' },
  { code: '053', name: 'Heritage Bank', short: 'Heritage' },
  { code: '415', name: 'Keystone Bank', short: 'Keystone' },
  { code: '526', name: 'Polaris Bank', short: 'Polaris' },
  { code: '221', name: 'Stanbic IBTC Bank', short: 'Stanbic' },
  { code: '068', name: 'Standard Chartered Bank', short: 'StanChart' },
  { code: '232', name: 'Sterling Bank', short: 'Sterling' },
  { code: '100', name: 'SunTrust Bank', short: 'SunTrust' },
  { code: '035', name: 'Wema Bank', short: 'Wema' },
  { code: '022', name: 'MainStreet Bank', short: 'MainStreet' },
];

/**
 * Case-insensitive search by name, short name, or code. Returns up to
 * `limit` results, sorted with exact-prefix matches first (so "GT" or
 * "058" land at the top).
 *
 * @deprecated Used only by the offline fallback path; the live list
 * is filtered inline in `LinkPayoutAccountModal`.
 */
export function searchBanks(query: string, limit = 12): NigerianBank[] {
  const q = query.trim().toLowerCase();
  if (!q) return NIGERIAN_BANKS.slice(0, limit);

  const scored = NIGERIAN_BANKS.map((b) => {
    const name = b.name.toLowerCase();
    const short = (b.short || '').toLowerCase();
    const code = b.code;
    if (name.startsWith(q) || short.startsWith(q) || code.startsWith(q)) {
      return { bank: b, score: 0 };
    }
    if (name.includes(q) || short.includes(q) || code.includes(q)) {
      return { bank: b, score: 1 };
    }
    return null;
  }).filter((x): x is { bank: NigerianBank; score: number } => x !== null);

  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((x) => x.bank);
}