# Command: Phase 2 — Ad Monetization Foundation

**Duration:** Weeks 4–6
**Agents:** Backend + Frontend
**Goal:** Attach real revenue via AdMob with server-side verification. AppLovin MAX is deferred — may switch to another provider later.

---

## Shared Pre-Work
1. Get AdMob account: create app in Firebase Console, get App ID + test ad unit IDs
2. branch `FEATURE_BRANCH=phase-2`
3. Note: Initial launch uses AdMob only. AppLovin is NOT initialized.

---

## Backend Tasks

### Step 1: Ad Infrastructure Tables
- New columns in `ContentCatalog`: `is_sponsored BOOLEAN DEFAULT FALSE`
- New table `ad_placements`:
  ```
  id, location (e.g., 'in_feed', 'interstitial', 'rewarded'), 
  platform ('android' | 'ios'),
  ad_type, priority, primary_provider, fallback_provider, ad_unit_id, enabled
  ```
- New table `ad_events` (renamed from ad_impressions):
  ```
  id, user_id, session_id, ad_type, ad_unit, provider, 
  impression_revenue_usd (FLOAT in micro-USD), watched_fully, 
  reward_granted, transaction_id (UNIQUE), created_at,
  revenue_usd, fx_rate_used, user_points_credited, credit_status
  ```
  - `credit_status` values: 'credited', 'rejected_low_value', 'duplicate'
  - Ad revenue converted to NGN using live FX rate, then to points
  - User share: 80% of revenue (platform keeps 20%)
  - Conversion: 10 points = ₦1
- New table `app_config`:
  ```
  key (PK), value (TEXT), environment ('dev' | 'prod'), description, updated_at
  -- Store ad unit IDs, point rates, prices here for OTA changes
  ```
- New table `ai_provider_health`:
  ```
  provider_name (PK), consecutive_failures, last_failure_at, 
  circuit_open_until, updated_at
  ```

### Step 2: SSV Webhook Endpoints (AdMob)
- `GET /api/v1/study/ads/complete` (AdMob Server-Side Verification — AdMob uses GET in practice). *As planned in June 2026 this said `GET /api/v1/ads/google/callback`; the shipped route lives under the study router.*
  - Verify ECDSA P-256 signature using AdMob's published public keys
  - Signed data is raw query string up to `&signature=`, preserving original parameter order
  - Signature is base64url without standard padding
  - The caller's IP must reverse-resolve to a Google-owned domain
  - Parse payload: `transaction_id`, `user_id` (from custom data), `reward_amount`, `revenue_usd`
  - Check `transaction_id` unique constraint (idempotency)
  - If not exists and `reward_amount > 0`:
    - Credit `settings.rewarded_ad_payout_points` (16) — **service credit, never cashable**
    - Create `AdEvent` with `credit_status='credited'`
  - Return 200 OK immediately (AdMob retries on failure)
- Note: AppLovin SSV deferred to a later phase — **still not built**

### Step 3: Content Feed Rotation
- `GET /api/v1/content/feed/:user_id`:
  - Query `content_catalog` with `feed_sponsored_every` rotation (default every 4th item)
  - Sponsored entries marked `is_sponsored=true`
  - Track `user_id` + `session_id` to avoid showing same sponsored content twice

### Step 4: Ad Request Token & Event Logging
- `POST /api/v1/ads/request-token` (replaces old `/ads/impression` + `/ads/reward-claim`):
  - Returns one-time token + `custom_data` for AdMob
  - Client passes `custom_data` to AdMob rewarded ad request
- Legacy `/ads/impression`, `/ads/reward-claim`, `/ads/credit` now return 410 Gone

### Step 5: Testing
- Unit tests:
  - SSV webhook idempotency (duplicate transaction_id → no double credit)
  - Ad placement rotation logic
  - Point credit calculation
- Integration: mock AdMob webhook calls with test transaction IDs
- Run migrations + tests in Docker

---

## Frontend Tasks

### Step 1: Install Native Ad Dependencies
```bash
npm install react-native-google-mobile-ads
npx expo prebuild --clean
npx expo run:android  # or expo run:ios
```

**CRITICAL:** Do not use Expo Go. Must build dev-client binary for testing ads.

