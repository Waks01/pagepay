import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminApi } from "@/lib/api";
import {
  Card,
  Badge,
  ShimmerLoader,
  Select,
  Button,
} from "@/shared/components";
import { Download } from "lucide-react";
import { exportToCsv } from "@/shared/utils/exportCsv";

type SsvLog = {
  id: number;
  user_id: number | null;
  token: string | null;
  transaction_id: string | null;
  ad_unit: string | null;
  status: string;
  rejection_reason: string | null;
  points_credited: number | null;
  created_at: string;
};

export function SsvLogTable() {
  const [status, setStatus] = useState("");
  const [hours, setHours] = useState("24");

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["admin", "ads", "ssv-logs", { status, hours }],
    queryFn: async () => {
      const { data } = await adminApi.get("/admin/ads/ssv-logs", {
        params: {
          status: status || undefined,
          hours: parseInt(hours),
          limit: 100,
        },
      });
      return data as SsvLog[];
    },
    staleTime: 30_000,
  });

  const getStatusBadge = (status: string) => {
    if (status === "success") return <Badge variant="success">{status}</Badge>;
    if (status === "duplicate")
      return <Badge variant="warning">{status}</Badge>;
    if (status === "signature_failed")
      return <Badge variant="error">signature failed</Badge>;
    if (status === "expired") return <Badge variant="warning">{status}</Badge>;
    return <Badge variant="neutral">{status}</Badge>;
  };

  return (
    <Card>
      <div className="border-b border-border px-4 py-4 sm:px-6">
        <h3 className="text-sm font-semibold text-text-main">
          SSV Callback Logs
        </h3>
        <p className="mt-0.5 text-sm text-text-muted">
          Recent AdMob server-side verification attempts
        </p>
        <div className="mt-3 flex flex-wrap gap-3 items-end">
          <Select
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={[
              { value: "", label: "All Status" },
              { value: "success", label: "Success" },
              { value: "signature_failed", label: "Signature Failed" },
              { value: "expired", label: "Expired" },
              { value: "duplicate", label: "Duplicate" },
              { value: "user_mismatch", label: "User Mismatch" },
              { value: "unknown_token", label: "Unknown Token" },
            ]}
            className="w-48"
          />
          <Select
            label="Time Range"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            options={[
              { value: "1", label: "Last Hour" },
              { value: "6", label: "Last 6 Hours" },
              { value: "24", label: "Last 24 Hours" },
              { value: "168", label: "Last 7 Days" },
            ]}
            className="w-48"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (logs.length > 0) {
                exportToCsv(
                  logs.map((log) => ({
                    id: log.id,
                    user_id: log.user_id || "N/A",
                    ad_unit: log.ad_unit || "N/A",
                    transaction_id: log.transaction_id || "N/A",
                    status: log.status,
                    points_credited: log.points_credited || 0,
                    rejection_reason: log.rejection_reason || "N/A",
                    created_at: new Date(log.created_at).toLocaleString(),
                  })),
                  "ssv_logs",
                );
              }
            }}
            disabled={!logs || logs.length === 0}
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

        {!isLoading && logs.length > 0 && (
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-bg-muted">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Time
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                  User ID
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Ad Unit
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Transaction
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Points
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Reason
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-bg-hover">
                  <td className="px-4 py-3 text-sm text-text-main">
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-text-main">
                    {log.user_id || "-"}
                  </td>
                  <td className="px-4 py-3 text-sm text-text-main">
                    {log.ad_unit || "-"}
                  </td>
                  <td className="px-4 py-3 text-sm text-text-main font-mono text-xs">
                    {log.transaction_id
                      ? log.transaction_id.substring(0, 12) + "..."
                      : "-"}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {getStatusBadge(log.status)}
                  </td>
                  <td className="px-4 py-3 text-sm text-text-main">
                    {log.points_credited !== null
                      ? log.points_credited.toLocaleString()
                      : "-"}
                  </td>
                  <td className="px-4 py-3 text-sm text-text-muted max-w-xs truncate">
                    {log.rejection_reason || "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!isLoading && logs.length === 0 && (
          <div className="p-4 sm:p-6 text-text-muted">
            No SSV callback logs found for the selected filters
          </div>
        )}
      </div>
    </Card>
  );
}
