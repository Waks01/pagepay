import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@/lib/api";
import type { UserListResponse } from "@/lib/types";
import { useAuthStore } from "@/store/auth";
import { Shield, Eye, Download } from "lucide-react";
import React from "react";
import {
  Card,
  Badge,
  Button,
  Pagination,
  ShimmerLoader,
  Container,
  ConfirmModal,
  Tooltip,
} from "@/shared/components";
import { TopHeader } from "@/shared/components/TopHeader";
import { useLayoutContext } from "@/shared/components/Layout";
import { Input } from "@/shared/components/Input";
import { Select } from "@/shared/components/Select";
import { UserDetailModal } from "./UserDetailModal";
import { exportToCsv } from "@/shared/utils/exportCsv";

export function UsersPage() {
  const { onMenuClick } = useLayoutContext();
  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState("");
  const [tier, setTier] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [selectedUserId, setSelectedUserId] = React.useState<number | null>(
    null,
  );
  const [banModalOpen, setBanModalOpen] = React.useState(false);
  const [unbanModalOpen, setUnbanModalOpen] = React.useState(false);
  const [userToBan, setUserToBan] = React.useState<number | null>(null);
  const [userToUnban, setUserToUnban] = React.useState<number | null>(null);
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "users", { page, search, tier, status }],
    queryFn: async () => {
      const { data } = await adminApi.get<UserListResponse>("/admin/users", {
        params: { page, limit: 50, search, tier, status },
      });
      return data;
    },
    staleTime: 30_000,
  });

  const queryClient = useQueryClient();

  const banMutation = useMutation({
    mutationFn: async ({
      userId,
      reason,
    }: {
      userId: number;
      reason: string;
    }) => {
      await adminApi.post(`/admin/users/${userId}/ban`, null, {
        params: { reason },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      setBanModalOpen(false);
      setUserToBan(null);
    },
  });

  const unbanMutation = useMutation({
    mutationFn: async (userId: number) => {
      await adminApi.post(`/admin/users/${userId}/unban`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      setUnbanModalOpen(false);
      setUserToUnban(null);
    },
  });

  const handleBanClick = (userId: number) => {
    setUserToBan(userId);
    setBanModalOpen(true);
  };

  const handleUnbanClick = (userId: number) => {
    setUserToUnban(userId);
    setUnbanModalOpen(true);
  };

  const handleBanConfirm = (reason?: string) => {
    if (userToBan && reason) {
      banMutation.mutate({ userId: userToBan, reason });
    }
  };

  const handleUnbanConfirm = () => {
    if (userToUnban) {
      unbanMutation.mutate(userToUnban);
    }
  };

  const totalPages = data ? Math.ceil(data.total / data.limit) : 0;

  return (
    <>
      <TopHeader
        title="Users"
        subtitle="Manage platform users"
        onMenuClick={onMenuClick}
      />
      <Container size="full">
        <Card>
          <div className="border-b border-border px-4 py-4 sm:px-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <Input
                  label="Search"
                  placeholder="Email or phone..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  className="lg:max-w-xs"
                />
                <Select
                  label="Tier"
                  value={tier}
                  onChange={(e) => {
                    setTier(e.target.value);
                    setPage(1);
                  }}
                  options={[
                    { value: "", label: "All Tiers" },
                    { value: "free", label: "Free" },
                    { value: "premium_monthly", label: "Premium Monthly" },
                    { value: "premium_yearly", label: "Premium Yearly" },
                  ]}
                  className="lg:max-w-xs"
                />
                <Select
                  label="Status"
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setPage(1);
                  }}
                  options={[
                    { value: "", label: "All Status" },
                    { value: "active", label: "Active" },
                    { value: "banned", label: "Banned" },
                  ]}
                  className="lg:max-w-xs"
                />
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  if (data?.items && data.items.length > 0) {
                    exportToCsv(
                      data.items.map((u) => ({
                        id: u.id,
                        email: u.email,
                        phone: u.phone || "N/A",
                        tier: u.tier,
                        status: u.status,
                        points_balance: u.points_balance,
                      })),
                      "users",
                    );
                  }
                }}
                disabled={!data?.items || data.items.length === 0}
              >
                <Download size={16} className="mr-1" />
                Export CSV
              </Button>
            </div>
          </div>

          {isLoading && (
            <div className="p-4 sm:p-6">
              <ShimmerLoader lines={5} />
            </div>
          )}
          {error && (
            <div className="p-4 sm:p-6 text-error">Failed to load users</div>
          )}

          {data && (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-border">
                  <thead className="bg-bg-muted">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                        ID
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                        Email
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                        Phone
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                        Tier
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                        Status
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                        Balance
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.items.map((user) => (
                      <tr key={user.id} className="hover:bg-bg-hover">
                        <td className="px-4 py-3 text-sm text-text-main">
                          {user.id}
                        </td>
                        <td className="px-4 py-3 text-sm text-text-main">
                          {user.email}
                        </td>
                        <td className="px-4 py-3 text-sm text-text-main">
                          {user.phone || "-"}
                        </td>
                        <td className="px-4 py-3 text-sm text-text-main">
                          <Badge variant="neutral">{user.tier}</Badge>
                        </td>
                        <td className="px-4 py-3 text-sm text-text-main">
                          <Badge
                            variant={
                              user.status === "active"
                                ? "success"
                                : user.status === "banned"
                                  ? "error"
                                  : "warning"
                            }
                          >
                            {user.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-sm text-text-main">
                          {user.points_balance.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-sm text-text-main">
                          <div className="flex flex-wrap gap-2">
                            <Tooltip content="View user details" position="top">
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => setSelectedUserId(user.id)}
                              >
                                <Eye size={14} /> View
                              </Button>
                            </Tooltip>
                            {hasPermission("users.ban") &&
                              user.status === "active" && (
                                <Tooltip content="Ban this user" position="top">
                                  <Button
                                    size="sm"
                                    variant="danger"
                                    onClick={() => handleBanClick(user.id)}
                                  >
                                    <Shield size={14} /> Ban
                                  </Button>
                                </Tooltip>
                              )}
                            {hasPermission("users.ban") &&
                              user.status === "banned" && (
                                <Tooltip
                                  content="Restore user access"
                                  position="top"
                                >
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => handleUnbanClick(user.id)}
                                  >
                                    Unban
                                  </Button>
                                </Tooltip>
                              )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="p-4 sm:p-6">
                <Pagination
                  page={page}
                  totalPages={totalPages}
                  onPageChange={setPage}
                />
              </div>
            </>
          )}
        </Card>
      </Container>

      {/* User Detail Modal */}
      <UserDetailModal
        userId={selectedUserId}
        onClose={() => setSelectedUserId(null)}
      />

      {/* Ban Confirmation Modal */}
      <ConfirmModal
        isOpen={banModalOpen}
        onClose={() => {
          setBanModalOpen(false);
          setUserToBan(null);
        }}
        onConfirm={handleBanConfirm}
        title="Ban User"
        message="Please provide a reason for banning this user. This action will prevent them from accessing the platform."
        confirmText="Ban User"
        cancelText="Cancel"
        variant="danger"
        requireInput={true}
        inputLabel="Ban Reason"
        inputPlaceholder="Enter reason for ban..."
        isLoading={banMutation.isPending}
      />

      {/* Unban Confirmation Modal */}
      <ConfirmModal
        isOpen={unbanModalOpen}
        onClose={() => {
          setUnbanModalOpen(false);
          setUserToUnban(null);
        }}
        onConfirm={handleUnbanConfirm}
        title="Unban User"
        message="Are you sure you want to unban this user? They will regain access to the platform."
        confirmText="Unban User"
        cancelText="Cancel"
        variant="primary"
        isLoading={unbanMutation.isPending}
      />
    </>
  );
}
