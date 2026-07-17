/**
 * React Query hook around the ads config fetch.
 *
 * Wraps `fetchAdsConfig` from `src/shared/lib/ads` so every
 * caller (catalog in-feed ad, wallet interstitial, reader
 * rewarded gate) gets the same cache entry and the same
 * 5-minute freshness window. The hook returns the same shape
 * as `useQuery` — `data`, `isLoading`, `isError`, `refetch` —
 * so the call sites can show skeletons/spinners the same way
 * they do for the catalog and wallet queries.
 *
 * The 1h stale time is intentional: ops rarely rotates unit
 * IDs more than once per release, and a stale config just
 * shows test IDs for a few minutes after a hot fix. We do
 * NOT auto-refresh in the background because every refresh
 * hits the unauthenticated `/api/v1/config/ads` endpoint and
 * we don't want to burn the rate limit for no reason.
 */

import { useQuery } from '@tanstack/react-query';

import {
  ADS_CONFIG_QUERY_KEY,
  AdsConfig,
  fetchAdsConfig,
} from '@/src/shared/lib/ads';


export function useAdsConfig() {
  return useQuery<AdsConfig>({
    queryKey: [...ADS_CONFIG_QUERY_KEY],
    queryFn: fetchAdsConfig,
    // 1 hour — matches the server's slot for OTA-config
    // changes. The catalog/wallet queries are stale at 5
    // minutes; ads config is intentionally longer because
    // unit IDs don't move as often as catalog data.
    staleTime: 60 * 60 * 1000,
    // Keep the previous data visible while refetching so
    // screens that use the config (catalog in-feed ad) don't
    // flicker to a "no ad" state on app foreground.
    placeholderData: (prev) => prev,
  });
}
