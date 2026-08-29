/**
 * AdSlot — global "always one ready ad" slot.
 *
 * Why this exists
 * ---------------
 * Before this, every <RewardedAd> component would lazy-load the ad when
 * the modal opened. The user would see a "Loading your ad..." spinner
 * for 4–10 seconds before the play button activated. That felt broken.
 *
 * With AdSlot, a single rewarded ad is kept loaded at the app level
 * from the moment the user lands on a screen that needs one. The first
 * load happens immediately when the provider mounts (app start, after
 * auth gate). When the user closes an ad, the slot immediately begins
 * loading the next one so the next tap is instant.
 *
 * State machine
 * -------------
 *   uninitialized → loading → ready → busy → loading → ready → …
 *
 * - `uninitialized`: native SDK not loaded yet (Expo Go, missing module).
 *   The slot will never enter `ready`. UI must degrade gracefully.
 * - `loading`: an ad request is in flight to AdMob.
 * - `ready`: an ad is loaded, sitting in memory, can be shown immediately.
 * - `busy`: an ad is currently being shown by the user (modal is up).
 * - `error`: the last load failed (network, no fill). We retry on the
 *   next `acquire()` call.
 *
 * Concurrency
 * -----------
 * One ad instance at a time. `acquire()` is atomic: it returns the
 * ready ad (and flips state to `busy`), or it kicks off a fresh load
 * and throws a Promise the caller can await. We never let two modals
 * share the same AdMob instance — AdMob RewardedAds are single-shot
 * and showing one twice crashes the SDK.
 *
 * Cleanup
 * -------
 * On provider unmount (e.g. tests, hot-reload), the loaded ad is
 * destroyed so the SDK doesn't leak.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform } from 'react-native';
import { useAdsConfig } from '@/src/shared/hooks/use-ads-config';
import { requestAdToken } from '@/src/shared/lib/ads';
import { initializeAdMob } from '@/src/shared/lib/ads-native';

export type AdSlotState =
  | 'uninitialized'
  | 'loading'
  | 'ready'
  | 'busy'
  | 'error';

export interface AcquiredAd {
  /** Show the ad. AdMob handles the close/reward callbacks. */
  show(): void;
  /** The slot name (e.g. "rewarded_android") the ad was loaded for. */
  adUnitName: string;
  /** ISO timestamp the server token was issued at — used to scope
   *  the /recent-credits poll. */
  tokenIssuedAt: string;
  /** Server-issued customData bound to this load. Carried into the
   *  SSV callback. */
  customData: string;
  /** Optional listener fired when the AdMob ad closes (user
   *  finished watching OR skipped). The consumer can't distinguish
   *  the two from CLOSED alone — they should rely on either
   *  `onEarned` (fired when the ad fires EARNED_REWARD, i.e. the
   *  user watched to completion) or the SSV /recent-credits poll
   *  to confirm whether a credit is expected. */
  onClosed?: () => void;
  /** Optional listener fired when AdMob fires EARNED_REWARD — i.e.
   *  the user watched the full ad and is now eligible for the
   *  configured reward. The actual point credit lands via the SSV
   *  webhook; this is just the SDK's "you earned the in-ad reward"
   *  signal. Consumers should still poll /recent-credits for the
   *  authoritative points figure. */
  onEarned?: () => void;
}

export interface AdSlotContextValue {
  state: AdSlotState;
  /** Get the ready ad, atomically moving state to `busy`. Returns
   *  null when nothing is ready; the caller should wait briefly or
   *  show a fallback UI. */
  acquire(adSlot: AdSlotName): AcquiredAd | null;
  /** Called when the modal closes (regardless of whether the user
   *  watched or skipped). Triggers the next background load. */
  release(): void;
  /** Refresh after a long idle period — destroys the cached ad and
   *  forces a fresh load. Call when the user reopens the app. */
  invalidate(): void;
}

export type AdSlotName =
  | 'rewarded_android'
  | 'rewarded_ios'
  | 'in_feed_android'
  | 'in_feed_ios'
  | 'interstitial_android'
  | 'interstitial_ios';

