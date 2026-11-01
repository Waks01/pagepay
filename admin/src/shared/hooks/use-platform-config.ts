import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import type { PlatformConfig } from '@/lib/types';

export function usePlatformConfig() {
  return useQuery({
    queryKey: ['admin', 'config', 'platform'],
    queryFn: async () => {
      const { data } = await adminApi.get<PlatformConfig>('/config/platform');
      return data;
    },
    staleTime: 60_000,
  });
}
