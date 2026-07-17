import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminApi } from "@/lib/api";
import { Card, Badge, Button, ShimmerLoader, Input } from "@/shared/components";
import { AlertTriangle, Download } from "lucide-react";
import { exportToCsv } from "@/shared/utils/exportCsv";

type SuspiciousUser = {
  user_id: number;
  email: string;
  status: string;
  ads_watched: number;
  total_points: number;
  first_ad: string;
  last_ad: string;
  hours_active: number;
  ads_per_hour: number;
  risk_level: "yellow" | "orange" | "red";
};

export function SuspiciousUsersTable() {
  const [minAds, setMinAds] = useState("250");
  const [hours, setHours] = useState("24");
  const [shouldFetch, setShouldFetch] = useState(false);

  const {
    data: users = [],
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ["admin", "ads", "suspicious-users", { minAds, hours }],
    queryFn: async () => {
      const { data } = await adminApi.get("/admin/ads/suspicious-users", {
        params: {
          min_ads: parseInt(minAds),
          hours: parseInt(hours),
        },
      });
      return data as SuspiciousUser[];
    },
    enabled: shouldFetch,
    staleTime: 60_000,
  });

  const getRiskBadge = (level: string) => {
    if (level === "red") return <Badge variant="error">High Risk</Badge>;
    if (level === "orange") return <Badge variant="warning">Medium Risk</Badge>;
    return <Badge variant="neutral">Low Risk</Badge>;
  };

  const handleSearch = () => {
    setShouldFetch(true);
  };

  return (
    <Card>
      <div className="border-b border-border px-4 py-4 sm:px-6">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold text-text-main flex items-center gap-2">
              <AlertTriangle size={16} className="text-warning" />
              Suspicious Activity Detection
            </h3>
            <p className="mt-0.5 text-sm text-text-muted">
              Manual query to find users with unusual ad watch patterns
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-3 items-end">
          <Input
            label="Min Ads Threshold"
            type="number"
            value={minAds}
            onChange={(e) => setMinAds(e.target.value)}
            placeholder="250"
            className="w-40"
          />
          <Input
            label="Time Range (hours)"
            type="number"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="24"
            className="w-40"
          />
          <Button
            variant="primary"
            onClick={handleSearch}
            disabled={isFetching}
          >
            {isFetching ? "Searching..." : "Search"}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (users.length > 0) {
                exportToCsv(
                  users.map((u) => ({
                    user_id: u.user_id,
                    email: u.email,
                    status: u.status,
                    ads_watched: u.ads_watched,
                    total_points: u.total_points,
                    hours_active: u.hours_active.toFixed(1),
                    ads_per_hour: u.ads_per_hour.toFixed(1),
                    risk_level: u.risk_level,
                  })),
                  "suspicious_users",
                );
              }
            }}
            disabled={!shouldFetch || !users || users.length === 0}
          >
            <Download size={16} className="mr-1" />
            Export CSV
          </Button>
        </div>

        <div className="mt-3 p-3 bg-bg-muted rounded text-sm text-text-muted">
          <strong>Thresholds:</strong> 0-150 ads = Normal, 151-200 = Power User,
          201-250 = High Usage, 251+ = Flag for Review
        </div>
      </div>

      <div className="overflow-x-auto">
        {isFetching && (
          <div className="p-4 sm:p-6">
            <ShimmerLoader lines={5} />
          </div>
        )}

        {!isFetching && shouldFetch && users.length > 0 && (
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-bg-muted">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Risk
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                  User ID
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Email
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Ads Watched
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Points Earned
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Hours Active
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Ads/Hour
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((user) => (
                <tr key={user.user_id} className="hover:bg-bg-hover">
                  <td className="px-4 py-3 text-sm">
                    {getRiskBadge(user.risk_level)}
                  </td>
                  <td className="px-4 py-3 text-sm text-text-main">
                    {user.user_id}
                  </td>
                  <td className="px-4 py-3 text-sm text-text-main">
                    {user.email}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <Badge
                      variant={user.status === "active" ? "success" : "error"}
                    >
                      {user.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-sm text-text-main font-semibold">
                    {user.ads_watched.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-text-main">
                    {user.total_points.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-text-main">
                    {user.hours_active.toFixed(1)}h
                  </td>
                  <td className="px-4 py-3 text-sm text-text-main">
                    {user.ads_per_hour.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!isFetching && shouldFetch && users.length === 0 && (
          <div className="p-4 sm:p-6 text-text-muted">
            No suspicious users found with the specified criteria. This is good!
            ✅
          </div>
        )}

        {!shouldFetch && (
          <div className="p-4 sm:p-6 text-text-muted">
            Click "Search" to query for suspicious activity
          </div>
        )}
      </div>
    </Card>
  );
}
