import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import type { AiProviderHealth } from '@/lib/types';
import { Card, Badge, ShimmerLoader, Container } from '@/shared/components';
import { TopHeader } from '@/shared/components/TopHeader';
import { useLayoutContext } from '@/shared/components/Layout';
import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

export function AiHealthPage() {
  const { onMenuClick } = useLayoutContext();

  const { data: providers, isLoading, error } = useQuery({
    queryKey: ['admin', 'ai', 'health'],
    queryFn: async () => {
      const { data } = await adminApi.get<AiProviderHealth[]>('/admin/ai/health');
      return data;
    },
    staleTime: 30_000,
    refetchInterval: 30_000, // Auto-refresh every 30 seconds
  });

  const getStatusIcon = (provider: AiProviderHealth) => {
    if (provider.circuit_open_until) {
      return <XCircle size={20} className="text-error" />;
    }
    if (provider.consecutive_failures > 0) {
      return <AlertTriangle size={20} className="text-warning" />;
    }
    return <CheckCircle size={20} className="text-success" />;
  };

  const getStatusBadge = (provider: AiProviderHealth) => {
    if (provider.circuit_open_until) {
      return <Badge variant="error">Circuit Open</Badge>;
    }
    if (provider.consecutive_failures > 0) {
      return <Badge variant="warning">Degraded</Badge>;
    }
    return <Badge variant="success">Healthy</Badge>;
  };

  return (
    <>
      <TopHeader
        title="AI Provider Health"
        subtitle="Monitor AI service circuit breaker status"
        onMenuClick={onMenuClick}
      />
      <Container size="lg">
        <Card>
          {isLoading && <div className="p-4 sm:p-6"><ShimmerLoader lines={5} /></div>}
          {error && <div className="p-4 sm:p-6 text-error">Failed to load AI provider health</div>}
          {providers && providers.length === 0 && (
            <div className="p-4 sm:p-6 text-text-muted">No AI providers configured</div>
          )}
          {providers && providers.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border">
                <thead className="bg-bg-muted">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Provider</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Consecutive Failures</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Circuit Status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Circuit Opens Until</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Last Failure</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {providers.map((provider) => (
                    <tr key={provider.provider} className="hover:bg-bg-hover">
                      <td className="px-4 py-3 text-sm text-text-main">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(provider)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-text-main">{provider.provider}</td>
                      <td className="px-4 py-3 text-sm text-text-main">
                        {provider.consecutive_failures === 0 ? (
                          <span className="text-text-muted">0</span>
                        ) : (
                          <span className={provider.consecutive_failures >= 3 ? 'text-error font-semibold' : 'text-warning'}>
                            {provider.consecutive_failures}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-text-main">
                        {getStatusBadge(provider)}
                      </td>
                      <td className="px-4 py-3 text-sm text-text-main">
                        {provider.circuit_open_until ? (
                          <span className="text-error">
                            {new Date(provider.circuit_open_until).toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-text-muted">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-text-main">
                        {provider.last_failure_at ? (
                          new Date(provider.last_failure_at).toLocaleString()
                        ) : (
                          <span className="text-text-muted">Never</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="border-t border-border px-4 py-4 sm:px-6">
            <div className="space-y-2 text-sm text-text-muted">
              <p><strong>Circuit Breaker Logic:</strong> After 3 consecutive failures, the provider circuit opens for 5 minutes.</p>
              <p><strong>Healthy:</strong> No recent failures, provider is available.</p>
              <p><strong>Degraded:</strong> 1-2 consecutive failures, still available but monitored.</p>
              <p><strong>Circuit Open:</strong> 3+ failures, provider temporarily disabled until circuit closes.</p>
            </div>
          </div>
        </Card>
      </Container>
    </>
  );
}
