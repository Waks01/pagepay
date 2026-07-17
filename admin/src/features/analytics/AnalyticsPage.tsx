import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { adminApi } from "@/lib/api";
import type {
  DailyActiveUsers,
  RetentionCohort,
  ContentPerformanceItem,
} from "@/lib/types";
import {
  Card,
  Container,
  ShimmerLoader,
  BarChart,
  DateRangePicker,
  getDateRangeFromPreset,
} from "@/shared/components";
import type { DateRangePreset } from "@/shared/components";
import { TopHeader } from "@/shared/components/TopHeader";
import { useLayoutContext } from "@/shared/components/Layout";

export function AnalyticsPage() {
  const { onMenuClick } = useLayoutContext();

  // Date range state
  const [dateRange, setDateRange] = useState<{
    preset: DateRangePreset;
    startDate?: string;
    endDate?: string;
  }>({ preset: "30d" });

  // TODO: Update backend endpoints to accept start_date and end_date parameters
  // For now, using hardcoded days parameter
  const { start, end } = getDateRangeFromPreset(
    dateRange.preset,
    dateRange.startDate,
    dateRange.endDate,
  );

  const { data: dau = [], isLoading: dauLoading } = useQuery({
    queryKey: ["admin", "analytics", "dau"],
    queryFn: async () => {
      const { data } = await adminApi.get<DailyActiveUsers[]>(
        "/admin/analytics/dau",
        {
          params: { days: 30 },
        },
      );
      return data;
    },
    staleTime: 60_000,
  });

  const { data: retention = [], isLoading: retentionLoading } = useQuery({
    queryKey: ["admin", "analytics", "retention"],
    queryFn: async () => {
      const { data } = await adminApi.get<RetentionCohort[]>(
        "/admin/analytics/retention",
        {
          params: { days: 30 },
        },
      );
      return data;
    },
    staleTime: 60_000,
  });

  const { data: content = [], isLoading: contentLoading } = useQuery({
    queryKey: ["admin", "analytics", "content"],
    queryFn: async () => {
      const { data } = await adminApi.get<ContentPerformanceItem[]>(
        "/admin/analytics/content-performance",
        {
          params: { limit: 20 },
        },
      );
      return data;
    },
    staleTime: 60_000,
  });

  return (
    <>
      <TopHeader
        title="Analytics"
        subtitle="Platform insights and performance metrics"
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

          {/* Daily Active Users */}
          <Card>
            <div className="border-b border-border px-4 py-4 sm:px-6">
              <h3 className="text-sm font-semibold text-text-main">
                Daily Active Users
              </h3>
              <p className="mt-0.5 text-sm text-text-muted">Last 30 days</p>
            </div>
            <div className="p-4 sm:p-6">
              {dauLoading && <ShimmerLoader lines={4} />}
              {!dauLoading && dau.length > 0 && (
                <BarChart data={dau} height={300} />
              )}
              {!dauLoading && dau.length === 0 && (
                <p className="text-text-muted">No data available</p>
              )}
            </div>
          </Card>

          {/* Retention Cohorts */}
          <Card>
            <div className="border-b border-border px-4 py-4 sm:px-6">
              <h3 className="text-sm font-semibold text-text-main">
                Retention Cohorts
              </h3>
              <p className="mt-0.5 text-sm text-text-muted">
                Day 1 and Day 7 retention by signup date
              </p>
            </div>
            <div className="overflow-x-auto">
              {retentionLoading && (
                <div className="p-4 sm:p-6">
                  <ShimmerLoader lines={5} />
                </div>
              )}
              {!retentionLoading && retention.length > 0 && (
                <table className="min-w-full divide-y divide-border">
                  <thead className="bg-bg-muted">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                        Signup Date
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                        Day 1 Retained
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                        Day 7 Retained
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {retention.map((cohort) => (
                      <tr
                        key={cohort.signup_date}
                        className="hover:bg-bg-hover"
                      >
                        <td className="px-4 py-3 text-sm text-text-main">
                          {cohort.signup_date}
                        </td>
                        <td className="px-4 py-3 text-sm text-text-main">
                          {cohort.day_1}
                        </td>
                        <td className="px-4 py-3 text-sm text-text-main">
                          {cohort.day_7}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {!retentionLoading && retention.length === 0 && (
                <div className="p-4 sm:p-6 text-text-muted">
                  No retention data available
                </div>
              )}
            </div>
          </Card>

          {/* Content Performance */}
          <Card>
            <div className="border-b border-border px-4 py-4 sm:px-6">
              <h3 className="text-sm font-semibold text-text-main">
                Top Content by Engagement
              </h3>
              <p className="mt-0.5 text-sm text-text-muted">
                Most read content
              </p>
            </div>
            <div className="overflow-x-auto">
              {contentLoading && (
                <div className="p-4 sm:p-6">
                  <ShimmerLoader lines={5} />
                </div>
              )}
              {!contentLoading && content.length > 0 && (
                <table className="min-w-full divide-y divide-border">
                  <thead className="bg-bg-muted">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                        ID
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                        Title
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                        Reading Sessions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {content.map((item) => (
                      <tr key={item.content_id} className="hover:bg-bg-hover">
                        <td className="px-4 py-3 text-sm text-text-main">
                          {item.content_id}
                        </td>
                        <td className="px-4 py-3 text-sm text-text-main">
                          {item.title}
                        </td>
                        <td className="px-4 py-3 text-sm text-text-main">
                          {(item.reading_sessions || 0).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {!contentLoading && content.length === 0 && (
                <div className="p-4 sm:p-6 text-text-muted">
                  No content performance data available
                </div>
              )}
            </div>
          </Card>
        </div>
      </Container>
    </>
  );
}
