# Frontend Engineer Agent
**Project:** PagePay — Read-to-Earn & AI Study Platform
**Stack:** Expo SDK 57, React Native 0.86, React 19.2, Expo Router 57, TypeScript

---

## Mission
Build, maintain, and evolve the PagePay mobile application. Own navigation, UI components, state management, ad SDK integration, and offline resilience. This is a production revenue app — no placeholders, no mock data, no TODOs. Every screen either drives revenue or retains users.

**Current Status:** Expo SDK 57 with React Native New Architecture. Bills/VTU integration complete, wallet funding operational, study (SOW upload, exams, assets, narration) live, task marketplace live. **The AdMob client pipeline is not built** — see §8.

## Core Responsibilities

### 1. Project Setup Rules (Expo SDK 57)
- Expo SDK 57, React Native 0.86, React 19.2, New Architecture enabled
- Minimum targets: Android API 34+, iOS 15.1+
- Node.js: ^20.x or ^22.x
- Use EAS Build for production binaries — never commit native `ios/` or `android/` folders
- OTA updates via `eas update` (cannot modify native code)
- All native modules configured via the `plugins` array in `app.config.js` (not `app.json`)
- `react-native-google-mobile-ads` 15.8.0 is installed but **has no config plugin and no call sites yet** — adding the plugin is what makes the native module safe to import

### 2. Folder Architecture
Routes live under **`src/app/`** (not `app/`). `page/app/` does not exist.

```
src/app/
  _layout.tsx
  (onboarding)/          index.tsx
  (auth)/                index.tsx, LoginForm.tsx, RegisterForm.tsx, verify-email-code.tsx
  (app)/
    _layout.tsx
    home/                index.tsx, modal.tsx, legal.tsx, fund-wallet.tsx, payment-history.tsx,
                         bills-history.tsx, transactions.tsx, transaction-detail.tsx, beneficiaries.tsx,
                         buy-airtime.tsx, buy-data.tsx, buy-electricity.tsx, buy-tv.tsx,
                         buy-isp.tsx, buy-sms.tsx, buy-betting.tsx, buy-recharge-pin.tsx,
                         buy-education.tsx, read/[id].tsx, pin/{verify,setup,change}.tsx,
                         forgot-password.tsx, forgot-password-otp.tsx, reset-password.tsx,
                         subscription/success.tsx, sponsor/{register,kyc,dashboard}.tsx,
                         sponsor/tasks/{create,[id]}.tsx
    catalog/             index.tsx
    reader/[id].tsx
    book/[id].tsx
    study/               index.tsx, [id].tsx, [id]/{reader,podcast,file-viewer}.tsx,
                         exam-mode.tsx, exam/[id].tsx, exam-history.tsx, srs-dashboard.tsx, chat/[id].tsx
    tasks/               index.tsx, [id].tsx, [id]/complete.tsx, profile.tsx, history.tsx
    community/           index.tsx
    wallet/              index.tsx
    profile/             index.tsx
    premium/             index.tsx
    rewards/             daily.tsx
    notification/        index.tsx, [id].tsx
  billing/               subscription.tsx, history.tsx
  fund-wallet/           success.tsx
src/
  shared/
    api/                 client.ts
    constants/  hooks/  lib/  types/  utils/
  features/
    study/  tasks/  payments/  rewards/  community/  sponsor/  works/
components/
  ui/  reader/  study/  transactions/  skeletons/  animations/  onboarding/
```
There is **no `components/ads/` directory** — the ad components described in older versions of this file were never written.

### 3. State Management
- Server state: TanStack Query v5 (`@tanstack/react-query`)
  - Cache feed, wallet balance, study materials
  - Background refetch on window focus
  - Optimistic updates for point gains
- Client state: Zustand (1KB, no Provider wrapper needed)
  - Theme (light/dark)
  - Current reading progress
  - Ad loading state
- Persistent state: `expo-secure-store` for auth tokens and route memory
  - Preferences (theme, language, biometric toggle, onboarding flag) via custom `usePreferences` store backed by `expo-secure-store`
  - Never use `AsyncStorage` for sensitive data
- Simple local state: `useState` / `useReducer`

### 4. Navigation (Expo Router)
- File-based routing in `app/` directory
- Tab navigator inside `(tabs)/_layout.tsx`
- Stack navigator for nested flows (reader, paywall, tasks, sponsor)
- Deep links auto-configured: `pagepay://reader/42`
- Use `useRouter()` and `useLocalSearchParams()` for navigation
- Route persistence: last meaningful screen is saved to `expo-secure-store` and restored after auth gates (see `src/shared/lib/screen-memory.ts`)

### 4a. The Study Reader and the PodcastThe study screen has two ideas that must not be conflated.

- **"My material"** shows the student's own upload, page for page, at full fidelity. The images come from `GET /materials/{id}/page-images` (object storage) and are loaded with `expo-image`. Nothing is re-rendered on the phone.
- **"Explained"** shows the teaching layer — the material rewritten for a beginner, with every diagram rendered inline from `GET /materials/{id}/figures` and its description underneath.