> **Shipped state: the client side was never built.** `react-native-google-mobile-ads`
> 15.8.0 is in `package.json`, but:
> - **the config plugin is absent from `app.config.js`** — without `androidAppId`/`iosAppId` the native SDK has no application id and **crashes on launch**
> - **no `mobileAds().initialize()` call** anywhere
> - **no ad components** — `src/components/ads/` does not exist
> - **no ad call sites** — the i18n keys (`watch_ad`, `watch_ads_prompt`, `recovery_watch_ad`, `ad_pre_claim`) are defined in every locale but referenced by no screen
>
> The backend SSV endpoint is live and waiting. Steps 2–8 below are the
> remaining work — see `admob.md` §9 for the rollout checklist and
> `.kilo/agent/frontend.md` §6.

### Step 2: App Initialization
- `src/app/_layout.tsx`:
  - Initialize AdMob: `GoogleMobileAds().initialize()`, behind UMP consent where required
  - AppLovin: **not initialized** (deferred — config fields are inert)
- Create `src/shared/lib/ads.ts`:
  - Ad unit IDs from backend `GET /api/v1/ads/config`
  - Wrapper functions: `loadRewardedAd()`, `loadInterstitialAd()`, `loadNativeAd()`

### Step 3: Rewarded Ad Component
- `src/components/ads/RewardedAd.tsx`:
  - Requests ad via backend `POST /api/v1/ads/request-token`
  - Passes `custom_data` to AdMob
  - Polls `GET /api/v1/ads/recent-credits` for confirmation
  - Reward granted only after SSV callback confirms

### Step 4: Interstitial Ad
- `src/components/ads/InterstitialAd.tsx`:
  - Loads at natural breakpoints only — after finishing an exam, leaving the reader, returning to a tab root
  - **Never** mid-exam, mid-lesson, or on app open (AdMob policy prohibits it)
  - Skip after 5s countdown

### Step 5: Native Ad Banner (In-Feed)
- `src/components/ads/NativeAdBanner.tsx`:
  - Renders every 4th item in catalog/reader feed
  - Styles match app typography

### Step 6: Ad Failure Handling
- If ad fails to load:
  - Show fallback placeholder
  - Do not block user flow

### Step 7: Test Ads → Production Ads
- Week 1-2: Use ONLY test ad unit IDs (AdMob: `ca-app-pub-3940256099942544/...`)
- Week 3: Switch to production IDs via `app_config` API
- Verify SSV in staging environment before production

### Step 8: Build + Ship
- Production build: `eas build --platform android --profile production`
- Upload same build to Play Store
- Update listing: "PagePay: Read, Watch & Earn"

---

## DevOps Tasks

### Step 1: Backend Deploy
- Push Docker image to registry (Render auto-deploys)
- Apply migrations manually: production does **not** run `alembic upgrade head` on start — see `RENDER_DEPLOYMENT_GUIDE.md`
- Verify health endpoint

### Step 2: Webhook Exposure
- Ensure backend webhook endpoints are publicly accessible
- Register the webhook URL in the AdMob dashboard:
  `https://pagepay-fff6.onrender.com/api/v1/study/ads/complete`
- Test with curl send of sample payloads

---

## Acceptance Criteria (Phase 2 Complete)
❌ Native ads render in-feed with correct styling — **not built**
❌ Interstitial shows at breakpoints — **not built**
✅ Rewarded ad with server-side verification — **backend only; the client that shows the ad is not built**
✅ Real ad revenue tracking (backend tables + SSV)
✅ Double-earn mechanic (backend credit path)
❌ Play Store update: "PagePay: Read, Watch & Earn" — pending the client pipeline
❌ Rewarded video plays after article complete — **not built**
✅ SSV endpoint credits points — implemented and unit-tested (ECDSA P-256 verification, Google reverse-DNS check, `transaction_id` idempotency)
✅ Ad impression events logged in DB
❌ App builds and runs with the AdMob SDK — the app builds and runs, but the AdMob native module is not configured
❌ Live on Play Store with ad monetization active — ads have never been live
✅ Backend: all Phase 1 tests still pass
❌ E2E: Read article → rewarded video → points in wallet — pending the client
✅ No TODO comments, placeholder strings, or mock data in committed code
