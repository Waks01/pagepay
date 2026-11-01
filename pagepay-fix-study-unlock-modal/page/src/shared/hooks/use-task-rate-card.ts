import { useMemo } from 'react';

import { usePlatformConfig } from '@/src/shared/hooks/use-platform-config';

export type TaskRateEntry = {
  taskType: string;
  label: string;
  baseRateKobo: number;
};

export function useTaskRateCard(platform: string): TaskRateEntry[] {
  const { data: platformConfig } = usePlatformConfig();

  return useMemo(() => {
    if (!platformConfig?.task_base_rates_kobo) return [];

    const prefix = `${platform}_`;
    const entries: TaskRateEntry[] = [];

    for (const [key, baseRateKobo] of Object.entries(platformConfig.task_base_rates_kobo)) {
      if (!key.startsWith(prefix)) continue;

      const taskType = key.slice(prefix.length);
      const label = taskType
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());

      entries.push({ taskType: key, label, baseRateKobo });
    }

    return entries;
  }, [platform, platformConfig?.task_base_rates_kobo]);
}