- `app/(app)/study/[id]/reader.tsx` — the two-mode reader. `ContentBlock` gained `figure` and `recap`. A block type the screen does not know about **renders as body text rather than being dropped**: silently removing a piece of the student's material is the one thing this screen must never do.
- `app/(app)/study/[id]/podcast.tsx` — the podcast. Level picker, topic selection with a live price, the episode list, and the player dock.
- `src/features/study/audio-download.ts` — saving an episode to the phone. iOS goes through `expo-media-library`; Android goes through the Storage Access Framework into Downloads. Neither asks for a broad storage permission.
- **Background audio** needs all three of: the `expo-audio` config plugin with `enableBackgroundPlayback`, `setAudioModeAsync({ shouldPlayInBackground: true, interruptionMode: "doNotMix" })`, and `player.setActiveForLockScreen(true, …)`. Without the third, Android cuts the audio after about three minutes. `requestNotificationPermissionsAsync()` puts the controls in the notification shade.
- Playback position is saved to the server every few seconds so closing the app does not lose the student's place.
- **The "My material" view is a windowed list, not a ScrollView of every page.** A page decoded to a bitmap costs width × height × 4 bytes — about 10 MB for a 1400px render — so mounting twenty pages at once asks for hundreds of megabytes and takes a mid-range phone over its heap. `initialNumToRender={2}`, `maxToRenderPerBatch={2}`, `windowSize={3}` and `removeClippedSubviews` keep only the pages near the screen in memory.

### 4c. Screens Are Not Mounted Before They Are Needed
- **The tab navigator must not set `lazy: false`.** It was there to "preserve query cache across tab switches", but React Query's cache does not depend on a screen being mounted — the data is cached either way. What it did was mount all nine tabs at startup, so nine screens fired their queries at once and nine screens' worth of images and state were live before the student had tapped anything. On a mid-range phone that is what killed the app with a GC timeout.
- A screen that can be restored onto the stack without its parameter — a stale navigation state, a deep link — must check before it requests. `/content/undefined` is a 404 and a screen with nothing to show; step back instead.
- A public config endpoint must not fail because the database is briefly unreachable. Serve the documented fallback.

### 4b. Rendering the Parts That Are Not Prose
A study material contains worked calculations, formulas, code listings, quotes, theorems and tables. Each has a shape of its own, and each is rendered by its own component in `components/study/`.

- **`MathText.tsx`** — renders a LaTeX expression. Two modes: **inline** (a single `<Text>` tree, so it sits inside a line of prose, with fractions written as `a⁄b`) and **display** (a `<View>` tree, with fractions stacked under a rule, roots barred over, exponents raised).
- **`src/shared/lib/latex.ts`** — the parser. It handles `\frac`, `\sqrt` (with an index), superscripts and subscripts, the Greek letters and the operators a syllabus uses, and `\text{…}` for words inside an equation. Anything it does not understand is kept as literal text, so an equation is never silently mangled.
- **`CodeBlock.tsx`** — monospace, the real indentation, line numbers, a horizontal scroll instead of a wrap, and a copy button. Code in the body font with the indentation collapsed is not readable, and a snippet is usually the one thing the student needs to copy exactly.
- **`RichText.tsx`** — prose with inline mathematics. Splits a line on `$…$` and renders the pieces. A dollar sign that is not wrapping mathematics is left alone, so "it costs $5 and $10" does not become an equation.
- **`SpecialBlockCard.tsx`** — the card for every other block type, including the two new ones: `statement` (a theorem or a rule, with its label) and `definition` (a term and its meaning).

**Why no WebView maths engine.** A KaTeX WebView would typeset integrals and matrices more beautifully, but it needs the network on every formula, it cannot sit inside a line of prose, and it is slow on the cheap Android phones this app runs on. The pure-React renderer typesets the subset school material actually uses, works offline, and never breaks a line of prose.

### 5. TypeScript Rules
- Strict mode enabled in `tsconfig.json`
- All props interfaces explicitly typed
- API responses typed via generated types or manual interfaces
- Use `type` for unions/intersections, `interface` for objects
- Avoid `any`; some legacy areas use `as any` for Expo Router path typing — treat these as known tech debt
- TODO: remove `as any` casts in `_layout.tsx`, `LoginForm.tsx`, `PrimaryButton.tsx`

### 6. Ad Integration (AdMob only)
**CRITICAL:** Must use `expo-dev-client`, NOT Expo Go.

#### Actual state: the client pipeline is NOT built
- `react-native-google-mobile-ads` 15.8.0 is in `package.json`, but:
  - **the config plugin is absent from `app.config.js`** — without `androidAppId`/`iosAppId` the native SDK has no application id and **crashes on launch**
  - **no `GoogleMobileAds().initialize()` call** anywhere
  - **no ad components** — no `RewardedAd`, `BannerAd`, `InterstitialAd`, or native ad component exists
  - **no ad call sites** — the orphaned i18n keys (`watch_ad`, `watch_ads_prompt`, `recovery_watch_ad`, `ad_pre_claim`) are defined in every locale but referenced by no screen
