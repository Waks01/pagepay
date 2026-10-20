/**
 * AdMob integration for PagePay.
 *
 * Formats in use (admob.md §0):
 *   - Rewarded    `ca-app-pub-3898064484524772/4958048285`  (the earn path)
 *   - Banner      `ca-app-pub-3898064484524772/7400111898`  (on the list screens)
 *   - Native adv. `ca-app-pub-3898064484524772/6538723260`  (in-feed card)
 *
 * The rewarded ad is the only format that pays out, and it is
 * user-initiated: the student taps "Watch ad", watches, and the SSV
 * callback credits 16 SV. The client's own reward callback is UX only
 * - the server is the authority (see backend/app/services/admob_ssv.py).
 *
 * Two rules that are easy to get wrong and are enforced here:
 *
 * 1. `userId` must be set on the request before `show()`, and must be
 *    unique per user. AdMob rejects a request with a missing or
 *    duplicated user id, and without it the SSV callback carries no
 *    user id at all, so the credit cannot be attributed.
 * 2. Test ad units must be used in development. Serving live ads to
 *    your own device risks invalid traffic, which gets the AdMob
 *    account suspended.
 */

import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  AdEventType,
  BannerAd,
  BannerAdSize,
  MobileAds,
  NativeAd,
  NativeAdEventType,
  NativeAdView,
  RewardedAd,
  RewardedAdEventType,
  TestIds,
} from 'react-native-google-mobile-ads';

import { apiFetch } from '@/src/shared/api/client';

/** Real ad unit ids from the AdMob console. */
export const AD_UNITS = {
  rewarded: 'ca-app-pub-3898064484524772/4958048285',
  banner: 'ca-app-pub-3898064484524772/7400111898',
  native: 'ca-app-pub-3898064484524772/6538723260',
} as const;

/**
 * Ad unit ids to use right now.
 *
 * `__DEV__` builds get Google's canonical test units, so a developer
 * never serves a live ad to their own device. Release builds get the
 * real units.
 */
export const ACTIVE_AD_UNITS = __DEV__
  ? {
      rewarded: TestIds.REWARDED,
      banner: TestIds.ADAPTIVE_BANNER,
      native: TestIds.NATIVE,
    }
  : AD_UNITS;

/** True when the app is running against Google's test inventory. */
export const USING_TEST_ADS = __DEV__;

/**
 * Report an impression's monetary value to the backend.
 *
 * The ad revenue number is what tells us whether ad-watching actually
 * funds the rewards we pay out (admob.md §8). Without it, "reward < ad
 * revenue" is a rule we can only assert, not check.
 *
 * `value` is in micros - 5000 means $0.005. `precision` distinguishes
 * an actual paid value from an estimate.
 */
export async function reportImpressionValue(
  payload: {
    value?: number;
    currency?: string;
    currencyCode?: string;
    precision?: string | number;
  } | null | undefined,
  format: 'rewarded' | 'banner' | 'native',
): Promise<void> {
  try {
    await apiFetch('/api/v1/study/ads/revenue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        format,
        value_micros: payload?.value ?? 0,
        // The formats disagree on the field name and on whether the
        // precision is a string or a numeric enum, so normalise here
        // rather than at each call site.
        currency: payload?.currency ?? payload?.currencyCode ?? 'USD',
        precision: String(payload?.precision ?? 'UNKNOWN'),
      }),
    });
  } catch (error) {
    // Revenue telemetry must never surface to the student.
    if (__DEV__) console.warn('[ads] revenue report failed', error);
  }
}

let initPromise: Promise<void> | null = null;

/**
 * Initialise the Google Mobile Ads SDK. Safe to call repeatedly - the
 * work happens once and every caller awaits the same promise.
 */
export function initAds(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const adapterStatus = await MobileAds().initialize();
        if (__DEV__) {
          console.log('[ads] MobileAds initialised', adapterStatus);
        }
      } catch (error) {
        // A failed init must not take the app down - ads are optional
        // and the rest of the app is fully usable without them.
        console.warn('[ads] MobileAds init failed', error);
      }
    })();
  }
  return initPromise;
}

/**
 * Build the request options for an ad request.
 *
 * `userId` is what lets the SSV callback credit the right account, so
 * it is required for any format that pays out.
 */
