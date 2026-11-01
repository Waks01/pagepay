# Implementation Plan: Fix Infinite Render Loop in useAuthGate

## Problem Analysis

### Root Cause (Confirmed)
The infinite render loop is caused by **unstable dependency references** in the `useAuthGate` hook's `useEffect` calls:

1. **`segments` from `useSegments()`** returns a **new array reference on every render**, even when the actual route segments haven't changed
2. The second `useEffect` has dependency array `[hydrated, router, onboardingCompleted, segments]`
3. Every time the effect runs:
   - It calls `bootstrapCurrentUser()` (which hits `/api/v1/auth/me`)
   - It calls `router.replace()` to navigate
   - Navigation causes a re-render
   - `useSegments()` returns a new array reference
   - The effect detects a "change" and fires again
   - **Infinite loop**

4. The first `useEffect` (setOnUnauthenticated) also depends on `[router, segments]`, contributing to the same instability

### Evidence from Logs
```
LOG  [_layout] Rendering main Stack
LOG  [apiFetch] → GET https://pagepay-fff6.onrender.com/api/v1/auth/me
LOG  [_layout] Rendering main Stack
LOG  [apiFetch] → GET https://pagepay-fff6.onrender.com/api/v1/auth/me
...repeated endlessly
```

The pattern shows:
- Render → API call → Render → API call in a tight loop
- `/api/v1/auth/me` is called by `bootstrapCurrentUser()` inside the effect
- Each render triggers the effect because `segments` is a new array

### Why This Wasn't Caught Earlier
- The bug likely appeared after a recent change to routing logic or after adding the email verification redirect
- It manifests most severely after login or refresh when the auth gate runs its initial bootstrap
- Once `isReady` is set to `true`, the component continues rendering but the effects keep firing

---

## Implementation Plan

### 1. Stabilize the segments dependency

**What:** Convert `segments` array to a stable string representation that only changes when the actual route changes.

**How:** 
- Inside `useAuthGate`, derive a stable `segmentKey` from `segments` using `segments.join('/')` or `segments[0]`
- Since the logic only checks `segments[0]`, use `const inGroup = segments[0] as string | undefined`
- Replace all `segments` references in dependency arrays with this stable value

**Files:** 
- `c:\Users\kenik\OneDrive\Pictures\pagepay\page\src\app\_layout.tsx`

**Changes:**
```typescript
// Before:
const segments = useSegments();
useEffect(() => {
  // ... uses segments[0] ...
}, [hydrated, router, onboardingCompleted, segments]);

// After:
const segments = useSegments();
const currentGroup = segments[0]; // Extract the only value we care about
useEffect(() => {
  // ... uses currentGroup instead of segments[0] ...
}, [hydrated, router, onboardingCompleted, currentGroup]);
```

**Verify:** 
- Run `npm run start` and log in
- Observe logs: should see **one** `[_layout] Rendering main Stack` after auth completes
- Should see **one** `/api/v1/auth/me` call after login (not a loop)
- App should navigate to home screen without repeated renders

---

### 2. Add safeguards to prevent redundant bootstrapCurrentUser calls

**What:** Ensure `bootstrapCurrentUser()` is only called when necessary, not on every render.

**How:**
- The effect already has `if (!hydrated) return;` guard
- Add additional checks:
  - Don't bootstrap if already inside the app and `isReady` is already true
  - Use a ref to track if bootstrap is in-flight to prevent concurrent calls

**Files:**
- `c:\Users\kenik\OneDrive\Pictures\pagepay\page\src\app\_layout.tsx`

**Changes:**
```typescript
function useAuthGate() {
  const router = useRouter();
  const segments = useSegments();
  const currentGroup = segments[0];
  const [isReady, setIsReady] = useState(false);
  const bootstrapInProgress = useRef(false);
  const hydrated = usePreferences((s) => s.hydrated);
  const onboardingCompleted = usePreferences((s) => s.onboardingCompleted);

  useEffect(() => {
    // Register the unauthenticated callback
    setOnUnauthenticated(() => {
      if (currentGroup === "(app)") {
        router.replace("/(auth)/" as Href);
      }
    });
  }, [router, currentGroup]); // Use currentGroup instead of segments

  useEffect(() => {
    if (!hydrated || bootstrapInProgress.current) return;

    bootstrapInProgress.current = true;
    
    (async () => {
      try {
        const token = await getToken();
        const inOnboarding = currentGroup === "(onboarding)";
        const inAuth = currentGroup === "(auth)";
        const inApp = currentGroup === "(app)";

        if (!token) {
          if (!onboardingCompleted && !inOnboarding) {
            router.replace("/(onboarding)/" as Href);
          } else if (onboardingCompleted && !inAuth) {
            router.replace("/(auth)/" as Href);
          }
        } else {
          if (inAuth || inOnboarding) {
            router.replace("/home");
          } else {
            const me = await bootstrapCurrentUser();
            if (me && me.email && me.email_verified === false) {
              router.replace({
                pathname: "/(auth)/verify-email-code",
                params: { email: me.email },
              } as any);
              return;
            }
          }
        }
      } catch (e) {
        console.error("Auth gate failed", e);
      } finally {
        setIsReady(true);
        bootstrapInProgress.current = false;
      }
    })();
  }, [hydrated, router, onboardingCompleted, currentGroup]); // Use currentGroup

  return isReady;
}
```