- The **backend is ready**: `GET /api/v1/study/ads/complete` performs full AdMob SSV verification (ECDSA P-256, Google reverse-DNS, `transaction_id` idempotency) and credits the user. Only the client is missing.
- AppLovin is **not implemented** — `applovin_sdk_key` is an inert config field.

#### What building it requires
1. Add the config plugin to `app.config.js` with both App IDs — `ca-app-pub-3898064484524772~6521009021` (shared publisher). Without this the app crashes.
2. Call `mobileAds().initialize()` at app start in `src/app/_layout.tsx`, behind UMP consent where required.
3. Use `TestIds.*` in dev; swap to the real units in release builds. Never serve live ads to yourself — invalid traffic risks account suspension.
4. Rewarded placement: the payment chooser's "Watch ad" option on asset + audio unlocks, with the SSV token request and `custom_data`.
5. Banner placement: study list footer / material detail bottom.
6. Interstitials at **natural breakpoints only** — after finishing an exam, leaving the reader, returning to a tab root. Never mid-exam, never mid-lesson, never on app open (AdMob policy prohibits it).
7. Log impression-level revenue (`onPaidEvent` micros) per user — the solvency rule "reward < ad revenue per view" is unenforceable without it.
8. Rebuild the dev client via EAS. Expo Go cannot load the native module.

### 7. Anti-Cheat Client Logic
- `expo-app-state` to detect background/foreground transitions
- Pause reading timer if `appState === 'background'`
- Send heartbeat to backend every 10s: `POST /api/v1/session/heartbeat`
  - Payload: `{ scroll_events: number, app_state: string }`
- NOTE: >100px/30s scroll threshold and "Read Check" modal every 5 articles are NOT implemented. Current approach: 1-minute read slices with 5k character chunks. Do not re-add these checks without explicit request.

### 8. UI/UX Standards
- Design system: consistent spacing (8px grid), border radius (8-16px)
- Typography: SpaceGrotesk font family (not Inter). Weights: 500/700 used; system font for body text.
- Colors: brand purple (`PagePay.mint` ≈ green for earnings; theme tokens defined in `useEffectiveScheme`)
- Dark mode: full support, persisted in `expo-secure-store` via `usePreferences`
- Loading states: skeleton screens or spinners on all async actions
- Error states: retry buttons, friendly messages
- Empty states: illustrations + clear CTA

### 9. Performance Rules
- NOTE: `FlashList` is NOT currently used. Home/catalog use `ScrollView` + mapped `View`s; wallet uses `FlatList`. Consider migrating long feeds to `@shopify/flash-list`.
- NOTE: `expo-image` is NOT currently installed. Standard `<Image>` is used everywhere. Migration to `expo-image` with caching + blurhash is pending.
- Memoize components with `React.memo` and `useMemo`
- Avoid inline functions in render props
- Bundle size: monitor with `npx expo-optimize`
- OTA updates: test via EAS Update channels (`preview` before `production`)

### 10. Testing & Quality
- Unit: Jest + React Native Testing Library
- Lint: ESLint with Expo plugin
- Format: Prettier
- Pre-commit hooks: Husky + lint-staged
- NOTE: Detox E2E is planned but not yet implemented

## Deliverables per Phase
- Phase 1: Auth screens, catalog, reader, wallet, anti-cheat
- Phase 2: Ad components (native, interstitial, rewarded), SSV integration — **backend SSV shipped; the client side is still outstanding**
- Phase 3: Study tab, SOW upload UI, quiz/flashcard UI, ad-gate modals
- Phase 4: Paystack checkout, premium indicators, wallet deposit/withdrawal screens
- Phase 5: Referral share sheet, community feed, streak UI
- Phase 6: Taboola widget, sponsored content UI, region detection UI
- **Phase 7:** Task marketplace screens (browse tasks, submit proof, chat, escrow status)
- **Phase 8:** Bills/VTU screens (airtime, data, electricity, TV with validation, network detection, commission display)
- **Phase 9:** Paid-tier screens, metered chat, per-user cost visibility

## Hard Boundaries
- Do not write backend code (API routes, DB models) in this project — those are backend agent's responsibility
- Do not modify `ios/` or `android/` folders directly — use config plugins
- Do not use Expo Go for development with ads — must use `expo-dev-client` builds
- API URL is currently inline in `client.ts`; TODO: create `src/shared/lib/constants.ts`
- **Development:** `console.*` statements are present in many screens for active debugging; they must be `__DEV__`-guarded or removed before production release
- **Test Gate:** Every phase blocked until:
  1. `npx tsc --noEmit` passes (zero type errors)
  2. `npx eslint .` passes (zero errors)
  3. `npx jest --coverage` passes with 80%+ on new code
  4. App builds with EAS and installs on a real device without crashes
- **Revenue-first mindset:** Every screen is either a revenue event (ad shown, ad watched, points earned, premium purchased) or a retention funnel (content consumption, study engagement). If a screen does neither, remove it.
