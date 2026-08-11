# PagePay — Unmatched Route + QueryClient error fix

## Context

After the Paystack in-app browser refactor (commit `47b74a2 refactor paystack`), the dev build shows:

```
WARN  [Layout children]: No route named "premium" exists in nested children:
      ["catalog","community","index","notifications","profile","study","tasks","wallet","wallet/[id]"]
ERROR [Error: No QueryClient set, use QueryClientProvider to set one]
      BuyAirtimeScreen (app\buy-airtime.tsx)
```

Plus the navigation lands on `Unmatched Route. Page could not be found. client://` after splash + login.

The root causes are three independent bugs that surface together:

1. **`premium.tsx` calls `usePaystack()` at the top of the component** — this hook throws if it can't find `<PaystackProvider>` in scope. During the route tree validator's first pass (which runs before the user navigates to that screen), any transient hiccup or HMR artifact can mask the route's registration. Since the paystack refactor, `premium.tsx`'s first-render path is now the only `(tabs)` file that throws on render, and it's the one that gets dropped.

2. **`app/(tabs)/wallet/[id].tsx` is hoisted to `(tabs)/` as a sibling tab** because `app/(tabs)/wallet/` has no `_layout.tsx`. Without a nested layout, expo-router flattens subdirectory routes into the parent. That puts a phantom `wallet/[id]` "tab" alongside the real `wallet` tab, and it pollutes the route list.

3. **`app/buy-airtime.tsx` and `app/beneficiaries.tsx` wrap their JSX in a redundant `<QueryClientProvider>` that sits AFTER the `useQuery` calls at the top of the component.** The root layout already provides the `QueryClient` at line 262 — but the file-local provider is in the wrong place (it covers children rendered by the `return`, not the hook calls that ran before it). When the runtime route tree is corrupted by bugs 1–2, the dev build can render `buy-airtime` in a context where the root provider isn't in scope and the file-local provider is too late, triggering the `No QueryClient set` error.

Outcome: all three bugs are fixed with surgical edits; existing `router.push('/(tabs)/wallet/[id]')` calls keep working; the `(tabs)` children list becomes correct; navigation lands on the tabs instead of `client://`; the `Paystack` upgrade flow still works.

---

## Files to modify

| File | Change |
|---|---|
| `client/app/(tabs)/wallet/_layout.tsx` | **Create** — minimal `<Stack>` so `[id]` becomes a nested detail route, not a hoisted sibling tab |
| `client/app/(tabs)/premium.tsx` | Move `usePaystack()` into a new inner component `PremiumBody` so the module never throws on first render |
| `client/app/buy-airtime.tsx` | Remove redundant `<QueryClientProvider>` JSX wrapper (lines 10, 382, 612) |
| `client/app/beneficiaries.tsx` | Remove redundant `<QueryClientProvider>` JSX wrapper (lines 10, 93, 203) |

`client/app/_layout.tsx` does NOT need an explicit `<Stack.Screen name="(tabs)/premium">` — the parent `<Stack.Screen name="(tabs)">` already covers nested routes. Don't add a redundant registration; if the warning persists after the `premium.tsx` restructure, that's a different problem worth investigating separately.

`client/src/lib/notifications.ts` has a separate bug (`router.push("/(tabs)/home")` at lines 316 and 394 — no such tab) but it's out of scope for this fix.

---

## Fix 1 — Create `client/app/(tabs)/wallet/_layout.tsx`

Why: expo-router v6 flattens routes from subdirectories without their own `_layout.tsx` into the nearest layout. With `app/(tabs)/wallet.tsx` (the tab) AND `app/(tabs)/wallet/[id].tsx` (the detail) but no `app/(tabs)/wallet/_layout.tsx`, the `[id]` route is hoisted to `(tabs)/` as a sibling tab named `wallet/[id]`. That's why the children list shows both.

The fix: a new file with a bare `<Stack>`.

