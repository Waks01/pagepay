# Frontend Engineer Agent
**Project:** PagePay — Read-to-Earn & AI Study Platform
**Stack:** Expo SDK 54+, React Native 0.83, React 19.2, Expo Router, TypeScript

---

## Mission
Build, maintain, and evolve the PagePay mobile application. Own navigation, UI components, state management, ad SDK integration, and offline resilience. This is a production revenue app — no placeholders, no mock data, no TODOs. Every screen either drives revenue or retains users.

**Current Status:** Deployed with Expo SDK 54, React Native New Architecture, bills/VTU integration complete, wallet funding operational.

## Core Responsibilities

### 1. Project Setup Rules (Expo SDK 54+)
- Using Expo SDK 54 with New Architecture enabled
- Minimum targets: Android API 34+, iOS 15.1+
- Node.js: ^20.x or ^22.x
- Use EAS Build for production binaries — never commit native `ios/` or `android/` folders
- OTA updates via `eas update` (cannot modify native code)
- All native modules configured via `app.json` plugins

### 2. Folder Architecture (Feature-Based)
```
app/
  (auth)/
    _layout.tsx
    LoginForm.tsx
    RegisterForm.tsx
  (tabs)/
    _layout.tsx
    index.tsx
    catalog.tsx
    study.tsx
    wallet.tsx
    profile.tsx
  reader/
    [id].tsx
  pin/
    verify.tsx
    setup.tsx
    change.tsx
  sponsor/
    register.tsx
    kyc.tsx
    dashboard.tsx
    tasks/
      create.tsx
      [id].tsx
  tasks/
    [id].tsx
    [id]/complete.tsx
    profile.tsx
    history.tsx
  billing/
    buy-airtime.tsx
    buy-data.tsx
    buy-electricity.tsx
    buy-tv.tsx
  forgot-password.tsx
  reset-password.tsx
  modal.tsx
src/
  shared/
    api/
      client.ts
    hooks/
      use-biometric-auth.ts
      use-ads-config.ts
      use-effective-scheme.ts
    lib/
      storage.ts
      preferences.ts
      screen-memory.ts
      ads-native.ts
      device-fingerprint.ts
      display-name.ts
      pin-verify-flag.ts
    features/
      study/
        api.ts
        spaced-repetition.ts
        storage.ts
components/
  ads/
    RewardedAd.tsx
    NativeAdBanner.tsx
    InterstitialAd.tsx
    BannerAd.tsx
  SplashOverlay.tsx
  PrimaryButton.tsx
```

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

### 5. TypeScript Rules
- Strict mode enabled in `tsconfig.json`
- All props interfaces explicitly typed
- API responses typed via generated types or manual interfaces
- Use `type` for unions/intersections, `interface` for objects
- Avoid `any`; some legacy areas use `as any` for Expo Router path typing — treat these as known tech debt
- TODO: remove `as any` casts in `_layout.tsx`, `LoginForm.tsx`, `PrimaryButton.tsx`

### 6. Ad Integration (Dual Networks)
**CRITICAL:** Must use `expo-dev-client`, NOT Expo Go.

#### Current implementation:
- AdMob initialized on app launch (`GoogleMobileAds().initialize()`)
- Rewarded, interstitial, native ad components implemented for AdMob
- AppLovin MAX: **deferred.** Not initialized, no adapter code. May switch to another provider later.
- SSV flow: client requests token via `POST /api/v1/ads/request-token`, passes `custom_data` to AdMob, polls `/ads/recent-credits` for confirmation

#### Future work:
- Add AppLovin MAX or alternative provider initialization
- Create `useRewardedAd` abstraction to swap networks without changing screens
- Enforce Expo Go guard (ads silently fail in Expo Go)

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
- Phase 2: Ad components (native, interstitial, rewarded), SSV integration
- Phase 3: Study tab, SOW upload UI, quiz/flashcard UI, ad-gate modals
- Phase 4: Paystack checkout, premium indicators, wallet deposit/withdrawal screens
- Phase 5: Referral share sheet, community feed, streak UI
- Phase 6: Taboola widget, sponsored content UI, region detection UI
- **Phase 7:** Task marketplace screens (browse tasks, submit proof, chat, escrow status)
- **Phase 8:** Bills/VTU screens (airtime, data, electricity, TV with validation, network detection, commission display)

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
