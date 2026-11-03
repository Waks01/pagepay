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
- `GET /api/v1/ads/google/callback` (AdMob Server-Side Verification — AdMob uses GET in practice):
  - Verify ECDSA P-256 signature using AdMob's published public keys
  - Signed data is raw query string up to `&signature=`, preserving original parameter order
  - Signature is base64url without standard padding
  - Parse payload: `transaction_id`, `user_id` (from custom data), `reward_amount`, `revenue_usd`
  - Check `transaction_id` unique constraint (idempotency)
  - If not exists and `reward_amount > 0`:
    - Credit fixed points based on `settings.rewarded_ad_payout_points * USER_SHARE`
    - Create `AdEvent` with `credit_status='credited'`
  - Return 200 OK immediately (AdMob retries on failure)
- Note: AppLovin SSV deferred to a later phase

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
npx expo install expo-ads-admob
npm install react-native-google-mobile-ads react-native-applovin-max
npm install --save-dev @fumitakayamada/expo-applovin-max
npx expo prebuild --clean
npx expo run:android  # or expo run:ios
```

**CRITICAL:** Do not use Expo Go. Must build dev-client binary for testing ads.

### Step 2: App Initialization
- `app/_layout.tsx`:
  - Initialize AdMob: `GoogleMobileAds().initialize()`
  - AppLovin: **not initialized** (deferred)
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
  - Loads after article complete
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
- Push Docker image to registry (Railway/Render auto-deploys)
- Run `alembic upgrade head` on production DB
- Verify health endpoint

### Step 2: Webhook Exposure
- Ensure backend webhook endpoints are publicly accessible
- Register webhook URLs in AdMob and AppLovin dashboards
- Test with curl send of sample payloads

---

## Acceptance Criteria (Phase 2 Complete)
✅ Native ads render in-feed with correct styling
✅ Interstitial shows after article complete
✅ Rewarded video plays after article complete
✅ SSV endpoint credits points (tested with real test ads via AdMob)
✅ Ad impression events logged in DB
✅ App builds and runs with AdMob SDK (expo-dev-client, not Expo Go)
✅ Live on Play Store with monetization active
✅ Backend: all Phase 1 tests still pass
✅ E2E: Read article → rewarded video → points in wallet
✅ No TODO comments, placeholder strings, or mock data in committed code