const AdSlotContext = createContext<AdSlotContextValue | null>(null);

/** Pick the slot name for the current platform. The provider is
 *  platform-aware so callers don't have to. */
function defaultSlot(): AdSlotName {
  return Platform.OS === 'ios' ? 'rewarded_ios' : 'rewarded_android';
}

export interface AdSlotProviderProps {
  children: React.ReactNode;
}

/** Provider mounted at the root layout. Owns the lifetime of one
 *  rewarded ad instance and keeps it loaded. */
export function AdSlotProvider({ children }: AdSlotProviderProps) {
  const { data: adsConfig } = useAdsConfig();
  const [state, setState] = useState<AdSlotState>('uninitialized');

  // Refs for the underlying SDK objects. State is for UI; refs are
  // for the long-lived ad instance we don't want React to re-render.
  const adInstanceRef = useRef<any | null>(null);
  const pendingAcquireRef = useRef<((ad: AcquiredAd) => void) | null>(null);
  const inflightRef = useRef<boolean>(false);
  const mountedRef = useRef<boolean>(true);

  /** Tear down any loaded ad. Safe to call multiple times. */
  const destroyCurrent = useCallback(() => {
    if (adInstanceRef.current) {
      try {
        adInstanceRef.current.destroy?.();
      } catch {
        // The instance may already be spent; ignore.
      }
      adInstanceRef.current = null;
    }
  }, []);

  /** Internal: load a fresh ad. Returns the loaded ad (already
   *  in `ready` state) or throws on failure. */
  const loadOne = useCallback(async (): Promise<AcquiredAd> => {
    if (!adsConfig) {
      throw new Error('ads config not loaded yet');
    }
    const slot = defaultSlot();
    const adUnit = adsConfig[slot];
    if (!adUnit) {
      throw new Error(`no unit ID for slot ${slot}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sdk = require('react-native-google-mobile-ads');
    const { RewardedAd: RealRewardedAd, RewardedAdEventType, AdEventType } = sdk;

    // We need a user id for SSV customData. The server derives it from
    // the auth token in the cookie. For unauthenticated users (onboarding),
    // request-token will 401 — we degrade gracefully (slot never becomes
    // ready, UI shows fallback).
    const tokenIssuedAt = new Date().toISOString();
    const tokenRes = await requestAdToken(slot, undefined);
    if (!tokenRes?.custom_data) {
      throw new Error('server returned no custom_data');
    }

    const ad = RealRewardedAd.createForAdRequest(adUnit, {
      serverSideVerificationOptions: {
        userId: tokenRes.custom_data.split(':')[0] ?? '',
        customData: tokenRes.custom_data,
      },
    });
    (ad as any)._adUnit = adUnit;

    return new Promise<AcquiredAd>((resolve, reject) => {
      const unsubError = ad.addAdEventListener(AdEventType.ERROR, (err: unknown) => {
        try {
          ad.destroy?.();
        } catch {
          // ignore
        }
        reject(err instanceof Error ? err : new Error('ad load failed'));
      });

      // We capture CLOSED at load time using a ref-like local. The
      // consumer can attach their close-handler on the resolved
      // AcquiredAd via the `closedListener` slot. CLOSED fires once
      // per ad (the instance is single-shot).
      const result: AcquiredAd = {
        adUnitName: slot,
        tokenIssuedAt,
        customData: tokenRes.custom_data,
        show: () => {
          try {
            ad.show();
          } catch {
            // show() can throw if the ad expired between LOADED
            // and now (the user was idle). Destroy + reject.
            destroyCurrent();
            if (mountedRef.current) {
              setState('error');
            }
            throw new Error('ad expired before show');
          }
        },
      };

      ad.addAdEventListener(AdEventType.CLOSED, () => {
        if (result.onClosed) {
          try {
            result.onClosed();
          } catch {
            // ignore consumer-side errors
          }
        }
      });

      // Forward EARNED_REWARD so the consumer can distinguish
      // "user watched full ad" from "user closed ad mid-watch".
      // AdMob fires EARNED_REWARD right before CLOSED when the user
      // meets the configured reward threshold.
      ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
        if (result.onEarned) {
          try {
            result.onEarned();
          } catch {
            // ignore consumer-side errors
          }
        }
      });

      const unsubLoaded = ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
        unsubLoaded?.();
        resolve(result);
      });

      ad.load();
    });
  }, [adsConfig, destroyCurrent]);

  /** Background-load the next ad. Called on mount, on release(), and
   *  on invalidate(). Idempotent if a load is already inflight. */
  const triggerBackgroundLoad = useCallback(() => {
    if (inflightRef.current) return;
    if (!mountedRef.current) return;
    inflightRef.current = true;
    if (mountedRef.current) {
      setState((s) => (s === 'busy' ? 'busy' : 'loading'));
    }
    loadOne()
      .then((ad) => {
        if (!mountedRef.current) {
          // Provider unmounted mid-load — destroy.
          try {
            ad.show; // no-op; we have no instance to destroy here.
          } catch {
            // ignore
          }
          return;
        }
        adInstanceRef.current = ad;
        setState('ready');
      })
      .catch(() => {
        if (!mountedRef.current) return;
        setState('error');
      })
      .finally(() => {
        inflightRef.current = false;
      });
  }, [loadOne]);

  /** Public API: acquire the ready ad. Returns null if not ready. */
  const acquire = useCallback(
    (adSlot: AdSlotName): AcquiredAd | null => {
      if (adSlot !== defaultSlot()) {
        return null;
      }
      if (state !== 'ready' || !adInstanceRef.current) {
        if (state === 'error' || state === 'uninitialized') {
          triggerBackgroundLoad();
        }
        return null;
      }
      const ad = adInstanceRef.current;
      adInstanceRef.current = null;
      if (mountedRef.current) {
        setState('busy');
      }
      return ad;
    },
    [state, triggerBackgroundLoad],
  );

  /** Public API: called when the modal closes. */
  const release = useCallback(() => {
    // Ad is consumed (single-shot). The modal is gone, the user is
    // back on the reader. Start loading the next one immediately
    // so the next tap is instant.
    destroyCurrent();
    triggerBackgroundLoad();
  }, [destroyCurrent, triggerBackgroundLoad]);

  /** Public API: drop the cached ad and force a fresh load. Use on
   *  app foreground or when the user has been idle > 1 hour. */
  const invalidate = useCallback(() => {
    destroyCurrent();
    triggerBackgroundLoad();
  }, [destroyCurrent, triggerBackgroundLoad]);

  // Lifecycle: init the native SDK once, then start loading.
  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    (async () => {
      const ok = await initializeAdMob();
      if (cancelled) return;
      if (!ok) {
        if (mountedRef.current) setState('error');
        return;
      }
      if (!adsConfig) {
        return;
      }
      triggerBackgroundLoad();
    })();
    return () => {
      cancelled = true;
      mountedRef.current = false;
      destroyCurrent();
    };
    // We intentionally depend only on initializeAdMob's lifecycle.
    // adsConfig changes are handled in the next effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When adsConfig finishes loading, kick off the first load.
  useEffect(() => {
    if (!adsConfig) return;
    if (state === 'uninitialized') {
      triggerBackgroundLoad();
    }
  }, [adsConfig, state, triggerBackgroundLoad]);

  const value = useMemo<AdSlotContextValue>(
    () => ({ state, acquire, release, invalidate }),
    [state, acquire, release, invalidate],
  );

  return <AdSlotContext.Provider value={value}>{children}</AdSlotContext.Provider>;
}

/** Hook used by ad UI components to talk to the slot. */
export function useAdSlot(): AdSlotContextValue {
  const ctx = useContext(AdSlotContext);
  if (!ctx) {
    throw new Error('useAdSlot must be used inside <AdSlotProvider>');
  }
  return ctx;
}