export function requestOptionsFor(userId?: string | number | null) {
  return {
    // PagePay does not yet run a UMP consent flow, so ads are
    // requested non-personalised. Serving personalised ads without
    // collecting consent is a policy violation in the EEA/UK and the
    // US states. This must be revisited when UMP lands.
    requestNonPersonalizedAdsOnly: true,
    ...(userId != null
      ? {
          serverSideVerificationOptions: {
            userId: String(userId),
            customData: 'pagepay_rewarded',
          },
        }
      : {}),
  };
}

type RewardedState = {
  /** Preload the ad so the tap is instant. */
  load: () => void;
  /** Show a loaded ad. Returns false if nothing was ready. */
  show: () => boolean;
  /** True while the ad is on screen. */
  isShowing: boolean;
  /** True when the ad finished loading and can be shown. */
  isLoaded: boolean;
  /** Set when a show attempt had no ad ready. */
  error: string | null;
  /** Fired after the user earned the reward. UX signal only. */
  onReward: () => void;
};

/**
 * A user-initiated rewarded ad.
 *
 * The ad is preloaded on mount so the tap is instant, but it is only
 * ever shown from an explicit user action. A rewarded ad that appears
 * unprompted is a policy violation and is also terrible UX in a study
 * app.
 */
export function useRewardedAd(
  userId?: string | number | null,
  onReward?: () => void,
): RewardedState {
  const rewarded = useRef<RewardedAd | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isShowing, setIsShowing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rewardRef = useRef(onReward);
  rewardRef.current = onReward;

  const load = () => {
    const instance = RewardedAd.createForAdRequest(
      ACTIVE_AD_UNITS.rewarded,
      requestOptionsFor(userId),
    );
    // A rewarded ad fires its own LOADED event
    // (RewardedAdEventType.LOADED === "rewarded_loaded"), not the
    // generic AdEventType.LOADED ("loaded"). Listening for the wrong one
    // means the ad silently never becomes showable.
    instance.addAdEventListener(RewardedAdEventType.LOADED, () =>
      setIsLoaded(true),
    );
    instance.addAdEventListener(AdEventType.ERROR, (e) => {
      setIsLoaded(false);
      setError(e?.message ?? 'Ad failed to load');
    });
    instance.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
      // UX only. The authoritative credit arrives via the SSV callback.
      rewardRef.current?.();
    });
    instance.addAdEventListener(AdEventType.PAID, (payload) => {
      // The wrapper types the paid payload as undefined for rewarded
      // ads even though the native module sends the real value.
      void reportImpressionValue(
        payload as unknown as {
          value?: number;
          currency?: string;
          precision?: string;
        },
        'rewarded',
      );
    });
    instance.addAdEventListener(AdEventType.CLOSED, () => {
      setIsShowing(false);
      setIsLoaded(false);
      // Preload the next one so the following tap is instant.
      load();
    });
    instance.load();
    rewarded.current = instance;
  };

  useEffect(() => {
    let cancelled = false;
    void initAds().then(() => {
      if (!cancelled) load();
    });
    return () => {
      cancelled = true;
    };
    // Reload when the user changes: a different user id means a
    // different SSV attribution, so the old request is stale.
  }, [userId]);

  const show = () => {
    const instance = rewarded.current;
    if (!instance || !isLoaded) {
      setError('No ad ready yet. Try again in a moment.');
      return false;
    }
    setIsShowing(true);
    setError(null);
    instance.show();
    return true;
  };

  return { load, show, isShowing, isLoaded, error, onReward: () => rewardRef.current?.() };
}

/**
 * A native advanced ad, preloaded.
 *
 * Native ads are styled by the app, so the caller supplies the view.
 * Returns null until the ad has loaded.
 */
export function useNativeAd(
  userId?: string | number | null,
): NativeAd | null {
  const [nativeAd, setNativeAd] = useState<NativeAd | null>(null);

  useEffect(() => {
    let cancelled = false;
    let created: NativeAd | null = null;
    void initAds().then(async () => {
      if (cancelled) return;
      // Unlike the other formats, createForAdRequest does the loading
      // itself and resolves with a ready ad - there is no load() call
      // and no "loaded" event for native ads.
      const instance = await NativeAd.createForAdRequest(
        ACTIVE_AD_UNITS.native,
        requestOptionsFor(userId),
      );
      if (cancelled) {
        instance.destroy();
        return;
      }
      created = instance;
      instance.addAdEventListener(NativeAdEventType.PAID, (payload) => {
        void reportImpressionValue(payload, 'native');
      });
      setNativeAd(instance);
    });
    return () => {
      cancelled = true;
      created?.destroy();
    };
  }, [userId]);

  return nativeAd;
}

export { BannerAd, BannerAdSize, NativeAdView };
