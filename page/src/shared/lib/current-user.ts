/**
 * Current-user store — the single source of truth for the authenticated user.
 *
 * Why a Zustand store instead of per-screen `useQuery`:
 *
 * The previous shape was a `useMe()` hook in every tab (home, catalog,
 * wallet, profile, study, billing). Every tab was firing its own
 * `/api/v1/auth/me` call on mount, hitting the secure-store bridge first
 * to read the token, and showing a loading state until the response came
 * back. The user perceived this as "the app re-checks my auth every time
 * I switch tabs" — which is exactly the friction we want to remove.
 *
 * Auth is established once at app start (see `useAuthGate` in
 * `src/app/_layout.tsx`). Once the user is signed in, their session
 * doesn't change just because they tapped a different tab. The user
 * object should be in memory from the first render of the first screen
 * and never need a network roundtrip again unless the user themselves
 * changes something (balance update, username change, sign-out).
 *
 * This store is hydrated once during the auth gate. Screens read from
 * it with the `useCurrentUser()` hook — a pure memory access, no
 * loading state, no network, no secure-store bridge.
 *
 * Mutation paths (`saveUsername`, `setBiometric`, `clearOnSignOut`) keep
 * the store in sync with the server. Components that need to re-render
 * when the user object changes (e.g. profile screen after a username
 * update) subscribe to the relevant slice via the selector form of
 * `useCurrentUser`.
 *
 * The 5-minute `staleTime` semantic from TanStack Query is replaced
 * here by a manual `refreshUser()` call. The user object rarely
 * changes; explicit refreshes on write paths and after focus-then-idle
 * are more predictable than background refetches.
 */
import { create } from 'zustand';
import { apiFetch } from '@/src/shared/api/client';
import { getToken } from '@/src/shared/lib/storage';
import type { UserMe } from '@/src/shared/types';

type CurrentUserState = {
  user: UserMe | null;
  /** True once we've made at least one attempt to load the user.
   *  Lets screens distinguish "not loaded yet" from "loaded, no user"
   *  (the latter means logged out, never authenticated, or fetch failed
   *  with a 401). */
  loaded: boolean;
  /** Last successful fetch wall-clock (ms since epoch). Used by the
   *  `useFocusRefresh` helper to decide whether to re-fetch. */
  fetchedAt: number | null;

  load: () => Promise<void>;
  /** Re-fetch the user and update the store. Returns the new user or
   *  null if the request failed. Call this after mutations (username
   *  change, payout link, etc.) so dependent screens see the new
   *  value immediately. */
  refresh: () => Promise<UserMe | null>;
  setUser: (u: UserMe | null) => void;
  clear: () => void;
};

export const useCurrentUserStore = create<CurrentUserState>((set) => ({
  user: null,
  loaded: false,
  fetchedAt: null,

  load: async () => {
    // If we've already loaded once, don't repeat the network call —
    // this is the whole point of the store. `refresh()` is the
    // explicit escape hatch.
    set((s) => (s.loaded ? s : { ...s, loaded: true }));
  },

  refresh: async () => {
    const token = await getToken();
    if (!token) {
      set({ user: null, loaded: true, fetchedAt: Date.now() });
      return null;
    }
    try {
      const res = await apiFetch('/api/v1/auth/me');
      if (!res.ok) {
        set({ user: null, loaded: true, fetchedAt: Date.now() });
        return null;
      }
      const user = (await res.json()) as UserMe;
      set({ user, loaded: true, fetchedAt: Date.now() });
      return user;
    } catch {
      // Network error — keep the previous user object so the user
      // doesn't get kicked back to the login screen on a flaky network.
      set({ loaded: true, fetchedAt: Date.now() });
      return null;
    }
  },

  setUser: (user) => set({ user, loaded: true, fetchedAt: Date.now() }),

  clear: () => set({ user: null, loaded: true, fetchedAt: null }),
}));

/**
 * Read the current user from the store. The returned object is
 * stable across renders as long as the user object doesn't change,
 * so this is safe to call in render without causing re-renders
 * for unrelated state changes.
 *
 * `user` will be `null` only when:
 *   - the user is not signed in
 *   - the auth gate hasn't completed the initial fetch yet
 *   - the previous /me call returned 401
 *
 * In practice, by the time any (app)/* screen mounts, the auth gate
 * has populated this store — see `bootstrapCurrentUser` in
 * `src/app/_layout.tsx`.
 */
export function useCurrentUser<T = UserMe | null>(
  selector: (state: CurrentUserState) => T = (s) => s.user as T,
): T {
  return useCurrentUserStore(selector);
}

/**
 * Eagerly hydrate the store on app start. Idempotent — calling twice
 * is a no-op once the user is loaded.
 *
 * Returns the loaded user (or null on failure) so the auth gate can
 * use the result to make its routing decision in the same call.
 */
export async function bootstrapCurrentUser(): Promise<UserMe | null> {
  const state = useCurrentUserStore.getState();
  if (state.loaded && state.fetchedAt) {
    return state.user;
  }
  return useCurrentUserStore.getState().refresh();
}
