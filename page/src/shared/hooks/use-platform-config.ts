import { useQuery } from '@tanstack/react-query';

import {
  PLATFORM_CONFIG_QUERY_KEY,
  fetchPlatformConfig,
} from '@/src/shared/lib/ads';

export function usePlatformConfig() {
  return useQuery({
    queryKey: [...PLATFORM_CONFIG_QUERY_KEY],
    queryFn: fetchPlatformConfig,
    staleTime: 60 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}
