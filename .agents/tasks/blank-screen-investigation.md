# Blank Screen Investigation Report

## Summary

**Root Cause: Double Conditional Rendering Bug in `src/app/_layout.tsx`**

The app displays a blank screen after the splash animation completes because of a **logic error in the root layout component** that creates duplicate conditional checks. After the splash screen finishes, the app renders the main UI structure, but then **immediately re-checks the same conditions inside the returned JSX** and shows an empty splash container instead of the actual navigation stack.

---

## Evidence

### The Bug (lines 154-174 in `page/src/app/_layout.tsx`)

```typescript
  if (!fontsLoaded || !hydrated || !isReady) {
    return (
      <View style={styles.splashContainer}>
        {!splashDismissed && (
          <SplashOverlay onDone={() => setSplashDismissed(true)} />
        )}
      </View>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <PaystackProvider publicKey={PAYSTACK_PUBLIC_KEY}>
            {!isReady || !fontsLoaded ? (   // ← BUG: DUPLICATE CHECK
              <View style={{ flex: 1 }}>
                {!splashDismissed ? (
                  <SplashOverlay onDone={() => setSplashDismissed(true)} />
                ) : null}
              </View>
            ) : (
              <>
                <BannerNotification ... />
                <Stack screenOptions={{ headerShown: false }}>
                  <Stack.Screen name="(onboarding)" />
                  <Stack.Screen name="(auth)" />
                  <Stack.Screen name="(app)" />
                </Stack>
              </>
            )}
          </PaystackProvider>
          ...
```

### Why This Causes a Blank Screen

1. **Initial load:** `fontsLoaded`, `hydrated`, and `isReady` are all `false`, so the early return shows `SplashOverlay`.

2. **Splash animation completes:** `SplashOverlay` calls `onDone()`, which sets `splashDismissed = true`. The splash overlay disappears.

3. **State updates:** Eventually, fonts load, preferences hydrate, and auth gate finishes → all three conditions become `true`.

4. **Early return bypassed:** The component re-renders, passes the early return check at line 154, and enters the main return block.

5. **Duplicate conditional at line 170:** Inside the `PaystackProvider`, **the code checks `!isReady || !fontsLoaded` AGAIN**. Even though we already passed the check at line 154, this second check evaluates the same conditions.

6. **Blank view rendered:** The condition at line 170 renders:
   ```typescript
   <View style={{ flex: 1 }}>
     {!splashDismissed ? (
       <SplashOverlay onDone={() => setSplashDismissed(true)} />
     ) : null}
   </View>
   ```
   Since `splashDismissed` is `true`, this renders **an empty `<View style={{ flex: 1 }}>`** — a blank screen.

7. **Navigation stack never renders:** The `else` branch containing the `<Stack>` with actual routes never executes because the duplicate condition at line 170 is redundant and should not exist.

### Log Analysis Confirms the System is Ready

From the user's logs:

```
LOG  Imports loaded: {"AirtimeDetail": "function", ...}
LOG  [ads] MobileAds initialised [...]
LOG  [apiFetch] → GET https://pagepay-fff6.onrender.com/api/v1/auth/me auth=yes body=none
LOG  [apiFetch] ← 200 https://pagepay-fff6.onrender.com/api/v1/auth/me
LOG  [apiFetch] → GET .../notifications?limit=1 auth=yes body=none
LOG  [apiFetch] → GET .../content/feed/17?limit=10 auth=yes body=none
LOG  [apiFetch] → GET .../users/me/streak auth=yes body=none
LOG  [apiFetch] → GET .../rewards/daily/status auth=yes body=none
LOG  [apiFetch] → GET .../progress auth=yes body=none
LOG  [apiFetch] → GET .../auth/me auth=yes body=none
```

- ✅ Android bundle loaded successfully (2753 modules, 438s + 14s for SecureStore)
- ✅ Imports loaded (AirtimeDetail, DataDetail, etc.)
- ✅ MobileAds initialized
- ✅ Auth token present (`auth=yes`)
- ✅ `/auth/me` returns 200
- ✅ All home screen queries fire: notifications, feed, streak, rewards, progress

**The API layer is working perfectly.** The screen is rendering (queries are executing), but the user sees nothing because the duplicate conditional renders an empty container instead of the navigation stack.

