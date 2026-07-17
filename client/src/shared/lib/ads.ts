/**
 * Ad SDK configuration + server-token helpers.
 *
 * The split:
 *   - `fetchAdsConfig()` is a TanStack-Query-friendly fetch of
 *     `/api/v1/config/ads?env=<env>`. The result is cached in
 *     QueryClient for 1h — the server response is tiny (a flat
 *     dict of unit IDs) and the call is unauthenticated, so
 *     making it on every app cold start is fine.
 *   - `PLATFORM_ENV` reads `app.config.js` → `expoConfig.extra.adsEnv`
 *     to decide whether to ask the server for prod or dev IDs.
 *     The dev branch returns Google's documented test unit IDs
 *     (so dev builds never burn real impressions against the
 *     production account); the prod branch returns the PagePay
 *     IDs the ops team seeded in `app_config`.
 *   - `requestAdToken()` and `pollRecentCredits()` together
 *     implement the server-authoritative credit flow. The client
 *     asks the server for a one-time AdRequest token, passes
 *     that token to AdMob as `custom_data`, and polls the
 *     `/api/v1/ads/recent-credits` endpoint after the ad
 *     closes to find out if the credit landed. The client
 *     NEVER tells the server how much revenue the ad earned —
 *     the AdMob SSV callback is the only path that credits
 *     points, and that path runs entirely server-side.
 *
 * The legacy `logAdImpression` + `claimAdReward` helpers (and
 * the `revenue_usd` field they sent) were removed because the
 * server endpoints they called (`/api/v1/ads/impression`,
 * `/api/v1/ads/reward-claim`) are now 410 Gone. The new flow
 * doesn't need any client-side impression logging — only the
 * SSV callback (which the SDK fires automatically) is needed
 * to land a credit.
 */

import Constants from 'expo-constants';
import { TASK_BASE_RATES_KOB } from '@/src/shared/constants/task-rates';
import { apiFetch } from '@/src/shared/api/client';


/** Which ad environment the client should fetch. Driven by
 *  `app.config.js` → `expoConfig.extra.adsEnv`. Defaults to
 *  `dev` so a fresh dev build never accidentally serves prod
 *  unit IDs. CI sets this to `prod` before the staging build. */
export const PLATFORM_ENV: 'dev' | 'prod' =
  (Constants.expoConfig?.extra?.adsEnv as 'dev' | 'prod' | undefined) ??
  (__DEV__ ? 'dev' : 'prod');


/** Slot + platform → unit id mapping. The server returns this
 *  flat; we re-declare the slot names here so callers can fail
 *  fast at type-check time on a typo. */
export type AdSlot =
  | 'in_feed_android'
  | 'in_feed_ios'
  | 'interstitial_android'
  | 'interstitial_ios'
  | 'rewarded_android'
  | 'rewarded_ios'
  | 'banner_android'
  | 'banner_ios';

export type AdPlatform = 'android' | 'ios';


export type AdsConfig = {
  /** AdMob App ID for the Android app (the value placed in
   *  AndroidManifest.xml via app.config.js). */
  android_app_id: string;
  /** AdMob App ID for the iOS app (the value placed in
   *  Info.plist via app.config.js). */
  ios_app_id: string;
} & Record<AdSlot, string>;


/** Query key for the ads-config cache. Centralized so the
 *  catalog/wallet/etc. all invalidate the same key when ops
 *  rotates a unit ID. */
export const ADS_CONFIG_QUERY_KEY = ['ads', 'config', PLATFORM_ENV] as const;


/** Fetch the current ad config from the backend. Returns an
 *  empty-string-filled object on network failure so the rest
 *  of the client never has to special-case a missing config —
 *  every slot degrades to "disabled" and the MockAdModal
 *  takes over.
 *
 *  The endpoint is unauthenticated per the backend spec; the
 *  server only returns the value for the requested `env` so a
 *  dev build can never accidentally read prod unit IDs. */
