import { useQuery } from '@tanstack/react-query';

import { apiFetch } from '@/src/shared/api/client';

const PLATFORM_CONFIG_QUERY_KEY = ['config', 'platform'] as const;

async function fetchPlatformConfig() {
  const res = await apiFetch('/api/v1/config/platform');
  if (!res.ok) throw new Error('Failed to load platform config');
  return (await res.json()) as Record<string, unknown>;
}

export function usePlatformConfig() {
  return useQuery({
    queryKey: [...PLATFORM_CONFIG_QUERY_KEY],
    queryFn: fetchPlatformConfig,
    staleTime: 60 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}