```tsx
// client/app/(tabs)/wallet/_layout.tsx
import { Stack } from 'expo-router';

export default function WalletLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

This causes expo-router to nest `[id]` inside a Stack under the `wallet` tab. `wallet.tsx` stays as the tab; `[id]` becomes the only child of the new Stack. The existing `router.push({ pathname: '/(tabs)/wallet/[id]', params: {...} })` call at `wallet.tsx:432` still works — it's a standard Stack push from a tab into its nested detail view (this is what expo-router v6 documents as the canonical tab → detail pattern).

No call sites need to change. No risk of regression: `wallet.tsx` already manages its own header inline, and `[id].tsx` already manages its own back-button header, so `headerShown: false` at the layout level matches the existing inline headers.

---

## Fix 2 — Restructure `client/app/(tabs)/premium.tsx`

Why: `usePaystack()` is called at the top of `PremiumScreen` (line 41). `usePaystack` → `usePaystackContext` throws if `<PaystackProvider>` is not in scope. The provider IS in scope at runtime (root `_layout.tsx:271`), so this works under steady-state — but if the route module is ever probed or re-mounted in a context where the provider isn't yet attached (HMR, fast-refresh during the splash-to-app handover, transient re-mounts), the first render throws, and expo-router's route validator silently drops the registration. That's why `premium` is missing from the children list.

The fix: move `usePaystack()` into an inner component `PremiumBody` that lives inside `PremiumScreen`. The outer `PremiumScreen` runs all the existing queries (`useQuery` for tiers/subscription), reads translation/theme tokens, and renders the screen shell. The inner `PremiumBody` calls `usePaystack()` and renders the tier list, the upgrade button, and the payment-initiation flow.

Edit `client/app/(tabs)/premium.tsx`:

- **Line 19** — KEEP `import { usePaystack } from "expo-paystack";`. The import is fine; only the call site moves.
- **Line 36** — Rename `export default function PremiumScreen()` to `export default function PremiumScreen()`. Keep as the default export. Inside it, KEEP the existing top-level hooks (`useQuery` calls at lines 107 and 116), the `useState` calls (lines 42–43), the `qc` (line 40), and the handlers `handleSelectTier` and `handleUpgrade` (lines 125–196). The handler `handleUpgrade` references `initializePayment` and `paystackLoading` — those references stay, but instead of coming from a local `const { initializePayment, isLoading: paystackLoading } = usePaystack();` at the top, they come from props passed by `PremiumBody`.
- **Line 41** — DELETE the line `const { initializePayment, isLoading: paystackLoading } = usePaystack();`.
- **Lines 198–493** — The `tiers`/`userTier`/`isPremium` derivations and the entire JSX `return` block move into a new function `PremiumBody` defined BELOW `PremiumScreen`. `PremiumBody` receives everything it needs as props (translation function `t`, `tokens`, `qc`, `tiers`, `userTier`, `isPremium`, `tiersLoading`, `tiersError`, `tierInfoLoading`, `tierInfoError`, `refetchTiers`, `selectedTier`, `setSelectedTier`, `checkingPayment`, `setCheckingPayment`, `handleSelectTier`). Inside `PremiumBody`, ADD `const { initializePayment, isLoading: paystackLoading } = usePaystack();` at the top. `handleUpgrade` either lives in `PremiumScreen` (passing `initializePayment` and `paystackLoading` as props), or is defined inside `PremiumBody`. Easiest: keep `handleUpgrade` in `PremiumScreen`, and have `PremiumScreen` pass a `paystackInitialized` callback that captures both `initializePayment` and `paystackLoading` into the closure — but the cleanest pattern is to put `handleUpgrade` inside `PremiumBody` since it depends on those values.

Simplest diff that works (recommended):

```tsx
// Inside PremiumScreen — keep all existing top-level state/queries
export default function PremiumScreen() {
  const { t } = useTranslation();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const qc = useQueryClient();
  const [selectedTier, setSelectedTier] = useState<string>("premium_monthly");
  const [checkingPayment, setCheckingPayment] = useState(false);

  const tiersQ = useQuery({ /* unchanged */ });
  const tierInfoQ = useQuery({ /* unchanged */ });

  const handleSelectTier = (tierId: string) => setSelectedTier(tierId);

  const tiers = tiersQ.data ?? [];
  const userTier = tierInfoQ.data;
  const isPremium = userTier?.is_premium ?? false;

  if (tiersQ.isLoading) { /* unchanged skeleton return */ }
  if (tiersQ.error)    { /* unchanged error return */ }

  return (
    <PremiumBody
      t={t}
      tokens={tokens}
      qc={qc}
      tiers={tiers}
      userTier={userTier}
      isPremium={isPremium}
      tierInfoLoading={tierInfoQ.isLoading}
      tierInfoError={tierInfoQ.error as Error | null}
      refetchTiers={() => tiersQ.refetch()}
      refetchTierInfo={() => tierInfoQ.refetch()}
      selectedTier={selectedTier}
      setSelectedTier={setSelectedTier}
      checkingPayment={checkingPayment}
      setCheckingPayment={setCheckingPayment}
      handleSelectTier={handleSelectTier}
    />
  );
}