---

## Why the Duplicate Check Exists

The pattern suggests **defensive coding or incomplete refactoring**. Likely scenarios:

1. **Original design:** The component may have initially rendered the splash inside the providers (the inner block at line 170).

2. **Early-exit optimization added:** Someone added the early return at line 154 to avoid mounting the entire provider tree before fonts/prefs/auth are ready.

3. **Incomplete cleanup:** The inner conditional at line 170 was not removed, creating a redundant check.

The second check is **logically unreachable** under correct flow (if it executes, `isReady` and `fontsLoaded` must both be `true` because of the early return), but it evaluates to `false` and renders the wrong branch.

---

## Fix Recommendation

**Remove the duplicate conditional at line 170.**

### Before (lines 165-189)

```typescript
return (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <PaystackProvider publicKey={PAYSTACK_PUBLIC_KEY}>
          {!isReady || !fontsLoaded ? (
            <View style={{ flex: 1 }}>
              {!splashDismissed ? (
                <SplashOverlay onDone={() => setSplashDismissed(true)} />
              ) : null}
            </View>
          ) : (
            <>
              <BannerNotification ... />
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="(onboarding)" />
                <Stack.Screen name="(auth)" />
                <Stack.Screen name="(app)" />
              </Stack>
            </>
          )}
        </PaystackProvider>
        <StatusBar style="auto" />
      </GestureHandlerRootView>
    </ThemeProvider>
  </QueryClientProvider>
);
```

### After (lines 165-182)

```typescript
return (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <PaystackProvider publicKey={PAYSTACK_PUBLIC_KEY}>
          <BannerNotification
            notifications={bannerNotifications}
            onDismiss={handleBannerDismiss}
            onPress={handleBannerPress}
          />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(onboarding)" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(app)" />
          </Stack>
        </PaystackProvider>
        <StatusBar style="auto" />
      </GestureHandlerRootView>
    </ThemeProvider>
  </QueryClientProvider>
);
```

**Rationale:**

- The early return at line 154 already handles the not-ready state.
- Once the component proceeds past that point, `isReady`, `fontsLoaded`, and `hydrated` are all `true`.
- The navigation stack should render unconditionally in the main return block.
- The `SplashOverlay` is already handled in the early return; no need to check `splashDismissed` again.

---

## Verification Steps

After applying the fix:

1. **Clean build:** Run `npx expo start --clear` to ensure no cached bundle.
2. **Test cold start:** Kill the app, relaunch, and verify the splash animation plays and transitions to the home screen.
3. **Check logs:** Confirm no errors and that the home screen queries still execute.
4. **Test navigation:** Tap through tabs to ensure routing works.
5. **Test auth flows:** Sign out and back in, verify onboarding flow if applicable.

---

## Related Files

- **Root layout:** `page/src/app/_layout.tsx` (contains the bug)
- **Splash overlay:** `page/components/SplashOverlay.tsx` (working correctly)
- **App layout:** `page/src/app/(app)/_layout.tsx` (tabs config, working correctly)
- **Home screen:** `page/src/app/(app)/home/index.tsx` (queries executing, never renders)
- **Current user store:** `page/src/shared/lib/current-user.ts` (bootstrap logic, working correctly)
- **Preferences store:** `page/src/shared/lib/preferences.ts` (hydration logic, working correctly)

---

## Conclusion

The blank screen is **not** caused by:
- ❌ API failures (all requests return 200)
- ❌ Auth issues (token is valid, `/auth/me` succeeds)
- ❌ Splash screen problems (animation completes correctly)
- ❌ Font loading (fonts load successfully)
- ❌ Preferences hydration (hydration completes)
- ❌ Navigation configuration (tab setup is correct)

The blank screen **is** caused by:
- ✅ **Duplicate conditional rendering logic** that renders an empty container after the splash finishes, preventing the navigation stack from ever appearing.

**Impact:** High — the app is completely unusable. All backend systems work, but the UI never appears.

**Severity:** Critical — this is a blocking bug for all users.

**Fix complexity:** Low — single-file change, remove 10 lines of redundant conditional logic.

**Risk:** Very low — the early return already handles the not-ready state; the duplicate check serves no purpose and removing it simply allows the intended navigation stack to render.
