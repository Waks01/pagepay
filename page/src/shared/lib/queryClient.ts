import { QueryClient } from "@tanstack/react-query";
import { warmTokenCache } from "@/src/shared/lib/storage";

/**
 * One week GC time. One hour staleTime. PagePay user state (balance, payout account, username,
 * PIN status) changes infrequently; the server is the source of
 * truth. This stops every tab switch from re-fetching the same
 * `/me`, `/payouts/account`, and `/pin/status` payloads just because
 * a screen remounted.
 */
const ONE_HOUR = 60 * 60 * 1000;
const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: ONE_WEEK,
      staleTime: ONE_HOUR,
      retry: 0,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      networkMode: "online",
    },
    mutations: {
      retry: 0,
      networkMode: "online",
    },
  },
});

// Eagerly start loading the auth token into memory the moment this
// module is imported. The query client is imported by the root layout,
// which is the first thing the app loads, so the token bridge call
// happens in parallel with React mounting the rest of the tree.
// By the time any screen's useQuery fires, getToken() is a memory read.
warmTokenCache();
