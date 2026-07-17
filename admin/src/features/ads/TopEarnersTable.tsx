import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminApi } from "@/lib/api";
import { Card, ShimmerLoader, Select, Button } from "@/shared/components";
import { Download } from "lucide-react";
import { exportToCsv } from "@/shared/utils/exportCsv";

type TopEarner = {
  user_id: number;
  email: string;
  ads_watched: number;
  total_points: number;
  total_ngn: number;
};

export function TopEarnersTable() {
  const [days, setDays] = useState("7");

  const { data: earners = [], isLoading } = useQuery({
    queryKey: ["admin", "ads", "top-earners", days],
    queryFn: async () => {
      const { data } = await adminApi.get("/admin/ads/top-earners", {
        params: { days: parseInt(days), limit: 20 },
      });
      return data as TopEarner[];
    },
    staleTime: 60_000,
  });

  return (
    <Card>
      <div className="border-b border-border px-4 py-4 sm:px-6">
        <h3 className="text-sm font-semibold text-text-main">Top Earners</h3>
        <p className="mt-0.5 text-sm text-text-muted">
          Users with highest ad rewards
        </p>
        <div className="mt-3 flex flex-wrap gap-3 items-end">
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
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (earners.length > 0) {
                exportToCsv(
                  earners.map((e, idx) => ({
                    rank: idx + 1,
                    user_id: e.user_id,
                    email: e.email,
                    ads_watched: e.ads_watched,
                    total_points: e.total_points,
                    ngn_value: e.total_ngn.toFixed(2),
                  })),
                  "top_earners",
                );
              }
            }}
            disabled={!earners || earners.length === 0}
          >
            <Download size={16} className="mr-1" />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        {isLoading && (
          <div className="p-4 sm:p-6">
            <ShimmerLoader lines={5} />
          </div>
        )}

        {!isLoading && earners.length > 0 && (
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-bg-muted">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Rank
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                  User ID
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Email
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Ads Watched
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Points Earned
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                  NGN Value
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {earners.map((earner, index) => (
                <tr key={earner.user_id} className="hover:bg-bg-hover">
                  <td className="px-4 py-3 text-sm font-semibold text-text-main">
                    #{index + 1}
                  </td>
                  <td className="px-4 py-3 text-sm text-text-main">
                    {earner.user_id}
                  </td>
                  <td className="px-4 py-3 text-sm text-text-main">
                    {earner.email}
                  </td>
                  <td className="px-4 py-3 text-sm text-text-main">
                    {earner.ads_watched.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-text-main">
                    {earner.total_points.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-text-main">
                    ₦{earner.total_ngn.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!isLoading && earners.length === 0 && (
          <div className="p-4 sm:p-6 text-text-muted">
            No top earners data available for the selected period
          </div>
        )}
      </div>
    </Card>
  );
}