export async function fetchAdsConfig(): Promise<AdsConfig> {
  const url = `/api/v1/config/ads?env=${encodeURIComponent(PLATFORM_ENV)}`;
  try {
    const res = await apiFetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch ads config: HTTP ${res.status}`);
    }
    return (await res.json()) as AdsConfig;
  } catch (err) {
    // Network failure or HTTP error — return an empty config so
    // the rest of the app keeps working (the MockAdModal is the
    // fallback for every disabled slot).
    if (__DEV__) {
      console.warn('[ads] fetchAdsConfig failed, falling back to empty config', err);
    }
    return {
      android_app_id: '',
      ios_app_id: '',
      in_feed_android: '',
      in_feed_ios: '',
      interstitial_android: '',
      interstitial_ios: '',
      rewarded_android: '',
      rewarded_ios: '',
      banner_android: '',
      banner_ios: '',
    };
  }
}


/** Response shape from POST /api/v1/ads/request-token.
 *
 *  `custom_data` is the exact string the client passes to
 *  AdMob's ad request (the `customData` parameter on Android,
 *  `request.customData` on iOS). AdMob echoes it back in the
 *  SSV callback, signed. The server parses it as
 *  `f"{user_id}:{token}"` on receipt and credits the user
 *  only if both halves match an unexpired AdRequest row. */
export type AdRequestTokenResponse = {
  token: string;
  custom_data: string;
  ad_unit: string;
  expires_at: string;
  ad_unit_id: string | null;
};


/** One row from GET /api/v1/ads/recent-credits. */
export type AdRecentCredit = {
  ad_event_id: number;
  ad_unit: string;
  points_credited: number;
  credited_at: string;
  new_balance: number;
};


/** Request a one-time ad-request token from the server.
 *
 *  Returns the `custom_data` string the caller must pass to
 *  AdMob's ad request as `serverSideVerificationOptions.customData`.
 *  The server stores an AdRequest row that the AdMob SSV
 *  callback will consume to credit the user.
 *
 *  Throws on 4xx (e.g. non-rewarded unit → 400) and on network
 *  failure. The RewardedAd component catches and surfaces the
 *  error to the user. */
export async function requestAdToken(adUnit: string, sessionId?: number): Promise<AdRequestTokenResponse> {
  const res = await apiFetch('/api/v1/ads/request-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ad_unit: adUnit, session_id: sessionId }),
  });
  if (!res.ok) {
    // Read the error body for a clear message — the server
    // returns `detail` strings like "Only rewarded_* ad units
    // earn points." for the non-rewarded case.
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      // Non-JSON body (shouldn't happen, but don't crash).
    }
    throw new Error(`requestAdToken failed: ${detail}`);
  }
  return (await res.json()) as AdRequestTokenResponse;
}


/** Poll GET /api/v1/ads/recent-credits until a credit lands
 *  or the budget runs out.
 *
 *  `since` is an ISO 8601 timestamp the caller captured just
 *  before showing the ad (so the response only includes
 *  credits that arrived during/after the ad). Returns the
 *  first credited event, or `null` if the poll budget
 *  exhausted without seeing a credit.
 *
 *  `opts.maxAttempts` defaults to 10 (≈ 15s at 1.5s/attempt).
 *  `opts.intervalMs` defaults to 1500. The default is sized
 *  for typical AdMob SSV callback latency (1–3s) with margin
 *  for flaky networks; the RewardedAd component surfaces a
 *  "credit pending" state on null so the user isn't blocked.
 *
 *  Polling (vs server-sent events) is the right primitive
 *  here: the SSV callback is a server-to-server hop, not
 *  pushed to the client, and the AdMob SDK has no client-
 *  visible event for "credit landed." Polling /recent-credits
 *  is the simplest way to ask the server "has my credit
 *  arrived yet?" without trusting any client-side timer.
 */
export async function pollRecentCredits(
  since: string,
  opts?: { maxAttempts?: number; intervalMs?: number; signal?: AbortSignal },
): Promise<AdRecentCredit | null> {
  const maxAttempts = opts?.maxAttempts ?? 10;
  const intervalMs = opts?.intervalMs ?? 1500;
  const signal = opts?.signal;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) return null;

    try {
      const res = await apiFetch(
        `/api/v1/ads/recent-credits?since=${encodeURIComponent(since)}&limit=1`,
      );
      if (res.ok) {
        const body = (await res.json()) as AdRecentCredit[];
        if (body.length > 0) {
          // First row is the freshest credit since `since`.
          return body[0];
        }
      }
    } catch (err) {
      if (__DEV__) {
        console.warn(`[ads] pollRecentCredits attempt ${attempt + 1} failed`, err);
      }
      // Network blip — keep trying. The next attempt may succeed.
    }

    if (attempt < maxAttempts - 1) {
      // Wait intervalMs before the next attempt, but bail early
      // if the caller aborted (e.g. component unmounted).
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, intervalMs);
        signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
      if (signal?.aborted) return null;
    }
  }
  return null;
}


// ── Platform revenue config ────────────────────────────────────────

export type PlatformConfig = {
  ad_revenue_platform_percent: number;
  ad_revenue_user_percent: number;
  task_revenue_platform_percent: number;
  task_revenue_worker_percent: number;
  task_base_rates_kobo: Record<string, number>;
};

export const PLATFORM_CONFIG_QUERY_KEY = ['platform', 'config'] as const;

export async function fetchPlatformConfig(): Promise<PlatformConfig> {
  const url = '/api/v1/config/platform';
  try {
    const res = await apiFetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as PlatformConfig;
  } catch (err) {
    if (__DEV__) {
      console.warn('[platform] fetchPlatformConfig failed, falling back to defaults', err);
    }
    return {
      ad_revenue_platform_percent: 0.15,
      ad_revenue_user_percent: 0.85,
      task_revenue_platform_percent: 0.30,
      task_revenue_worker_percent: 0.70,
      task_base_rates_kobo: TASK_BASE_RATES_KOB,
    };
  }
}
