import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { adminApi } from "@/lib/api";
import {
  Card,
  Container,
  ShimmerLoader,
  StatCard,
  DateRangePicker,
  getDateRangeFromPreset,
} from "@/shared/components";
import type { DateRangePreset } from "@/shared/components";
import { TopHeader } from "@/shared/components/TopHeader";
import { useLayoutContext } from "@/shared/components/Layout";
import { SsvLogTable } from "./SsvLogTable";
import { EcpmTrendChart } from "./EcpmTrendChart";
import { TopEarnersTable } from "./TopEarnersTable";
import { UnitPerformanceCard } from "./UnitPerformanceCard";
import { SuspiciousUsersTable } from "./SuspiciousUsersTable";
import { FillRateFunnelCard } from "./FillRateFunnelCard";

export function AdDashboardPage() {
  const { onMenuClick } = useLayoutContext();

  // Date range state
  const [dateRange, setDateRange] = useState<{
    preset: DateRangePreset;
    startDate?: string;
    endDate?: string;
  }>({ preset: "30d" });

  // Get actual dates from preset or custom values
  const getActualDates = () => {
    if (dateRange.preset === "custom") {
      return {
        startDate: dateRange.startDate || "",
        endDate: dateRange.endDate || "",
      };
    }
    return getDateRangeFromPreset(dateRange.preset);
  };

  const actualDates = getActualDates();
  const daysCount =
    dateRange.preset === "custom"
      ? Math.ceil(
          (new Date(actualDates.endDate).getTime() -
            new Date(actualDates.startDate).getTime()) /
            (1000 * 60 * 60 * 24),
        )
      : dateRange.preset === "today"
        ? 1
        : parseInt(dateRange.preset.replace("d", ""));

  // Fetch metrics summary (derived from multiple endpoints)
  const { data: topEarners = [], isLoading: earnersLoading } = useQuery({
    queryKey: ["admin", "ads", "top-earners", daysCount],
    queryFn: async () => {
      const { data } = await adminApi.get("/admin/ads/top-earners", {
        params: { days: daysCount, limit: 5 },
      });
      return data;
    },
    staleTime: 60_000,
  });

  const { data: unitPerformance = [], isLoading: unitsLoading } = useQuery({
    queryKey: ["admin", "ads", "unit-performance", daysCount],
    queryFn: async () => {
      const { data } = await adminApi.get("/admin/ads/unit-performance", {
        params: { days: daysCount },
      });
      return data;
    },
    staleTime: 60_000,
  });

  const { data: ecpmTrend = [], isLoading: ecpmLoading } = useQuery({
    queryKey: ["admin", "ads", "ecpm-trending", daysCount],
    queryFn: async () => {
      const { data } = await adminApi.get("/admin/ads/ecpm-trending", {
        params: { days: daysCount },
      });
      return data;
    },
    staleTime: 60_000,
  });

  // Calculate summary stats
  const totalAdsWatched = unitPerformance.reduce(
    (sum, unit) => sum + unit.ads_watched,
    0,
  );
  const totalPointsCredited = unitPerformance.reduce(
    (sum, unit) => sum + unit.total_points,
    0,
  );
  const uniqueUsers = unitPerformance.reduce(
    (sum, unit) => sum + unit.unique_users,
    0,
  );

  // Latest eCPM (most recent day)
  const latestEcpm = ecpmTrend.length > 0 ? ecpmTrend[0].ecpm_ngn : 0;

  return (
    <>
      <TopHeader
        title="Ad Analytics"
        subtitle="AdMob rewarded ad performance, SSV logs, and fraud detection"
        onMenuClick={onMenuClick}
      />
      <Container size="lg">
        <div className="space-y-6">
          {/* Date Range Picker */}
          <Card>
            <div className="p-4 sm:p-6">
              <DateRangePicker value={dateRange} onChange={setDateRange} />
            </div>
          </Card>

          {/* Metrics Overview */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(earnersLoading || unitsLoading) && <ShimmerLoader lines={2} />}
            {!earnersLoading && !unitsLoading && (
              <>
                <StatCard
                  label={`Total Ads (${daysCount}d)`}
                  value={totalAdsWatched.toLocaleString()}
                />
                <StatCard
                  label={`Points Credited (${daysCount}d)`}
                  value={totalPointsCredited.toLocaleString()}
                />
                <StatCard
                  label={`Active Users (${daysCount}d)`}
                  value={uniqueUsers.toLocaleString()}
                />
                <StatCard
                  label="Current eCPM (NGN)"
                  value={`₦${latestEcpm.toFixed(2)}`}
                />
              </>
            )}
          </div>

          {/* eCPM Trending Chart */}
          <Card>
            <div className="border-b border-border px-4 py-4 sm:px-6">
              <h3 className="text-sm font-semibold text-text-main">
                eCPM Trending
              </h3>
              <p className="mt-0.5 text-sm text-text-muted">
                Daily effective CPM over last 30 days
              </p>
            </div>
            <div className="p-4 sm:p-6">
              {ecpmLoading && <ShimmerLoader lines={4} />}
              {!ecpmLoading && ecpmTrend.length > 0 && (
                <EcpmTrendChart data={ecpmTrend} />
              )}
              {!ecpmLoading && ecpmTrend.length === 0 && (
                <p className="text-text-muted">No eCPM data available</p>
              )}
            </div>
          </Card>

          {/* Unit Performance */}
          <UnitPerformanceCard />

          {/* Top Earners */}
          <TopEarnersTable />

          {/* SSV Callback Logs */}
          <SsvLogTable />

          {/* Fill Rate Funnel */}
          <FillRateFunnelCard />

          {/* Suspicious Users */}
          <SuspiciousUsersTable />
        </div>
      </Container>
    </>
  );
}
