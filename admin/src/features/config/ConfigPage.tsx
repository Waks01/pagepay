import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import type { ConfigItem } from '@/lib/types';
import { useState, useEffect } from 'react';
import { Card, Badge, Button, ShimmerLoader, Container, Tooltip } from '@/shared/components';
import { TopHeader } from '@/shared/components/TopHeader';
import { useLayoutContext } from '@/shared/components/Layout';

interface TaskRateEntry {
  key: string;
  label: string;
  baseRateKobo: number;
}

export function ConfigPage() {
  const { onMenuClick } = useLayoutContext();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [taskRates, setTaskRates] = useState<TaskRateEntry[]>([]);
  const [taskRatesLoading, setTaskRatesLoading] = useState(true);
  const [editingRateKey, setEditingRateKey] = useState<string | null>(null);
  const [editRateValue, setEditRateValue] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'config'],
    queryFn: async () => {
      const { data } = await adminApi.get<ConfigItem[]>('/admin/config');
      return data;
    },
    staleTime: 60_000,
  });

  const loadTaskRates = async () => {
    setTaskRatesLoading(true);
    try {
      const { data } = await adminApi.get<{ task_base_rates_kobo: Record<string, number> }>('/admin/config/task-rates');
      const rates = data.task_base_rates_kobo || {};
      setTaskRates(
        Object.entries(rates).map(([key, baseRateKobo]) => ({
          key,
          label: key
            .replace(/_/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase()),
          baseRateKobo,
        }))
      );
    } catch {
      setTaskRates([]);
    } finally {
      setTaskRatesLoading(false);
    }
  };

  useEffect(() => {
    loadTaskRates();
  }, []);

  const updateMutation = useMutation({
    mutationFn: async ({ key, value, description }: { key: string; value: string; description?: string }) => {
      await adminApi.put(`/admin/config/${encodeURIComponent(key)}`, { value, description });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'config'] });
      setEditingKey(null);
      setEditValue('');
      setEditDesc('');
    },
  });

  const updateTaskRatesMutation = useMutation({
    mutationFn: async (rates: Record<string, number>) => {
      await adminApi.put('/admin/config/task-rates', rates);
    },
    onSuccess: () => {
      loadTaskRates();
      setEditingRateKey(null);
      setEditRateValue('');
    },
  });

  const queryClient = useQueryClient();

  const startEdit = (item: ConfigItem) => {
    setEditingKey(item.key);
    setEditValue(item.value);
    setEditDesc(item.description || '');
  };

  const saveEdit = (key: string) => {
    updateMutation.mutate({ key, value: editValue, description: editDesc || undefined });
  };

  const startEditRate = (entry: TaskRateEntry) => {
    setEditingRateKey(entry.key);
    setEditRateValue(String(entry.baseRateKobo));
  };

  const saveEditRate = (key: string) => {
    const value = parseInt(editRateValue, 10);
    if (isNaN(value) || value < 0) return;
    updateTaskRatesMutation.mutate({
      ...Object.fromEntries(taskRates.map((r) => [r.key, r.baseRateKobo])),
      [key]: value,
    });
  };

  return (
    <>
      <TopHeader title="System Configuration" subtitle="Manage app config and OTA settings" onMenuClick={onMenuClick} />
      <Container size="full">
        <Card>
        {isLoading && <div className="p-4 sm:p-6"><ShimmerLoader lines={5} /></div>}
        {error && <div className="p-4 sm:p-6 text-error">Failed to load config</div>}
        {data && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-bg-muted">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Key</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Value</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Environment</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Description</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.map((item) => (
                  <tr key={item.key} className="hover:bg-bg-hover">
                    <td className="px-4 py-3 text-sm font-mono text-text-main">{item.key}</td>
                    <td className="px-4 py-3 text-sm text-text-main">
                      {editingKey === item.key ? (
                        <input value={editValue} onChange={(e) => setEditValue(e.target.value)} className="w-full rounded-lg border border-border bg-bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
                      ) : (
                        item.value
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-text-main"><Badge variant={item.environment === 'prod' ? 'success' : 'info'}>{item.environment}</Badge></td>
                    <td className="px-4 py-3 text-sm text-text-main">
                      {editingKey === item.key ? (
                        <input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} className="w-full rounded-lg border border-border bg-bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
                      ) : (
                        item.description || '-'
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-text-main">
                      {editingKey === item.key ? (
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Tooltip content="Save changes" position="top">
                            <Button size="sm" onClick={() => saveEdit(item.key)}>Save</Button>
                          </Tooltip>
                          <Tooltip content="Cancel editing" position="top">
                            <Button size="sm" variant="secondary" onClick={() => setEditingKey(null)}>Cancel</Button>
                          </Tooltip>
                        </div>
                      ) : (
                        <Tooltip content="Edit this config value" position="top">
                          <Button size="sm" variant="secondary" onClick={() => startEdit(item)}>Edit</Button>
                        </Tooltip>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-8">
        <Card>
          <div className="p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-text-main mb-1">Task Base Rates</h2>
            <p className="text-sm text-text-muted mb-4">Platform-controlled minimum rewards in kobo. Changes take effect immediately for new tasks.</p>
            {taskRatesLoading && <ShimmerLoader lines={3} />}
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border">
                <thead className="bg-bg-muted">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Task Type</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Min Reward (kobo)</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Min Reward (₦)</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {taskRates.map((entry) => (
                    <tr key={entry.key} className="hover:bg-bg-hover">
                      <td className="px-4 py-3 text-sm font-mono text-text-main">{entry.label}</td>
                      <td className="px-4 py-3 text-sm text-text-main">
                        {editingRateKey === entry.key ? (
                          <input
                            type="number"
                            value={editRateValue}
                            onChange={(e) => setEditRateValue(e.target.value)}
                            className="w-32 rounded-lg border border-border bg-bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                          />
                        ) : (
                          entry.baseRateKobo.toLocaleString()
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-text-main">₦{(entry.baseRateKobo / 100).toFixed(2)}</td>
                      <td className="px-4 py-3 text-sm text-text-main">
                        {editingRateKey === entry.key ? (
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <Tooltip content="Save changes" position="top">
                              <Button size="sm" onClick={() => saveEditRate(entry.key)} disabled={updateTaskRatesMutation.isPending}>
                                {updateTaskRatesMutation.isPending ? 'Saving...' : 'Save'}
                              </Button>
                            </Tooltip>
                            <Tooltip content="Cancel editing" position="top">
                              <Button size="sm" variant="secondary" onClick={() => setEditingRateKey(null)}>Cancel</Button>
                            </Tooltip>
                          </div>
                        ) : (
                          <Tooltip content="Edit this rate" position="top">
                            <Button size="sm" variant="secondary" onClick={() => startEditRate(entry)}>Edit</Button>
                          </Tooltip>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!taskRatesLoading && taskRates.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-sm text-center text-text-muted">No task rates configured.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      </div>
      </Container>
    </>
  );
}