**Verify:**
- Run `npm run start` and test:
  - Fresh login from auth screen
  - App refresh when already logged in
  - Navigation between tabs (home, catalog, wallet, etc.)
- Check logs: no repeated "Rendering main Stack" or `/api/v1/auth/me` calls
- Verify navigation still works correctly for all auth states

---

### 3. Review and test currentUserStore interaction

**What:** Ensure the `bootstrapCurrentUser()` function isn't inadvertently causing re-renders through store updates.

**How:**
- Review `c:\Users\kenik\OneDrive\Pictures\pagepay\page\src\shared\lib\current-user.ts`
- The `bootstrapCurrentUser()` function already has an idempotency check: `if (state.loaded && state.fetchedAt) return state.user;`
- This should prevent redundant API calls, but only if `loaded` is true
- The issue is the effect is firing before `loaded` becomes true

**Files:**
- No changes needed (current implementation is correct)

**Verify:**
- Confirm that after the first successful bootstrap, subsequent calls return cached user
- Check that store updates don't trigger new renders in `_layout.tsx`

---

## Expected Outcome After Fix

### Log Output (Success Case)
```
LOG  [_layout] Not ready: {"fontsLoaded": true, "hydrated": true, "isReady": false, "splashDismissed": true}
LOG  [_layout] Rendering main Stack
LOG  [apiFetch] → GET https://pagepay-fff6.onrender.com/api/v1/auth/me auth=yes
LOG  [apiFetch] ← 200 https://pagepay-fff6.onrender.com/api/v1/auth/me
LOG  [_layout] Rendering main Stack  // One final render after isReady=true
// ... app continues normally, no more repeated renders
```

### What Should Happen
1. **On login:** Auth gate runs once, fetches user, navigates to home → app renders
2. **On refresh:** Auth gate checks token, bootstraps user (returns cached if loaded) → app renders
3. **On tab switch:** No auth gate re-run, no `/api/v1/auth/me` calls
4. **On 401 from API:** `setOnUnauthenticated` callback fires once, redirects to login

### What Should NOT Happen
- ❌ Repeated "Rendering main Stack" logs
- ❌ Multiple `/api/v1/auth/me` calls in quick succession
- ❌ App feeling sluggish or frozen
- ❌ Battery drain from infinite loop

---

## Testing Checklist

After implementing the fix:

- [ ] Fresh login flow works (auth → home)
- [ ] App refresh when logged in works (stays on current screen)
- [ ] Tab navigation doesn't trigger auth checks
- [ ] Logout redirects to login screen
- [ ] 401 response redirects to login screen
- [ ] Unverified email redirects to verify-email-code screen
- [ ] Onboarding flow works for new users
- [ ] No infinite loops in logs
- [ ] No repeated `/api/v1/auth/me` calls
- [ ] Build completes: `npm run lint` passes (no TypeScript errors)

---

## Files Modified

1. `c:\Users\kenik\OneDrive\Pictures\pagepay\page\src\app\_layout.tsx`
   - Extract `currentGroup = segments[0]` for stable dependency
   - Replace `segments` with `currentGroup` in both useEffect dependency arrays
   - Add `bootstrapInProgress` ref to prevent concurrent bootstrap calls
   - Update effect logic to use `currentGroup` instead of `segments[0]`

---

## Risk Assessment

**Risk Level:** Low
- Changes are localized to one hook in one file
- The fix addresses a clear root cause (unstable dependency)
- Fallback behavior (routing logic) remains unchanged
- No database or API changes required

**Rollback Plan:**
- If the fix introduces navigation issues, revert `_layout.tsx` to previous version
- The auth gate logic itself is sound; only the dependency tracking needs fixing

---

## Notes for Implementation Agent

- This is a **React hooks dependency array stability issue**, not a logic bug
- The core routing logic in `useAuthGate` is correct and should not be changed
- Focus on making dependencies stable, not on rewriting the auth flow
- After fixing, the app should feel immediately faster because the render loop stops
- The `bootstrapCurrentUser()` idempotency check in `current-user.ts` already prevents redundant API calls, but only if the effect stops re-firing
