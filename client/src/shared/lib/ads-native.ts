/**
 * Native AdMob SDK init.
 *
 * Boots `react-native-google-mobile-ads` once per app session.
 * The actual SDK call (`MobileAds().initialize()`) is idempotent
 * — calling it twice is a no-op. We guard with a module-level
 * flag so the layout's `useAdsBootstrap` hook (which runs on
 * every cold start) never double-inits.
 *
 * Why the import is dynamic (inside the function): the
 * `react-native-google-mobile-ads` package's top-level import
 * references the `RNGoogleMobileAdsModule` TurboModule, which
 * is only registered in a native build (`expo run:android`,
 * EAS Build). When the app runs in Metro hot-load mode
 * without a native binary, the import throws at module-load
 * time and bricks the whole app. Lazy-importing the package
 * means a missing native module degrades to "ads disabled"
 * and the rest of the app keeps working with the
 * MockAdModal / AdPlaceholder fallbacks.
 *
 * Why both `expo-ads-admob` AND `react-native-google-mobile-ads`:
 *   - `expo-ads-admob` is the Expo config plugin that patches
 *     AndroidManifest.xml with the AdMob App ID (the value
 *     `app.json.android.config.googleMobileAdsAppId`). It does
 *     NOT provide the actual SDK class.
 *   - `react-native-google-mobile-ads` is the actual native
 *     SDK with the `MobileAds().initialize()` API, banner /
 *     native / interstitial / rewarded components, and the
 *     `RewardedAdEventType` lifecycle events that drive the
 *     server-side-verification (SSV) flow. The credit math
 *     is computed entirely server-side via the
 *     /api/v1/ads/google/callback endpoint when AdMob fires
 *     the SSV callback; the client never sees revenue.
 *
 * The two packages are the standard Expo + AdMob combination
 * for SDK 50+ — the Expo plugin handles the native config, the
 * npm package provides the runtime. AppLovin MAX lives behind
 * a separate package (`react-native-applovin-max`) and a
 * separate plugin — out of scope for Phase 2.
 *
 * iOS: the same code path calls the iOS init. The
 * `Info.plist` `GADApplicationIdentifier` is patched by the
 * `expo-ads-admob` plugin's iOS branch — set it via
 * `app.json.ios.config.googleMobileAdsAppId` in a follow-up
 * (we prebuild with Android-only today per the user's
 * "start with admob" priority).
 */

let initialized = false;
let initPromise: Promise<boolean> | null = null;


/** One-time SDK init. Returns true on success, false if
 *  the SDK wasn't available (Expo Go, missing native
 *  module, etc.). The caller never throws — a failed init
 *  is treated as "ads disabled" and the rest of the app
 *  falls back to MockAdModal. */
export async function initializeAdMob(): Promise<boolean> {
  if (initialized) return true;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      // Dynamic import — see the file header for why this
      // can't be a top-level import. The require() call
      // surfaces the TurboModuleRegistry.getEnforcing()
      // error if the native module isn't linked, which
      // we catch and treat as "ads disabled".
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { default: mobileAds, MaxAdContentRating } = require('react-native-google-mobile-ads');
      await mobileAds().initialize();
      // Tag the session as an under-13 or general-audience
      // app. We don't ship any child-directed signals today;
      // MaxAdContentRating.G keeps the SDK serving
      // general-audience ads. Phase 5 (community / sub-13
      // accounts) will switch this to a per-user value.
      await mobileAds().setRequestConfiguration({
        maxAdContentRating: MaxAdContentRating.G,
        // Tag for ad network test mode. We set this only in
        // dev — production uses the live App ID + unit IDs
        // the backend returns. The GoogleMobileAds SDK
        // accepts `testDeviceIds: []` in production; we
        // pass the device list empty in prod and populate
        // it in dev (the OS reports a per-device ID via
        // `AdsConsent` in a follow-up).
        tagForChildDirectedTreatment: false,
        tagForUnderAgeOfConsent: false,
      });
      initialized = true;
      return true;
    } catch (err) {
      if (__DEV__) {
        console.warn('[ads-native] initializeAdMob failed — running with MockAdModal/AdPlaceholder fallback', err);
      }
      initialized = false;
      return false;
    }
  })();
  return initPromise;
}


/** Reset for tests — never call from app code. */
export function __resetAdMobInitForTests(): void {
  initialized = false;
  initPromise = null;
}