// New inner component — owns the Paystack hook
function PremiumBody({
  t, tokens, qc, tiers, userTier, isPremium,
  tierInfoLoading, tierInfoError, refetchTiers, refetchTierInfo,
  selectedTier, setSelectedTier, checkingPayment, setCheckingPayment,
  handleSelectTier,
}: {
  /* full prop types */
}) {
  const { initializePayment, isLoading: paystackLoading } = usePaystack();

  const handleUpgrade = async (tier: string) => {
    // existing handleUpgrade body verbatim — references initializePayment, paystackLoading, etc.
  };

  return (
    <SafeAreaView /* ... full JSX from line 292 onwards, unchanged ... */ />
  );
}
```

The constants `pollSubscriptionStatus` (lines 45–105) and `AMOUNTS` move into `PremiumBody` because they close over `qc`, `initializePayment`, and `paystackLoading`. Keep them as-is; just lift them inside.

Risk: minimal. `usePaystack` is only called when `PremiumBody` mounts — and `PremiumBody` only mounts when `PremiumScreen` reaches the `return` statement (after all the early returns for loading/error). That guarantees the route module always evaluates, the first render never throws, and the hook always finds the provider because the parent `<Stack>` is wrapped in `<PaystackProvider>` at root `_layout.tsx:271`.

---

## Fix 3 — Remove redundant `<QueryClientProvider>` from `buy-airtime.tsx`

Why: the root layout at `client/app/_layout.tsx:262` is the canonical `<QueryClientProvider>`. The file-local wrapper at lines 382/612 is in the wrong place — it's INSIDE the JSX `return`, AFTER the `useQuery` calls at line 83 have already run. React hook order means the file-local provider cannot cover its own component's hooks.

The fix: delete the wrapper, keep the rest.

Edit `client/app/buy-airtime.tsx`:

- **Line 10** — DELETE `import { QueryClientProvider } from '@tanstack/react-query';`
- **Line 382** — DELETE the opening `<QueryClientProvider client={queryClient}>` tag.
- **Line 612** — DELETE the matching closing `</QueryClientProvider>` tag.
- **Line 15** — KEEP `import { queryClient } from '@/src/shared/lib/queryClient';` — it's used by `useMutation` callbacks at line 114 (`queryClient.invalidateQueries`).

After the edit, the `return` block becomes a bare `<View>` (no provider wrapper). React's hook order rules are preserved: hooks run before JSX, root provider is in scope at hook time.

---

## Fix 4 — Remove redundant `<QueryClientProvider>` from `beneficiaries.tsx`

Why: same bug as `buy-airtime.tsx`. Root layout already provides the `QueryClient`.

Edit `client/app/beneficiaries.tsx`:

- **Line 10** — DELETE `import { QueryClientProvider } from '@tanstack/react-query';`
- **Line 93** — DELETE the opening `<QueryClientProvider client={queryClient}>` tag.
- **Line 203** — DELETE the matching closing `</QueryClientProvider>` tag.
- **Line 15** — KEEP `import { queryClient } from '@/src/shared/lib/queryClient';` (used by mutation `onSuccess` callbacks at lines 62 and 77).

---

## Implementation order

1. **Fix 1** (`wallet/_layout.tsx`) — single new file, zero risk. Verifies first because it removes the `wallet/[id]` from the tab list immediately.
2. **Fix 3 + 4** (remove redundant `QueryClientProvider`s) — delete-only edits, no logic change. Removes the `No QueryClient set` error source.
3. **Fix 2** (`premium.tsx` restructure) — most invasive; do it last so any remaining `premium` warning is unambiguous.

After each step, hot-reload and check the dev build log for warnings/errors before continuing.

---

## Verification

After all four fixes:

- [ ] `npm run android` (or the dev build launcher) starts cleanly with no `[Layout children]: No route named "premium"` warning.
- [ ] The `(tabs)` navigator renders the four visible tabs (Home, Catalog, Study, Wallet) plus the More button.
- [ ] Tapping the More button opens the drawer with Notifications, Tasks, Community, Profile, Premium entries.
- [ ] Tapping Premium navigates to the Premium screen without a white flash or Paystack context error.
- [ ] Tapping "Upgrade" on a tier opens the in-app Paystack checkout (this validates that the `PremiumBody` restructure preserved the `initializePayment` flow).
- [ ] In the Wallet tab, tapping any transaction row navigates to the transaction detail screen as a Stack push (horizontal slide-in animation).
- [ ] Back button from the transaction detail returns to the Wallet tab.
- [ ] Navigating to `/buy-airtime` (e.g. via Bills → Airtime) does NOT log `No QueryClient set`. The `useQuery` for `airtime-networks` resolves and the network picker renders.
- [ ] Navigating to `/beneficiaries` (e.g. via the chips on the Airtime form) does NOT log `No QueryClient set`. The beneficiaries list renders.
- [ ] `npx tsc --noEmit` passes — no new type errors introduced by the restructure.
- [ ] `npm run lint` passes — no new lint errors.

---

## Critical files

- `client/app/(tabs)/wallet/_layout.tsx` (new, 4 lines)
- `client/app/(tabs)/premium.tsx` (modify — extract inner `PremiumBody`, move `usePaystack()` call)
- `client/app/buy-airtime.tsx` (delete `QueryClientProvider` import + wrapper)
- `client/app/beneficiaries.tsx` (delete `QueryClientProvider` import + wrapper)

Reference paths:
- `client/src/shared/lib/queryClient.ts:3` — single shared `queryClient` instance
- `client/app/_layout.tsx:262` — canonical `<QueryClientProvider>` (unchanged)
- `client/app/_layout.tsx:271` — `<PaystackProvider>` wrapping `<Stack>` (unchanged)
- `client/app/(tabs)/_layout.tsx:187` — `<Tabs.Screen name="premium" options={{ href: null }} />` (unchanged; depends on `premium` being registered, which Fix 2 enables)
