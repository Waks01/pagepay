import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { adminApi } from "@/lib/api";
import type { RevenueSummary, PayoutListResponse } from "@/lib/types";
import {
  Card,
  StatCard,
  Badge,
  Button,
  Pagination,
  ShimmerLoader,
  Container,
  ConfirmModal,
  Tooltip,
  DateRangePicker,
  getDateRangeFromPreset,
  Select,
  BarChart,
} from "@/shared/components";
import type { DateRangePreset } from "@/shared/components";
import { TopHeader } from "@/shared/components/TopHeader";
import { useLayoutContext } from "@/shared/components/Layout";
import { useAuthStore } from "@/store/auth";
import { CheckCircle, XCircle, Download, RefreshCw } from "lucide-react";
import { usePlatformConfig } from "@/shared/hooks/use-platform-config";
import { exportToCsv } from "@/shared/utils/exportCsv";

function formatNgn(kobo: number = 0) {
  return `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatUsd(usd: number = 0) {
  return `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function FinancePage() {
  const { onMenuClick } = useLayoutContext();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [tab, setTab] = useState<"revenue" | "payouts">("revenue");
  const [payoutPage, setPayoutPage] = useState(1);
  const [payoutStatus, setPayoutStatus] = useState<string>(""); // Add status filter
  const [approveModalOpen, setApproveModalOpen] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [retryModalOpen, setRetryModalOpen] = useState(false); // Add retry modal
  const [selectedPayoutId, setSelectedPayoutId] = useState<number | null>(null);

  // Date range state
  const [dateRange, setDateRange] = useState<{
    preset: DateRangePreset;
    startDate?: string;
    endDate?: string;
  }>({ preset: "30d" });

  const queryClient = useQueryClient();

  const daysCount =
    dateRange.preset === "custom" && dateRange.startDate && dateRange.endDate
      ? Math.max(
          1,
          Math.ceil(
            (new Date(dateRange.endDate).getTime() -
              new Date(dateRange.startDate).getTime()) /
              (1000 * 60 * 60 * 24),
          ),
        )
      : parseInt(dateRange.preset.replace("d", ""));

  const { data: revenueDaily, isLoading: revenueDailyLoading } = useQuery({
    queryKey: ["admin", "finance", "revenue-daily", daysCount],
    queryFn: async () => {
      const { data } = await adminApi.get<{
        items: { date: string; total_revenue_kobo: number }[];
      }>("/admin/revenue/daily", {
        params: { days: daysCount },
      });
      return data;
    },
    staleTime: 60_000,
  });

  const useCustom =
    dateRange.preset === "custom" && dateRange.startDate && dateRange.endDate;
  const { startDate, endDate } = useCustom
    ? { startDate: dateRange.startDate!, endDate: dateRange.endDate! }
    : getDateRangeFromPreset(dateRange.preset);

  const { data: revenue, isLoading: revenueLoading } = useQuery({
    queryKey: ["admin", "finance", "revenue", dateRange],
    queryFn: async () => {
      const { data } = await adminApi.get<RevenueSummary>(
        "/admin/revenue/summary",
        {
          params: { start_date: startDate, end_date: endDate },
        },
      );
      return data;
    },
  });

  const { data: platformConfig } = usePlatformConfig();
  const adPlatformPercent = Math.round(
    (platformConfig?.ad_revenue_platform_percent ?? 0.15) * 100,
  );
  const adUserPercent = Math.round(
    (platformConfig?.ad_revenue_user_percent ?? 0.85) * 100,
  );

  const { data: payouts, isLoading: payoutsLoading } = useQuery({
    queryKey: ["admin", "finance", "payouts", payoutPage, payoutStatus],
    queryFn: async () => {
      const { data } = await adminApi.get<PayoutListResponse>(
        "/admin/payouts",
        {
          params: {
            page: payoutPage,
            limit: 50,
            status: payoutStatus || undefined,
          },
        },
      );
      return data;
    },
    staleTime: 30_000,
  });

  const approveMutation = useMutation({
    mutationFn: async (payoutId: number) => {
      await adminApi.post(`/admin/payouts/${payoutId}/approve`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["admin", "finance", "payouts"],
      });
      setApproveModalOpen(false);
      setSelectedPayoutId(null);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({
      payoutId,
      reason,
    }: {
      payoutId: number;
      reason: string;
    }) => {
      await adminApi.post(`/admin/payouts/${payoutId}/reject`, null, {
        params: { reason },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["admin", "finance", "payouts"],
      });
      setRejectModalOpen(false);
      setSelectedPayoutId(null);
    },
  });

  const retryMutation = useMutation({
    mutationFn: async (payoutId: number) => {
      await adminApi.post(`/admin/payouts/${payoutId}/retry`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["admin", "finance", "payouts"],
      });
      setRetryModalOpen(false);
      setSelectedPayoutId(null);
    },
  });

  const handleApproveClick = (payoutId: number) => {
    setSelectedPayoutId(payoutId);
    setApproveModalOpen(true);
  };

  const handleRejectClick = (payoutId: number) => {
    setSelectedPayoutId(payoutId);
    setRejectModalOpen(true);
  };

  const handleRetryClick = (payoutId: number) => {
    setSelectedPayoutId(payoutId);
    setRetryModalOpen(true);
  };

  const handleApproveConfirm = () => {
    if (selectedPayoutId) {
      approveMutation.mutate(selectedPayoutId);
    }
  };

  const handleRejectConfirm = (reason?: string) => {
    if (selectedPayoutId && reason && reason.length >= 10) {
      rejectMutation.mutate({ payoutId: selectedPayoutId, reason });
    }
  };

  const handleRetryConfirm = () => {
    if (selectedPayoutId) {
      retryMutation.mutate(selectedPayoutId);
    }
  };

  return (
    <>
      <TopHeader
        title="Finance"
        subtitle="Revenue and payouts overview"
        onMenuClick={onMenuClick}
        actions={
          <div className="flex rounded-lg border border-border">
            <button
              onClick={() => setTab("revenue")}
              className={`cursor-pointer px-4 py-1.5 text-sm font-semibold transition-colors ${tab === "revenue" ? "bg-primary text-white" : "text-text-muted hover:text-text-main"}`}
            >
              Revenue
            </button>
            <button
              onClick={() => setTab("payouts")}
              className={`cursor-pointer px-4 py-1.5 text-sm font-semibold transition-colors ${tab === "payouts" ? "bg-primary text-white" : "text-text-muted hover:text-text-main"}`}
            >
              Payouts
            </button>
          </div>
        }
      />
      <Container size="lg">
        {tab === "revenue" && (
          <div className="space-y-6">
            {/* Date Range Picker */}
            <Card>
              <div className="p-4 sm:p-6">
                <DateRangePicker value={dateRange} onChange={setDateRange} />
              </div>
            </Card>

            {revenueLoading && <ShimmerLoader lines={4} />}
            {revenue && (
              <>
                {/* Total Revenue Overview */}
                <Card>
                  <div className="border-b border-border px-4 py-4 sm:px-6">
                    <h3 className="text-sm font-semibold text-text-main">
                      Total Revenue
                    </h3>
                    <p className="mt-0.5 text-sm text-text-muted">
                      Combined ad and premium revenue
                    </p>
                  </div>
                  <div className="p-4 sm:p-6">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      <StatCard
                        label="Total Revenue (USD)"
                        value={formatUsd(revenue.total_revenue_usd ?? 0)}
                      />
                      <StatCard
                        label="Total Revenue (NGN)"
                        value={formatNgn(revenue.total_revenue_ngn ?? 0)}
                      />
                      <StatCard
                        label="Platform Earnings"
                        value={formatNgn(revenue.platform_earnings_ngn ?? 0)}
                      />
                      <StatCard
                        label="User Earnings"
                        value={formatNgn(revenue.user_earnings_ngn ?? 0)}
                      />
                    </div>
                  </div>
                </Card>

                {/* Revenue Trend Chart */}
              <Card>
                <div className="border-b border-border px-4 py-4 sm:px-6">
                  <h3 className="text-sm font-semibold text-text-main">
                    Revenue Trend (Last {daysCount} Days)
                  </h3>
                  <p className="mt-0.5 text-sm text-text-muted">
                    Daily total revenue (ad + premium) in NGN
                  </p>
                </div>
                <div className="p-4 sm:p-6">
                  {revenueDailyLoading && <ShimmerLoader lines={4} />}
                  {!revenueDailyLoading && revenueDaily && revenueDaily.items.length > 0 && (
                    <BarChart
                      data={revenueDaily.items.map((d) => ({
                        date: d.date.slice(5),
                        count: d.total_revenue_kobo / 100,
                      }))}
                      height={300}
                      valueFormatter={(v: number) => `₦${v.toLocaleString()}`}
                    />
                  )}
                  {!revenueDailyLoading && revenueDaily && revenueDaily.items.length === 0 && (
                    <p className="text-text-muted">No revenue data for this period</p>
                  )}
                </div>
              </Card>

              {/* Ad Revenue Breakdown */}
                <Card>
                  <div className="border-b border-border px-4 py-4 sm:px-6">
                    <h3 className="text-sm font-semibold text-text-main">
                      Ad Revenue ({adPlatformPercent}/{adUserPercent} Split)
                    </h3>
                    <p className="mt-0.5 text-sm text-text-muted">
                      Revenue from ads with historical FX rates
                    </p>
                  </div>
                  <div className="p-4 sm:p-6">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <StatCard
                        label="Ad Revenue (USD)"
                        value={formatUsd(revenue.ad_revenue_usd ?? 0)}
                      />
                      <StatCard
                        label="Ad Revenue (NGN)"
                        value={formatNgn(revenue.ad_revenue_ngn ?? 0)}
                      />
                      <StatCard
                        label="Total Points"
                        value={(
                          revenue.total_points_distributed ?? 0
                        ).toLocaleString()}
                      />
                    </div>
                    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="rounded-lg border border-border bg-bg-muted p-4">
                        <div className="text-xs font-semibold uppercase text-text-muted">
                          Platform Share ({adPlatformPercent}%)
                        </div>
                        <div className="mt-2 space-y-1">
                          <div className="text-sm text-text-main">
                            {formatUsd(revenue.ad_platform_share_usd ?? 0)}
                          </div>
                          <div className="text-sm text-text-main">
                            {formatNgn(revenue.ad_platform_share_ngn ?? 0)}
                          </div>
                        </div>
                      </div>
                      <div className="rounded-lg border border-border bg-bg-muted p-4">
                        <div className="text-xs font-semibold uppercase text-text-muted">
                          User Share ({adUserPercent}%)
                        </div>
                        <div className="mt-2 space-y-1">
                          <div className="text-sm text-text-main">
                            {formatUsd(revenue.ad_user_share_usd ?? 0)}
                          </div>
                          <div className="text-sm text-text-main">
                            {formatNgn(revenue.ad_user_share_ngn ?? 0)}
                          </div>
                        </div>
                      </div>
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
                        value={formatNgn(revenue.task_revenue_ngn ?? 0)}
                      />
                      <StatCard
                        label="Platform Fee (NGN)"
                        value={formatNgn(revenue.task_platform_share_ngn ?? 0)}
                      />
                      <StatCard
                        label="Paid to Workers (NGN)"
                        value={formatNgn(revenue.task_worker_share_ngn ?? 0)}
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
                        value={formatNgn(revenue.premium_revenue_ngn ?? 0)}
                      />
                      <StatCard
                        label="Premium Revenue (USD)"
                        value={formatUsd(revenue.premium_revenue_usd ?? 0)}
                      />
                    </div>
                  </div>
                </Card>

                {/* FX Rate Info */}
                <Card>
                  <div className="border-b border-border px-4 py-4 sm:px-6">
                    <h3 className="text-sm font-semibold text-text-main">
                      Exchange Rate Information
                    </h3>
                    <p className="mt-0.5 text-sm text-text-muted">
                      Historical vs current FX rates
                    </p>
                  </div>
                  <div className="p-4 sm:p-6">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <StatCard
                        label="Average FX Rate (Period)"
                        value={`1 USD = ₦${(revenue.average_fx_rate ?? 0).toFixed(2)}`}
                      />
                      <StatCard
                        label="Current FX Rate"
                        value={`1 USD = ₦${(revenue.current_fx_rate ?? 0).toFixed(2)}`}
                      />
                    </div>
                  </div>
                </Card>

                <p className="text-sm text-text-muted">
                  Period: {new Date(revenue.period_start).toLocaleDateString()}{" "}
                  → {new Date(revenue.period_end).toLocaleDateString()}
                </p>
              </>
            )}
          </div>
        )}

        {tab === "payouts" && (
          <div>
            {payoutsLoading && <ShimmerLoader lines={5} />}
            {payouts && (
              <Card>
                <div className="border-b border-border px-4 py-4 sm:px-6 flex flex-wrap justify-between items-center gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-text-main">
                      Payout Requests
                    </h3>
                    <p className="mt-0.5 text-sm text-text-muted">
                      Review and manage payout requests
                    </p>
                  </div>
                  <div className="flex items-end gap-2 flex-wrap">
                    <Select
                      label="Status"
                      value={payoutStatus}
                      onChange={(value) => {
                        setPayoutStatus(value);
                        setPayoutPage(1);
                      }}
                      options={[
                        { value: "", label: "All Status" },
                        { value: "pending", label: "Pending" },
                        { value: "success", label: "Success" },
                        { value: "failed", label: "Failed" },
                        { value: "rejected", label: "Rejected" },
                      ]}
                      className="w-40"
                    />
                    <Button
                      variant="secondary"
                    size="sm"
                    onClick={() => {
                      if (payouts.items && payouts.items.length > 0) {
                        exportToCsv(
                          payouts.items.map((p) => ({
                            id: p.id,
                            user_id: p.user_id,
                            amount_ngn: (p.amount_kobo / 100).toFixed(2),
                            fee_ngn: (p.fee_kobo / 100).toFixed(2),
                            status: p.status,
                            created_at: new Date(p.created_at).toLocaleString(),
                          })),
                          "payouts",
                        );
                      }
                    }}
                    disabled={!payouts.items || payouts.items.length === 0}
                  >
                    <Download size={16} className="mr-1" />
                    Export CSV
                  </Button>
                </div>
              </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-border">
                    <thead className="bg-bg-muted">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                          ID
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                          User
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                          Amount
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                          Fee
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                          Status
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                          Created
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {payouts.items.map((p) => (
                        <tr key={p.id} className="hover:bg-bg-hover">
                          <td className="px-4 py-3 text-sm text-text-main">
                            {p.id}
                          </td>
                          <td className="px-4 py-3 text-sm text-text-main">
                            {p.user_id}
                          </td>
                          <td className="px-4 py-3 text-sm text-text-main">
                            ₦{(p.amount_kobo / 100).toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-sm text-text-main">
                            ₦{(p.fee_kobo / 100).toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-sm text-text-main">
                            <Badge
                              variant={
                                p.status === "success"
                                  ? "success"
                                  : p.status === "failed"
                                    ? "error"
                                    : "warning"
                              }
                            >
                              {p.status}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-sm text-text-main">
                            {new Date(p.created_at).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-sm text-text-main">
                            {hasPermission("finance.approve") &&
                              p.status === "pending" && (
                                <div className="flex gap-2">
                                  <Tooltip
                                    content="Approve this payout"
                                    position="top"
                                  >
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      onClick={() => handleApproveClick(p.id)}
                                    >
                                      <CheckCircle size={14} /> Approve
                                    </Button>
                                  </Tooltip>
                                  <Tooltip
                                    content="Reject this payout"
                                    position="top"
                                  >
                                    <Button
                                      size="sm"
                                      variant="danger"
                                      onClick={() => handleRejectClick(p.id)}
                                    >
                                      <XCircle size={14} /> Reject
                                    </Button>
                                  </Tooltip>
                                </div>
                              )}
                            {p.status === "failed" && (
                              <Tooltip content="Retry this failed payout" position="top">
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => handleRetryClick(p.id)}
                                >
                                  <RefreshCw size={14} /> Retry
                                </Button>
                              </Tooltip>
                            )}
                            {p.status !== "pending" && p.status !== "failed" && (
                              <span className="text-text-muted">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="p-4 sm:p-6">
                  <Pagination
                    page={payoutPage}
                    totalPages={Math.ceil(payouts.total / 50)}
                    onPageChange={setPayoutPage}
                  />
                </div>
              </Card>
            )}
          </div>
        )}
      </Container>

      {/* Approve Payout Modal */}
      <ConfirmModal
        isOpen={approveModalOpen}
        onClose={() => {
          setApproveModalOpen(false);
          setSelectedPayoutId(null);
        }}
        onConfirm={handleApproveConfirm}
        title="Approve Payout"
        message="Are you sure you want to approve this payout? This will initiate the bank transfer to the user."
        confirmText="Approve Payout"
        cancelText="Cancel"
        variant="primary"
        isLoading={approveMutation.isPending}
      />

      {/* Reject Payout Modal */}
      <ConfirmModal
        isOpen={rejectModalOpen}
        onClose={() => {
          setRejectModalOpen(false);
          setSelectedPayoutId(null);
        }}
        onConfirm={handleRejectConfirm}
        title="Reject Payout"
        message="Please provide a detailed reason for rejecting this payout (minimum 10 characters). The user will be notified."
        confirmText="Reject Payout"
        cancelText="Cancel"
        variant="danger"
        requireInput={true}
        inputLabel="Rejection Reason"
        inputPlaceholder="Enter reason for rejection (min 10 characters)..."
        isLoading={rejectMutation.isPending}
      />
    </>
  );
}
