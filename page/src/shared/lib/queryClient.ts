import { QueryClient } from '@tanstack/react-query';
import { warmTokenCache } from '@/src/shared/lib/storage';

/**
 * One week. PagePay user state (balance, payout account, username,
 * PIN status) changes infrequently; the server is the source of
 * truth, and a stale balance for 60s is fine. This stops every tab
 * switch from re-fetching the same `/me`, `/payouts/account`, and
 * `/pin/status` payloads just because a screen remounted.
 */
const ONE_MINUTE = 60 * 1000;
const FIVE_MINUTES = 5 * 60 * 1000;
const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Keep fetched data in memory across tab switches and screen
      // remounts. Without this, a `useQuery` in Home that just resolved
      // gets garbage-collected the moment you tap the Catalog tab,
      // and the next time you return to Home it has to refetch
      // (including the getToken() roundtrip we just optimized).
      gcTime: ONE_WEEK,
      // Most data is "fresh for a minute" — tab switches and screen
      // remounts will read from cache instantly instead of refetching.
      staleTime: ONE_MINUTE,
      // Don't auto-retry on the network; we surface errors to the UI
      // and the user can pull-to-refresh. Auto-retry multiplies the
      // slow-network pain that the user is already feeling.
      retry: 0,
      // Don't refetch on every focus event — the screen is the same
      // data the user just saw. Tab switches trigger focus events and
      // were the main source of the "feels slow on every tap" issue.
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
    },
  },
});

// Eagerly start loading the auth token into memory the moment this
// module is imported. The query client is imported by the root layout,
// which is the first thing the app loads, so the token bridge call
// happens in parallel with React mounting the rest of the tree.
// By the time any screen's useQuery fires, getToken() is a memory read.
warmTokenCache();
