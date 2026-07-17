import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminApi } from "@/lib/api";
import { Card, ShimmerLoader, Select, StatCard } from "@/shared/components";

type UnitPerformance = {
  ad_unit: string;
  ads_watched: number;
  total_points: number;
  unique_users: number;
  avg_points_per_ad: number;
};

export function UnitPerformanceCard() {
  const [days, setDays] = useState("7");

  const { data: units = [], isLoading } = useQuery({
    queryKey: ["admin", "ads", "unit-performance", days],
    queryFn: async () => {
      const { data } = await adminApi.get("/admin/ads/unit-performance", {
        params: { days: parseInt(days) },
      });
      return data as UnitPerformance[];
    },
    staleTime: 60_000,
  });

  return (
    <Card>
      <div className="border-b border-border px-4 py-4 sm:px-6">
        <h3 className="text-sm font-semibold text-text-main">
          Ad Unit Performance
        </h3>
        <p className="mt-0.5 text-sm text-text-muted">
          Performance breakdown by ad unit
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

        {!isLoading && units.length > 0 && (
          <div className="space-y-6">
            {units.map((unit) => (
              <div
                key={unit.ad_unit}
                className="border-b border-border pb-4 last:border-0"
              >
                <h4 className="text-sm font-semibold text-text-main mb-3">
                  {unit.ad_unit}
                </h4>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <StatCard
                    label="Ads Watched"
                    value={unit.ads_watched.toLocaleString()}
                  />
                  <StatCard
                    label="Points Credited"
                    value={unit.total_points.toLocaleString()}
                  />
                  <StatCard
                    label="Unique Users"
                    value={unit.unique_users.toLocaleString()}
                  />
                  <StatCard
                    label="Avg Points/Ad"
                    value={unit.avg_points_per_ad.toFixed(1)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {!isLoading && units.length === 0 && (
          <p className="text-text-muted">
            No ad unit performance data available
          </p>
        )}
      </div>
    </Card>
  );
}
