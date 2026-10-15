# AdMob Integration Reference — PagePay

Research compiled from the official Google AdMob / GMA docs (developers.google.com/admob, support.google.com/admob, docs.page/invertase/react-native-google-mobile-ads) as of **October 2026**, plus PagePay's current assets.

> **Why now:** the rewarded-ad pipeline is being restored for the SV/cashable/ad unlock flow. This document is the single reference for how every ad format is configured and integrated, how SSV works end-to-end (including the exact verification algorithm), and how it all maps to PagePay's Expo/React Native stack.

---

## 0. PagePay's current AdMob assets

| Item | Value |
|---|---|
| AdMob App ID (Android/iOS shared publisher) | `ca-app-pub-3898064484524772~6521009021` |
| Native advanced ad unit | `ca-app-pub-3898064484524772/6538723260` |
| Rewarded ad unit (reward: **1 Point**) | `ca-app-pub-3898064484524772/4958048285` |
| Banner ad unit | `ca-app-pub-3898064484524772/7400111898` |
| App ID location | AdMob UI → **Account → App settings** ([how to find](https://support.google.com/admob/answer/7356431)) |

Cross-check these against the [console](https://apps.admob.com) before shipping; the same account must register the app, and each ad unit has per-format settings (frequency capping, mediation, eCPM floor).

---

## 1. The state of the SDK (Oct 2026) — read this before anything else

**The legacy Google Mobile Ads SDK for Android is in maintenance mode.** Every Android ad docs page now opens with:

> Google Mobile Ads SDK is in maintenance mode. For the latest updates and features, migrate and set up **GMA Next-Gen SDK**.

| SDK | Status | Current version | Notes |
|---|---|---|---|
| GMA Next-Gen SDK (Android) | **Current** | `com.google.android.libraries.ads.mobile.sdk:ads-mobile-sdk:1.5.0` | Kotlin 1.9+, init **off the main thread** (ANR risk), 30s adapter init timeout, new Picture-in-Picture format (beta) |
| Mobile Ads SDK Android (legacy) | Maintenance only | `com.google.android.gms:play-services-ads:25.5.0` | New features land in Next-Gen only |
| Mobile Ads SDK iOS | Current | SwiftPM/CocoaPods `Google-Mobile-Ads-SDK` | Xcode 16+, target iOS 13+ |
| UMP SDK (consent) | Current | `com.google.android.ump:user-messaging-platform:4.0.0` | Required for GDPR/US-state compliance |

**What this means for PagePay:** the React Native wrapper (`react-native-google-mobile-ads`, v15.8.0 installed) wraps the **legacy** Android SDK and the current iOS SDK — the mainstream, fully supported path today. Next-Gen is the future (new formats, better init), but the wrapper will migrate you when it's ready. Decision: **stay on the wrapper + legacy Android SDK now**, track Next-Gen migration later. do NOT hand-roll native SDK code in an Expo app.

---

## 2. Installation & initialization

### Android (legacy path — what the RN wrapper uses)

```kotlin
// app/build.gradle
implementation("com.google.android.gms:play-services-ads:25.5.0")
```

1. **App ID in `AndroidManifest.xml`** — required, the SDK **crashes on launch** without it:
   ```xml
   <manifest>
     <application>
       <meta-data
           android:name="com.google.android.gms.ads.APPLICATION_ID"
           android:value="ca-app-pub-3898064484524772~6521009021"/>
     </application>
   </manifest>
   ```
2. **Initialize once, early** — before loading any ad. With mediation on, wait for completion before showing ads:
   ```kotlin
   MobileAds.initialize(this) { initializationStatus ->
       // ready to load ads
   }
   ```
   (Sample apps initialize on a background thread, then load ads on the main thread.)
3. **Permissions**: `AD_ID` permission is merged automatically from SDK 20.4.0+ — don't hand-declare it.
4. **Requirements**: minSdk 24+, compileSdk 35+.

### Android Next-Gen (for reference / future)

```kotlin
// Kotlin + coroutines; initializes off the main thread
val config = InitializationConfig.Builder(applicationContext)
    .setApplicationId("ca-app-pub-xxxxxxxx~yyyyyyyyyy")
    .build()
MobileAds.initialize(applicationContext, config) { status -> }
```
- Adapters have a **30-second initialization timeout** — complete heavy SDK init inside your `Application`, not an Activity.
- Swallows init failures gracefully; `onInitializationFailure` reports them.

### iOS

1. **Install** via Swift Package Manager (recommended, repo `https://github.com/googleads/swift-package-manager-google-mobile-ads.git`) or CocoaPods (`pod 'Google-Mobile-Ads-SDK'`). Manual install needs `GoogleMobileAds.xcframework` + `UserMessagingPlatform.xcframework`, `-ObjC` linker flag, `/usr/lib/swift` runpath.
2. **Info.plist — two keys** (the app ID is also crash-on-launch-required):
   ```xml
   <key>GADApplicationIdentifier</key>
   <string>ca-app-pub-3898064484524772~6521009021</string>
   <key>SKAdNetworkItems</key>
   <array>
     <dict><key>SKAdNetworkIdentifier</key><string>cstr6suwn9.skadnetwork</string></dict>
     <!-- + ~60 third-party buyer IDs from https://developers.google.com/admob/ios/3p-skadnetworks -->
   </array>
   ```
3. **Initialize** before loading ads:
   ```swift
   MobileAds.shared.start()   // completion after SDK + mediation adapters (or 30s)
   ```
4. **Requirements**: Xcode 16+, deploy to iOS 13.0+. **Xcode 27 + CocoaPods pitfall**: Xcode 27 forces a 15.0 deployment target but GMA supports 13.0 — add a `post_install` hook setting `IPHONEOS_DEPLOYMENT_TARGET = '15.0'` for all pod targets, or the build fails.
5. Set request-specific flags (consent/UMP) **before** `start()`.

---

## 3. The six ad formats — configuration & integration

Common lifecycle for all full-screen formats: **load → set callbacks → show at the right moment → null the reference on dismiss/failure**. Full-screen ad references **expire after 1 hour** — clear preloaded caches and reload hourly. All SDK calls on the main thread (legacy).

### 3.1 Banner (`AdView`)
- **Config**: standard sizes only — 320×50 banner, 320×100 large banner, 300×250 MREC (320×480 smart banner *deprecated*). Anchored adaptive (`getCurrentOrientationAnchoredAdaptiveBannerAdSize(context, widthDp)`) picks height 50–90 based on device; inline adaptive for scrollable feeds (`setAdSize()` **before** load; re-request throttle is 15s, so don't expect faster refresh on scroll).
- **Lifecycle**: `loadAd(AdRequest)` → `AdListener` (`onAdClicked`, `onAdClosed`, `onAdFailedToLoad(LoadAdError)`, `onAdImpression`) → `destroy()` on screen teardown (leak otherwise).
- **Refresh**: default every 60s; `pause()`/`resume()` with the screen; also handle rotation.
- **Collapsible banners**: opt-in beta, `loadAd(AdRequest.Builder().setIsDesignedForFamilies(...))`-adjacent flag set at load; back/forward variants via `AdSize`.
- **Test unit**: `ca-app-pub-3940256099942544/9214589741` (Android), same pattern on iOS.

### 3.2 Interstitial
- **When**: natural breaks/transitions — for PagePay: after quiz submission, after finishing a reading session, between material pages. Never mid-task.
- **Lifecycle**: `InterstitialAd.load(...)` with `InterstitialAdLoadCallback` → store reference → `setFullScreenContentCallback(new FullScreenContentCallback(){ onAdDismissedFullScreenContent / onAdFailedToShowFullScreenContent / onAdShowedFullScreenContent / onAdImpression / onAdClicked })` → `show(activity)`.
- **Preloading**: load ahead of the break so showing is zero-latency; **expire after 1 hour** → clear cache and reload hourly.
- **Null the reference on dismiss/failure** so the same ad never shows twice.
- **Test unit**: `ca-app-pub-3940256099942544/1033173712`.

### 3.3 Native (advanced)
- Two delivery modes: **native ads you style yourself** (load `NativeAd`, register asset views in a `NativeAdView`, style to match PagePay's card UI) and **native styles/templates** from the console (or full-screen native).
- Lifecycle: load via `AdLoader` (with `forNativeAd`) → populate headline/body/CTA/media/icon → register into `NativeAdView` → display; destroy when scrolled away.
- Validate layouts with the **native ads validator** in ad inspector before release.
- **Test unit**: `ca-app-pub-3940256099942544/2247696110` (Android), `ca-app-pub-3940256099942544/3986624511` (iOS).
- Mediation note: AppLovin adapter **dropped native + MREC support in older versions but re-added native later** — current 13.6.4.2 supports native.

### 3.4 Rewarded (the PagePay-critical one)
- **Opt-in, user-initiated only** — user explicitly chooses to watch. Never force it mid-flow.
- **Load**: `RewardedAd.load(context, adUnitId, adRequest, RewardedAdLoadCallback)` → keep reference, `setFullScreenContentCallback(...)`.
- **Show**: `rewardedAd.show(activity, rewardItem -> { int amount = rewardItem.getAmount(); String type = rewardItem.getType(); })` via `OnUserEarnedRewardListener`.
- **Callback order**: Google-served ads fire `onUserEarnedReward` **before** `onAdDismissedFullScreenContent`; **with mediation, the third-party network decides** — don't assume the order.
- **Reward values** (`rewardItem.type`/`amount`) come from the **ad unit settings in the AdMob UI** — PagePay's unit is configured as **1 Point** per view. Server-side you must apply the same reward in your own bookkeeping.
- **Expiry**: 1 hour.
- **Test unit**: `ca-app-pub-3940256099942544/5224354917`.

### 3 interstitial
- Opt-in like rewarded, but with an **intro screen** giving the user context before the ad — designed for app transitions (e.g., after finishing a .5 Rewardedmaterial). Same load/show + reward-listener pattern; see the platform page before implementing.
- **Test unit**: `ca-app-pub-3940256099942544/5354046379`.

### 3.6 App open
- Full-screen overlay on the **app loading screen**, shown when users open/return to the app. Load in advance, show only if ready and enough time has passed; reference-invalidate on dismiss. Pair with splash/loading UI, not mid-content.
- **Test unit**: `ca-app-pub-3940256099942544/9257395921`.

---

## 4. Server-Side Verification (SSV) — deep dive

This is the mechanism that makes "watch ad → earn reward" cheat-resistant, and the basis for PagePay's ad-wallet payment option.

### 4.1 What it is
AdMob's servers POST the reward to **your callback URL** when a rewarded ad earns a reward, cryptographically signed. Your server verifies the signature, then credits the user. The client grants the reward immediately (UX); the server is authoritative (fraud control).

AdMob verifies rewarded ads on **both platforms**:
- Android legacy: [developers.google.com/admob/android/ssv](https://developers.google.com/admob/android/ssv)
- iOS: [developers.google.com/admob/ios/ssv](https://developers.google.com/admob/ios/ssv) (same parameters + algorithm)

### 4.2 One-time setup (AdMob UI)
1. On the **rewarded ad unit** → enable **Server-side verification**.
2. Set your **callback URL** (PagePay: `https://pagepay-fff6.onrender.com/api/v1/study/ads/complete` — the route to rebuild).
3. Optionally include user id / custom data from the client.

### 4.3 Client-side integration (before `show()`)
```kotlin
ServerSideVerificationOptions options = new ServerSideVerificationOptions.Builder()
    .setUserId("<your internal user id>")
    .setCustomData("<optional, max 9000 bytes>")
    .build();
rewardedAd.setServerSideVerificationOptions(options);
```
- `user_id` — your own identifier (PagePay user id). **Never reuse the same value across users** — that's how rewards get misattributed.
- `custom_data` — up to 9,000 bytes, **percent-escaped**, set before showing the ad; the value is echoed in the callback. Use it for e.g. `material_id:asset_id` context. Safety best practice: **only integers/floats/booleans** in custom data if you're wary of injection into your own URL.
- `user_id` is **string-only** — numbers/emails are rejected.

### 4.4 The callback (what AdMob sends you)

`GET {your_callback_url}` with query parameters:

| Parameter | Meaning |
|---|---|
| `user_id` | The value you set client-side |
| `custom_data` | The value you set client-side (percent-escaped) |
| `reward_amount` | Reward amount configured on the ad unit |
| `reward_item` | Reward item configured on the ad unit |
| `timestamp` | Milliseconds since epoch of the reward |
| `ad_unit` | AdMob ad unit ID that served the ad |
| `ad_network` | Ad network ID that served the ad |
| `transaction_id` | **Unique per reward** — your dedupe key |
| `signature` | ECDSA signature over the request (see 4.6) |
| `key_id` | Which public key signed it (rotated periodically) |

**`transaction_id` is the idempotency key** — store it; a replayed callback must not double-credit.

### 4.5 Ad source IDs (`ad_network` values)

| Ad source | Value |
|---|---|
| AdMob Network | `5450213213286189855` |
| AppLovin | `1063618907739174004` |
| AppLovin (bidding) | `1328079684332308356` |
| AdColony | `1508173563071386589` |
| Others (Chartboost, Unity, Vungle, ironSource, Meta AN, InMobi, Tapjoy, …) | see the full [ad source ID table](https://developers.google.com/admob/android/ssv#ad_source_ids) in the SSV docs |

> The exact numeric table lives in the SSV docs — copy it into your implementation if you route rewards differently per network. (`ad_network` can also arrive as `ad_network_adtop` in some cases.)

### 4.6 Signature verification (the exact algorithm)
1. **Fetch the public keys**: `https://gstatic.com/admob/reward/verifier-keys.json` → array of `{keyId, PEM/publicKeyBase64, base64}` entries. Keys rotate — **cache ≤ 24h**.
2. **Build the content to verify**: all query parameters **except** `signature` and `key_id` — i.e. take the raw query string, **drop the last two parameters** (they're appended last: `&signature=...&key_id=...`), URL-decode nothing, use the **remaining string's UTF-8 bytes in order**.
3. **Verify ECDSA P-256 (SHA-256, DER-encoded)** with the key selected by `key_id`.
4. **Confirm the origin**: reverse-DNS lookup of the caller IP must be a Google-owned domain.
5. **Respond HTTP 200**. AdMob **retries up to 5 times, once per second** if you don't. Make the handler idempotent (dedupe on `transaction_id`) — you *will* see retries.
6. On verification failure: log, return non-200, **do not credit**.

### 4.7 Best practices (from the docs)
- **Reward client-side immediately**, validate server-side — don't block the user's UI on your server round-trip.
- Use SSV (not client callbacks) as the **authoritative source** for anything valuable.
- Protect currency flows: treat a reward as legitimate only after server verification, and reconcile against `transaction_id`.
- The rewards you grant are your responsibility: configure the ad-unit reward (PagePay: 1 Point) and mirror it in your own ledger.

---

## 5. Test ads & testing safely

**Never serve live ads to yourself** — invalid traffic risks account suspension.

### Canonical test units (identical on Android & iOS)
| Format | Test ad unit |
|---|---|
| App open | `ca-app-pub-3940256099942544/9257395921` |
| Adaptive banner | `ca-app-pub-3940256099942544/9214589741` |
| Interstitial | `ca-app-pub-3940256099942544/1033173712` |
| Rewarded | `ca-app-pub-3940256099942544/5224354917` |
| Rewarded interstitial | `ca-app-pub-3940256099942544/5354046379` |
| Native advanced | `ca-app-pub-3940256099942544/2247696110` (Android) / `.../3986624511` (iOS) |
| Native video | `ca-app-pub-3940256099942544/8263023039` |

### Test devices
```kotlin
MobileAds.setRequestConfiguration(
    RequestConfiguration.Builder().setTestDeviceIds(listOf("HASHED_ID")).build());
```
Hashed ID appears in logcat ("Use new ConsentDebugSettings.Builder().addTestDeviceHashedId(...)" / RequestConfiguration variant). Emulators are test devices by default (UMP ≥ 2.2.0).

### Ad Inspector (your testing cockpit)
- Launch: `MobileAds.openAdInspector(activity, error -> {})` (or gesture/Settings).
- **Single ad source testing** — force just AdMob, just AppLovin (bidding), just AppLovin (waterfall) to verify mediation per network.
- **Test ad units** — load any ad unit with a test request.
- **Verify adapter integrations**, troubleshoot ad units and privacy settings.
- **Disable in production** (`disable_ad_inspector`).

---

## 6. Consent & privacy — UMP SDK

Required if you have users in the EEA/UK/Switzerland (and recommended for US-state laws).

**Flow (Android; iOS equivalent):**
1. Create the privacy message in the AdMob UI (**Privacy & messaging** tab) against your app ID. Message types: GDPR message, US states message, IDFA (iOS).
2. Install: `implementation("com.google.android.ump:user-messaging-platform:4.0.0")`; app ID in the manifest (already there for ads).
3. **Every app launch**:
   ```kotlin
   consentInformation.requestConsentInfoUpdate(activity, params, { /* updated */ }, { error -> })
   UserMessagingPlatform.loadAndShowConsentFormIfRequired(activity) { formError -> /* done */ }
   ```
4. **Privacy options entry point**: if `getPrivacyOptionsRequirementStatus() == REQUIRED`, add a visible UI element that calls `showPrivacyOptionsForm(...)` — the settings screen in PagePay should host this.
5. Only request ads when `canRequestAds()` returns true (it's `false` until the first `requestConsentInfoUpdate` completes; use a boolean to avoid duplicate ad requests).
6. Set any request flags (child-directed etc.) **before** SDK init.

**Testing**: `ConsentDebugSettings` → `addTestDeviceHashedId`, `setDebugGeography(DEBUG_GEOGRAPHY_EEA)` to simulate EEA; `reset()` for first-install simulation (test only, never in production).

**Mediation propagation**: UMP consent flows to adapters, but each network still needs its own signal — e.g. AppLovin GDPR support (adapter ≥ 12.0.0.0) and `AppLovinPrivacySettings.setDoNotSell(true)` for US states, set **before** initializing the GMA SDK.

---

## 7. Mediation — AdMob Mediation + AppLovin (the dual-network plan)

`steering.md` mandates AdMob + AppLovin MAX running together, primary/fallback per placement. AdMob mediation gives you that with AppLovin as an ad source.

### Waterfall vs Bidding (AppLovin specifics)
| | Bidding (recommended) | Waterfall |
|---|---|---|
| Banner | **not supported** | only 320×50 and 728×90 |
| App open | waterfall closed beta | — |
| Interstitial / Rewarded / Native | supported | supported |
| Keys needed | SDK Key | SDK Key + Report Key + Zone ID + Bundle ID |
| eCPM | programmatic | manual eCPM entry (auto-optimized after a few days of data) |

### Setup sequence
1. **AppLovin UI** (Account → Keys): copy **SDK Key** and **Report Key**. Waterfall also needs a **Zone** per ad type (Flat CPM or Optimized by AppLovin). Create one AppLovin zone per AdMob ad unit for best optimization.
2. **app-ads.txt**: implement IAB app-ads.txt (both AdMob + AppLovin entries) — skipping it causes significant revenue loss.
3. **AdMob UI → Mediation tab** → Create/Edit mediation group (format + platform) → attach ad units → **Add ad source**:
   - Bidding: Bidding card → AppLovin → sign the bidding partnership agreement → add mapping → paste **SDK Key**.
   - Waterfall: Waterfall card → AppLovin → enable **Optimize** → enter **Report Key** + eCPM → mapping with Bundle ID + SDK Key + Zone ID.
4. Add **AppLovin Corp.** to the GDPR + US-state ad partners lists (Account Management permission required).
5. **Gradle**:
   ```kotlin
   implementation("com.google.android.gms:play-services-ads:25.5.0")
   implementation("com.google.ads.mediation:applovin:13.6.4.2")   // 9.4.2.0+ for bidding
   ```
   iOS: adapter via CocoaPods/SPM per the [iOS AppLovin guide](https://developers.google.com/admob/ios/mediation/applovin).
6. **Privacy**: GDPR consent propagates from UMP (adapter ≥ 12.0.0.0); `AppLovinPrivacySettings.setDoNotSell(true)` before GMA init for US states.
7. **Child-directed caveat**: AppLovin does not init for child-directed apps; adapter ≥ 13.0.0.1 **auto-disables** AppLovin mediation when you declare child-directed or under-age-of-consent. PagePay is not child-directed — declare that setting accordingly.
8. **Test**: AdMob test device + AppLovin test mode → single ad source testing in ad inspector for both `AppLovin (Bidding)` and `AppLovin (Waterfall)`. **Disable test mode before release.**

### AppLovin adapter error codes (debugging)
`-1009..-1, 204` SDK error · `101` unsupported banner size · `103` null context · `104` empty bid token · `105` multiple ads on same zone · `106` ad not ready · `108` format unsupported · `109` context not Activity · `110` **SDK key missing** · `112` user is a child · `113` ad unit ID missing.

---

## 8. Impression-level ad revenue (LTV)

Turn on in AdMob UI, then each format exposes `OnPaidEventListener` — fires during the ad lifecycle with the impression's monetary value. This is how you measure "reward < ad revenue" (the `steering.md` solvency rule) per user.

```kotlin
ad.onPaidEventListener = OnPaidEventListener { adValue ->
    val valueMicros = adValue.valueMicros        // micros! 5000 = $0.005
    val currency = adValue.currencyCode          // "USD"
    val precision = adValue.precisionType        // PRECISE | ESTIMATED | PUBLISHER_PROVIDED | UNKNOWN
    val adUnit = ad.adUnitId
    val response = ad.responseInfo
    val source = response.loadedAdapterResponseInfo  // adSourceName/Id/instance
    val group = response.responseExtras.getString("mediation_group_name")
}
```

- **`getValueMicros()` is in micro units** — divide by 1,000,000 for currency.
- **Precision**: `PRECISE` = actual paid value; `ESTIMATED` = aggregated estimate (optimized ad sources); `PUBLISHER_PROVIDED` = manual CPM; `UNKNOWN` = LTV pingback without data.
- **Bidding test impressions return `UNKNOWN` + `0`** — expected, not a bug.
- Best practices: set the listener **immediately** on the ad object (before show), and forward to your analytics/backend **immediately** (else you lose callbacks).
- AAP partners: Adjust, AppsFlyer, Singular, Tenjin.
- **PagePay use**: log every impression's micro-value per user; the read-to-earn payout budget per user must stay below this sum — it's the number that tells you whether ad-watching is profitably funding rewards.

---

## 9. Expo / React Native integration (PagePay's stack)

Package: **`react-native-google-mobile-ads`** (now `invertase/react-native-google-mobile-ads`; installed **15.8.0**, current upstream **16.5.0**). Requires a dev-client build — **never runs in Expo Go** (matches the project rule: Expo dev-client from Phase 2 onward).

### Config plugin (`app.config.js`)
```js
export default {
  expo: {
    plugins: [
      [
        "react-native-google-mobile-ads",
        {
          androidAppId: "ca-app-pub-3898064484524772~6521009021",
          iosAppId: "ca-app-pub-3898064484524772~6521009021",
          delayAppMeasurementInit: false,
          optimizeInitialization: false,
          optimizeAdLoading: false,
          userTrackingUsageDescription:
            "This identifier will be used to deliver personalized ads to you.",
          skAdNetworkItems: ["cstr6suwn9.skadnetwork", /* + 3P buyers */],
        },
      ],
    ],
  },
};
```

| Option | Effect |
|---|---|
| `androidAppId` / `iosAppId` | Writes Android `com.google.android.gms.ads.APPLICATION_ID` meta-data and iOS `GADApplicationIdentifier`. **Missing = native SDK crash on launch.** |
| `delayAppMeasurementInit` | Delay measurement init (iOS/Android variants) |
| `optimizeInitialization` | Optimized initialization (beta) |
| `optimizeAdLoading` | Optimized ad loading (beta) |
| `userTrackingUsageDescription` | iOS IDFA prompt copy (App Tracking Transparency) |
| `skAdNetworkItems` | Extra SKAdNetwork IDs beyond the bundled Google list |

**Single source of truth**: put App IDs on the plugin only — no root-level `react-native-google-mobile-ads` JSON block needed; the plugin injects IDs during prebuild (a legacy build-script warning about a missing root `ios_app_id`/`android_app_id` is safe to ignore).

### What the library gives you
- **Every format**: app open, banner (`BannerAd`, `BannerAdSize.ANCHORED_ADAPTIVE_BANNER`), native, interstitial, rewarded, rewarded interstitial — plus Ad Manager, UMP consent and mediation support.
- **React-friendly**: imperative ad classes + `TestIds` constants (e.g. `TestIds.REWARDED`, `TestIds.BANNER`, `TestIds.INTERSTITIAL`) + hooks + preload pools for apps showing many ads.
- With React Native Firebase: set `expo-build-properties` `ios.useFrameworks` (dynamic or static + `forceStaticLinking: ["RNFBApp"]`).
- Version floor policy: upgrade the wrapper deliberately (15.8.0 → 16.x) as its own change with a dev-client rebuild — the wrapper's version tracker will stop working after 60 days either way.

### PagePay rollout checklist
- [ ] Add the config plugin with both App IDs to `app.config.js` (currently **absent** — no ads render without it)
- [ ] Wire `mobileAds()` initialization at app start (`_layout.tsx`), behind UMP consent when required
- [ ] Use `TestIds.*` in dev; swap to the three real units above in release builds
- [ ] Banner placement: study list footer / material detail bottom (`BannerAdSize.ANCHORED_ADAPTIVE_BANNER`)
- [ ] Rewarded placement: the payment chooser's "Watch ad" option on asset + audio unlocks
- [ ] Native: optional feed placement later (needs custom styled card)
- [ ] Rebuild dev client via EAS (`eas build --profile development`) — Expo Go cannot load the native module
- [ ] Rebuild + verify through ad inspector with single ad source testing when AppLovin mediation lands
- [ ] Set `app-ads.txt` + AppLovin partnership before expecting revenue
- [ ] Add impression-level revenue logging (section 8) from day one

---

## 10. Monetization mechanics (for the wallet-reward design)

### Payment thresholds (verified from AdMob Help)
- The AdMob payment cycle is **monthly**; earnings finalize in the first days of the following month.
- **Payment threshold: $100 USD equivalent** — below it, earnings roll over month to month.
- **Verification threshold: $10** — triggers identity verification (mailed PIN, up to 3 weeks) + payment method selection + tax info.
- Payments issue **on/around the 21st**; arrive within ~7 business days. Payment-info changes after the 20th apply to the next cycle.

### How this shapes the reward model
- Ad revenue is *net-30-ish and lumpy* — it is not a same-day funding source for user payouts. SV/cashable spends (already live) and deposits remain the primary in-app currency; ads fund the **margins**, per the read-to-earn design.
- `steering.md`'s solvency rule ("reward < ad revenue per view") needs the impression-level revenue logging (section 8) to be enforceable — wire it before re-enabling ad-funded rewards.
- The SSV callback (section 4) is the authoritative "user watched, credit them" signal; the UI's optimistic reward is UX only.

### Reward amount policy for PagePay
The ad unit grants **1 Point** (≈ ₦0.10 at 10 pts/₦). With `rewarded_ad_payout_points: 20` still in config for the old pipeline, decide the rate deliberately: e.g. 1 impression → 1 Point matches the unit config; a multiplier keyed by tier benefits (`tier_benefits.json` still carries `ad_reward_points` 20–30 and `ad_rewards` multipliers 1.0–1.5×) can graduate premium tiers. Whatever you choose, the SSV-verified server value is what's written to the ledger — never the client's claim.

---

## Appendix — source pages consulted

- Android (legacy) quick start · GMA Next-Gen quick start · iOS quick start
- Banner · Interstitial · Rewarded · (Rewarded interstitial, Native, App open — same lifecycle, platform pages)
- [SSV (Android)](https://developers.google.com/admob/android/ssv) — parameters, ad source IDs, key rotation, ECDSA P-256/SHA-256/DER algorithm, retry policy
- [Enable test ads](https://developers.google.com/admob/android/test-ads) — canonical test ad unit IDs
- [UMP SDK](https://developers.google.com/admob/android/privacy) — consent flow, debug geography
- [AppLovin mediation](https://developers.google.com/admob/android/mediation/applovin) — bidding vs waterfall, keys, banner limits, error codes
- [Impression-level ad revenue](https://developers.google.com/admob/android/impression-level-ad-revenue) — `OnPaidEventListener`, `AdValue`, precision types
- [AppLovin mediation adapter changelog](https://developers.google.com/admob/android/mediation/applovin) — current 13.6.4.2, compatible with GMA 25.4.0 / Next-Gen 1.4.0
- `invertase/react-native-google-mobile-ads` — Expo config plugin options, formats, Firebase interop
- AdMob Help: [payments and transactions](https://support.google.com/admob/answer/2772140) · [payment thresholds](https://support.google.com/admob/answer/2772208) · [getting paid checklist](https://support.google.com/admob/checklist/2998383)
