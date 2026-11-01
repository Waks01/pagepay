# Token Persistence Fix

## Issues Found

### 1. **Auth Gate Race Condition** (`page/src/app/_layout.tsx`)

**Problem:** The `hasRouted` ref was preventing the auth gate from re-checking tokens after app refresh. Once set to `true`, the auth check would never run again, even if the user refreshed the app.

**Impact:** After app refresh, users with valid tokens would sometimes land on the login screen instead of staying authenticated.

**Fix:** Removed the `hasRouted` ref and made the auth gate re-run whenever relevant state changes (`hydrated`, `onboardingCompleted`, `segments`). The gate now properly checks token validity on every mount and route change.

---

### 2. **Premature Token Clearing** (`page/src/shared/api/client.ts`)

**Problem:** When any API call returned 401 and token refresh failed or was already in progress, the code would immediately call `clearToken()` and log the user out, **even if the original access token was still valid**.

**Scenario:**

1. User has a valid 7-day access token
2. Network glitch or server issue causes a 401
3. `refreshAccessToken()` returns `false` (refresh token missing or already refreshing)
4. Code calls `clearToken()` and destroys a perfectly valid session
5. User gets logged out unexpectedly

**Impact:** Users were getting logged out on every app refresh because:

- The refresh token might not be loaded yet from secure store
- Or the refresh was already in progress from another concurrent request
- The code treated "refresh failed" as "invalid token" and cleared everything

**Fix:** Removed the `clearToken()` calls from the retry logic. Now, `clearToken()` is only called inside `refreshAccessToken()` when the refresh endpoint explicitly returns 401 (indicating the refresh token itself is invalid). This prevents clearing valid access tokens due to network issues or race conditions.

---

### 3. **Missing Unauthenticated Callback** (`page/src/app/_layout.tsx`)

**Problem:** The `_onUnauthenticated` callback was never registered, so when `apiFetch` encountered a real 401 and called `_onUnauthenticated?.()`, nothing would happen. Users wouldn't be redirected to login on actual auth failures.

**Fix:** Added `setOnUnauthenticated()` registration in the auth gate. Now when a real 401 occurs (after refresh attempt), users in the `(app)` section are properly redirected to `/(auth)/`.

---

## Changes Made

### `page/src/app/_layout.tsx`

```typescript
// BEFORE:
function useAuthGate() {
  const hasRouted = useRef(false);

  useEffect(() => {
    if (!hydrated || hasRouted.current) return;
    hasRouted.current = true; // ← BLOCKS re-runs
    // ... auth logic
  }, [hydrated, router, onboardingCompleted]); // ← missing segments
}

// AFTER:
function useAuthGate() {
  // Removed hasRouted ref entirely

  // Register unauthenticated callback
  useEffect(() => {
    setOnUnauthenticated(() => {
      if (segments[0] === "(app)") {
        router.replace("/(auth)/");
      }
    });
  }, [router, segments]);

  useEffect(() => {
    if (!hydrated) return;
    // ... auth logic (now runs on every relevant state change)
  }, [hydrated, router, onboardingCompleted, segments]); // ← added segments
}
```

### `page/src/shared/api/client.ts`

```typescript
// BEFORE:
if (res.status === 401 && path !== "/api/v1/auth/refresh") {
  const refreshed = await refreshAccessToken();
  if (refreshed) {
    // retry with new token
  } else {
    if (path !== "/api/v1/auth/me") {
      await clearToken(); // ← CLEARS VALID TOKENS!
    }
    throw new Error("Unauthorized");
  }
}

// AFTER:
if (res.status === 401 && path !== "/api/v1/auth/refresh") {
  const refreshed = await refreshAccessToken();
  if (refreshed) {
    // retry with new token
  } else {
    // Tokens are already cleared by refreshAccessToken if invalid
    _onUnauthenticated?.();
    throw new Error("Unauthorized");
  }
}
```

---

## How Token Persistence Now Works

1. **On App Start:**
   - `warmTokenCache()` loads tokens from secure store into memory
   - Auth gate checks for token presence
   - If token exists → bootstrap user data and navigate to `/home`
   - If no token → redirect to onboarding or login

2. **On API Calls:**
   - `apiFetch()` uses in-memory cached token (fast)
   - If 401 received → attempt token refresh
   - If refresh succeeds → retry request with new token
   - If refresh fails → token was truly invalid, user gets redirected to login
   - Valid tokens are **never cleared** due to network issues

3. **On App Refresh:**
   - Auth gate re-runs (no more `hasRouted` blocking)
   - Token is read from cache (or secure store if needed)
   - User stays logged in if token is valid

4. **On Real Logout:**
   - Explicit logout action calls `clearToken()`
   - Or backend returns 401 on refresh endpoint (invalid refresh token)

---

## Expected Behavior After Fix

✅ **App refresh preserves authentication** (token doesn't get cleared)  
✅ **Valid 7-day tokens persist across app restarts**  
✅ **Users only see login screen when tokens are actually expired or invalid**  
✅ **Network glitches don't log users out**  
✅ **Real 401 errors (expired tokens) properly redirect to login**

---

## Testing Checklist

- [ ] Login, close app, reopen → should stay logged in
- [ ] Login, refresh app (pull-down) → should stay logged in
- [ ] Login, wait 7 days, refresh → should redirect to login
- [ ] Login, airplane mode, refresh → should NOT log out (network error should be surfaced)
- [ ] Login, backend returns 401 (expired token) → should redirect to login
- [ ] Logout button → should clear tokens and redirect to login

---

## Token Expiry Configuration

**Access Token:** 7 days (10080 minutes)  
**Refresh Token:** 30 days

Configured in `backend/app/config.py`:

```python
access_token_expire_minutes: int = 10080  # 7 days
```

Refresh tokens are rotated on each refresh (single-use). Old refresh token is revoked, new one is issued.
