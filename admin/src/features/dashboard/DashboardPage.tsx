import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { adminApi } from "@/lib/api";
import type { DashboardStats, DailyActiveUsers } from "@/lib/types";
import { StatCard, Card } from "@/shared/components/Card";
import { TopHeader } from "@/shared/components/TopHeader";
import { BarChart } from "@/shared/components/BarChart";
import { ShimmerLoader } from "@/shared/components/ShimmerLoader";
import { Container } from "@/shared/components/Container";
import { DateRangePicker, getDateRangeFromPreset } from "@/shared/components";
import type { DateRangePreset } from "@/shared/components";
import { useLayoutContext } from "@/shared/components/Layout";
import { usePlatformConfig } from "@/shared/hooks/use-platform-config";

function formatNgn(kobo: number = 0) {
  return `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatUsd(usd: number = 0) {
  return `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function DashboardPage() {
  const { onMenuClick } = useLayoutContext();

  // Date range state
  const [dateRange, setDateRange] = useState<{
    preset: DateRangePreset;
    startDate?: string;
    endDate?: string;
  }>({ preset: "30d" });

  // TODO: Update backend endpoints to accept start_date and end_date parameters
  const { start, end } = getDateRangeFromPreset(
    dateRange.preset,
    dateRange.startDate,
    dateRange.endDate,
  );

  const {
    data: stats,
    isLoading: statsLoading,
    error: statsError,
  } = useQuery({
    queryKey: ["admin", "dashboard", "stats"],
    queryFn: async () => {
      const { data } = await adminApi.get<DashboardStats>(
        "/admin/dashboard/stats",
      );
      return data;
    },
    staleTime: 60_000,
  });

  const { data: platformConfig } = usePlatformConfig();
  const adPlatformPercent = Math.round(
    (platformConfig?.ad_revenue_platform_percent ?? 0.15) * 100,
  );
  const adUserPercent = Math.round(
    (platformConfig?.ad_revenue_user_percent ?? 0.85) * 100,
  );

  const { data: dau = [], isLoading: dauLoading } = useQuery({
    queryKey: ["admin", "analytics", "dau"],
    queryFn: async () => {
      const { data } = await adminApi.get<DailyActiveUsers[]>(
        "/admin/analytics/dau",
        {
          params: { days: 7 },
        },
      );
      return data;
    },
    staleTime: 60_000,
  });

  return (
    <>
      <TopHeader
        title="Dashboard"
        subtitle="Platform overview and key metrics"
        onMenuClick={onMenuClick}
      />
      <Container size="lg">
        <div className="space-y-6">
          {/* Date Range Picker */}
          <Card>
            <div className="p-4 sm:p-6">
              <DateRangePicker value={dateRange} onChange={setDateRange} />
              <p className="mt-2 text-xs text-text-muted">
                Note: Date range filtering requires backend endpoint updates
              </p>
            </div>
          </Card>

          {statsLoading && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              <ShimmerLoader lines={6} />
            </div>
          )}
          {statsError && (
            <Card className="p-4 text-error">Failed to load dashboard</Card>
          )}
          {stats && (
            <>
              {/* Overview Stats */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                <StatCard
                  label="Total Users"
                  value={stats.total_users.toLocaleString()}
                />
                <StatCard
                  label="Active Today"
                  value={stats.active_users_today.toLocaleString()}
                />
                <StatCard
                  label="Pending Payouts"
                  value={stats.pending_payouts.toLocaleString()}
                />
                <StatCard
                  label="High Fraud Flags"
                  value={stats.high_severity_fraud_flags.toLocaleString()}
                />
              </div>

              {/* Revenue Overview */}
              <Card>
                <div className="border-b border-border px-4 py-4 sm:px-6">
                  <h3 className="text-sm font-semibold text-text-main">
                    Revenue Overview
                  </h3>
                  <p className="mt-0.5 text-sm text-text-muted">
                    Total revenue in USD and NGN
                  </p>
                </div>
                <div className="p-4 sm:p-6">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <StatCard
                      label="Total Revenue (USD)"
                      value={formatUsd(stats.total_revenue_usd ?? 0)}
                    />
                    <StatCard
                      label="Total Revenue (NGN)"
                      value={formatNgn(stats.total_revenue_ngn ?? 0)}
                    />
                    <StatCard
                      label="Platform Earnings"
                      value={formatNgn(stats.platform_earnings_ngn ?? 0)}
                    />
                    <StatCard
                      label="User Earnings"
                      value={formatNgn(stats.user_earnings_ngn ?? 0)}
                    />
                  </div>
                </div>
              </Card>

              {/* Ad Revenue Breakdown */}
              <Card>
                <div className="border-b border-border px-4 py-4 sm:px-6">
                  <h3 className="text-sm font-semibold text-text-main">
                    Ad Revenue (80/20 Split)
                  </h3>
                  <p className="mt-0.5 text-sm text-text-muted">
                    Revenue from AdMob and AppLovin ads
                  </p>
                </div>
                <div className="p-4 sm:p-6">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <StatCard
                      label="Ad Revenue (USD)"
                      value={formatUsd(stats.ad_revenue_usd ?? 0)}
                    />
                    <StatCard
                      label="Ad Revenue (NGN)"
                      value={formatNgn(stats.ad_revenue_ngn ?? 0)}
                    />
                    <StatCard
                      label="Total Points Distributed"
                      value={(
                        stats.total_points_distributed ?? 0
                      ).toLocaleString()}
                    />
                    <StatCard
                      label={`Platform Share (${adPlatformPercent}%)`}
                      value={`${formatUsd(stats.ad_platform_share_usd ?? 0)} / ${formatNgn(stats.ad_platform_share_ngn ?? 0)}`}
                    />
                    <StatCard
                      label={`User Share (${adUserPercent}%)`}
                      value={`${formatUsd(stats.ad_user_share_usd ?? 0)} / ${formatNgn(stats.ad_user_share_ngn ?? 0)}`}
                    />
                  </div>
                </div>
              </Card>

              {/* Premium Revenue */}
              <Card>
                <div className="border-b border-border px-4 py-4 sm:px-6">
                  <h3 className="text-sm font-semibold text-text-main">
                    Premium Subscriptions
                  </h3>
                  <p className="mt-0.5 text-sm text-text-muted">
                    Revenue from premium tier subscriptions
                  </p>
                </div>
                <div className="p-4 sm:p-6">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <StatCard
                      label="Premium Revenue (NGN)"
                      value={formatNgn(stats.premium_revenue_ngn ?? 0)}
                    />
                    <StatCard
                      label="Premium Revenue (USD)"
                      value={formatUsd(stats.premium_revenue_usd ?? 0)}
                    />
                  </div>
                </div>
              </Card>

              {/* Task Revenue */}
              <Card>
                <div className="border-b border-border px-4 py-4 sm:px-6">
                  <h3 className="text-sm font-semibold text-text-main">
                    Task Revenue
                  </h3>
                  <p className="mt-0.5 text-sm text-text-muted">
                    Platform fees and worker payouts from completed tasks
                  </p>
                </div>
                <div className="p-4 sm:p-6">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <StatCard
                      label="Total Task Escrow (NGN)"
                      value={formatNgn(stats.task_revenue_ngn ?? 0)}
                    />
                    <StatCard
                      label="Platform Fee (NGN)"
                      value={formatNgn(stats.task_platform_share_ngn ?? 0)}
                    />
                    <StatCard
                      label="Paid to Workers (NGN)"
                      value={formatNgn(stats.task_worker_share_ngn ?? 0)}
                    />
                  </div>
                </div>
              </Card>

              <Card>
                <div className="border-b border-border px-4 py-4 sm:px-6">
                  <h3 className="text-sm font-semibold text-text-main">
                    Daily Active Users
                  </h3>
                  <p className="mt-0.5 text-sm text-text-muted">Last 7 days</p>
                </div>
                <div className="p-4 sm:p-6">
                  {dauLoading && <ShimmerLoader lines={4} />}
                  {!dauLoading && dau.length > 0 && (
                    <BarChart data={dau} height={300} />
                  )}
                </div>
              </Card>
            </>
          )}
        </div>
      </Container>
    </>
  );
}
