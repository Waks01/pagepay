import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminApi } from "@/lib/api";
import { Card, ShimmerLoader, Select, StatCard } from "@/shared/components";

type FillRateFunnel = {
  requested: number;
  loaded: number;
  shown: number;
  completed: number;
  failed: number;
  load_rate: number;
  show_rate: number;
  completion_rate: number;
  overall_completion_rate: number;
};

export function FillRateFunnelCard() {
  const [days, setDays] = useState("7");

  const { data: funnel, isLoading } = useQuery({
    queryKey: ["admin", "ads", "fill-rate-funnel", days],
    queryFn: async () => {
      const { data } = await adminApi.get("/admin/ads/fill-rate-funnel", {
        params: { days: parseInt(days) },
      });
      return data as FillRateFunnel;
    },
    staleTime: 60_000,
  });

  return (
    <Card>
      <div className="border-b border-border px-4 py-4 sm:px-6">
        <h3 className="text-sm font-semibold text-text-main">
          Fill Rate Funnel
        </h3>
        <p className="mt-0.5 text-sm text-text-muted">
          Ad request lifecycle: requested → loaded → shown → completed
        </p>
        <div className="mt-3">
          <Select
            label="Time Range"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            options={[
              { value: "1", label: "Today" },
              { value: "7", label: "Last 7 Days" },
              { value: "30", label: "Last 30 Days" },
            ]}
            className="w-48"
          />
        </div>
      </div>

      <div className="p-4 sm:p-6">
        {isLoading && <ShimmerLoader lines={4} />}

        {!isLoading && funnel && (
          <div className="space-y-6">
            {/* Funnel Counts */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <StatCard
                label="Requested"
                value={funnel.requested.toLocaleString()}
              />
              <StatCard label="Loaded" value={funnel.loaded.toLocaleString()} />
              <StatCard label="Shown" value={funnel.shown.toLocaleString()} />
              <StatCard
                label="Completed"
                value={funnel.completed.toLocaleString()}
              />
              <StatCard label="Failed" value={funnel.failed.toLocaleString()} />
            </div>

            {/* Funnel Rates */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard
                label="Load Rate"
                value={`${funnel.load_rate.toFixed(1)}%`}
              />
              <StatCard
                label="Show Rate"
                value={`${funnel.show_rate.toFixed(1)}%`}
              />
              <StatCard
                label="Completion Rate"
                value={`${funnel.completion_rate.toFixed(1)}%`}
              />
              <StatCard
                label="Overall Completion"
                value={`${funnel.overall_completion_rate.toFixed(1)}%`}
              />
            </div>

            {/* Visual Funnel */}
            <div className="space-y-2">
              <div className="relative">
                <div
                  className="h-12 bg-blue-500 rounded flex items-center justify-center text-white font-semibold"
                  style={{ width: "100%" }}
                >
                  Requested: {funnel.requested.toLocaleString()}
                </div>
              </div>
              <div className="relative pl-4">
                <div
                  className="h-12 bg-blue-400 rounded flex items-center justify-center text-white font-semibold"
                  style={{ width: `${funnel.load_rate}%` }}
                >
                  Loaded: {funnel.loaded.toLocaleString()} (
                  {funnel.load_rate.toFixed(1)}%)
                </div>
              </div>
              <div className="relative pl-8">
                <div
                  className="h-12 bg-blue-300 rounded flex items-center justify-center text-white font-semibold"
                  style={{ width: `${funnel.show_rate}%` }}
                >
                  Shown: {funnel.shown.toLocaleString()} (
                  {funnel.show_rate.toFixed(1)}%)
                </div>
              </div>
              <div className="relative pl-12">
                <div
                  className="h-12 bg-green-500 rounded flex items-center justify-center text-white font-semibold"
                  style={{ width: `${funnel.completion_rate}%` }}
                >
                  Completed: {funnel.completed.toLocaleString()} (
                  {funnel.completion_rate.toFixed(1)}%)
                </div>
              </div>
            </div>

            {/* Health Indicators */}
            <div className="p-4 bg-bg-muted rounded">
              <h4 className="text-sm font-semibold text-text-main mb-2">
                Health Indicators
              </h4>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-text-muted">Load Rate:</span>
                  <span
                    className={
                      funnel.load_rate >= 90
                        ? "text-success"
                        : funnel.load_rate >= 70
                          ? "text-warning"
                          : "text-error"
                    }
                  >
                    {funnel.load_rate >= 90
                      ? "✅ Excellent"
                      : funnel.load_rate >= 70
                        ? "⚠️ Fair"
                        : "❌ Poor"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Completion Rate:</span>
                  <span
                    className={
                      funnel.completion_rate >= 90
                        ? "text-success"
                        : funnel.completion_rate >= 70
                          ? "text-warning"
                          : "text-error"
                    }
                  >
                    {funnel.completion_rate >= 90
                      ? "✅ Excellent"
                      : funnel.completion_rate >= 70
                        ? "⚠️ Fair"
                        : "❌ Poor"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {!isLoading && !funnel && (
          <p className="text-text-muted">No fill rate data available</p>
        )}
      </div>
    </Card>
  );
}
