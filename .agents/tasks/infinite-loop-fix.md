# Infinite Render Loop Fix - Verification Note

## Root Cause Confirmed

The infinite render loop in `useAuthGate` was caused by **unstable dependency references** in the useEffect hooks:

1. **`segments` from `useSegments()`** returns a new array reference on every render, even when route segments haven't actually changed
2. The main auth effect had `segments` in its dependency array: `[hydrated, router, onboardingCompleted, segments]`
3. This created a feedback loop:
   - Effect runs → calls `bootstrapCurrentUser()` → hits `/api/v1/auth/me`
   - Navigation occurs via `router.replace()`
   - Re-render happens → `useSegments()` returns new array reference
   - Effect detects "change" → fires again → infinite loop

The logs confirmed this with repeated sequences of:
```
LOG  [_layout] Rendering main Stack
LOG  [apiFetch] → GET https://pagepay-fff6.onrender.com/api/v1/auth/me
```

## Changes Applied

### 1. Removed `segments` from dependency arrays
- **Before:** Both useEffect hooks depended on `segments`
- **After:** `segments` removed from both dependency arrays

### 2. Stabilized segments access using refs
- Added `const segmentsRef = useRef(segments);`
- Added sync effect: `useEffect(() => { segmentsRef.current = segments; }, [segments]);`
- All segment reads inside effects now use `segmentsRef.current[0]` instead of `segments[0]`
- This breaks the render→segments-change→effect-fires feedback loop

### 3. Added navigation guard
- Added `const navigatingRef = useRef(false);`
- Guard at start of main auth effect: `if (navigatingRef.current) return;`
- Set `navigatingRef.current = true` before navigation logic
- Reset in finally block with 100ms delay via `setTimeout` to allow navigation to settle
- Prevents concurrent navigation attempts that could compound the loop

### 4. Cleaned dependency arrays
- **setOnUnauthenticated effect:** `[router]` only (removed `segments`)
- **Main auth effect:** `[hydrated, onboardingCompleted]` only (removed `router` and `segments`)
- Note: `router` from expo-router is stable (singleton), but removed from main effect deps since it's used inside and doesn't change

## Why The Loop Is Now Broken

The fix breaks the feedback loop at multiple points:

1. **Segments no longer trigger effects:** The unstable `segments` array reference is no longer in any dependency array, so new array references on re-render don't trigger effects

2. **Segments are read safely:** Using `segmentsRef.current` inside effects reads the current segments value without creating a dependency

3. **Navigation is guarded:** The `navigatingRef` prevents the effect from running multiple times concurrently, even if somehow triggered

4. **Effects only run when needed:** 
   - The main auth effect now only runs when `hydrated` or `onboardingCompleted` changes (legitimate state transitions)
   - Not when navigation occurs or segments change

## Expected Behavior After Fix

- **On login:** Auth gate runs once, fetches user, navigates to home → app renders
- **On refresh:** Auth gate checks token, bootstraps user → app renders (one time)
- **On tab navigation:** No auth gate re-run, no repeated `/api/v1/auth/me` calls
- **Logs should show:** Single "Rendering main Stack" after auth completes, not repeated infinitely

## TypeScript Safety

No TypeScript errors introduced:
- `useRef` is properly typed by inference
- `segmentsRef.current` returns the same type as `segments`
- All existing logic remains intact, only dependency tracking changed
