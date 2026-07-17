import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { useState } from 'react';
import { Card, Badge, Button, Pagination, ShimmerLoader, Container, ConfirmModal, Tooltip } from '@/shared/components';
import { TopHeader } from '@/shared/components/TopHeader';
import { useLayoutContext } from '@/shared/components/Layout';
import { useAuthStore } from '@/store/auth';
import { AlertCircle, CreditCard, Trash2, Eye } from 'lucide-react';
import { Input } from '@/shared/components/Input';

interface Payment {
  id: number;
  user_id: number;
  user_email: string;
  tier: string;
  amount_kobo: number;
  amount_ngn: number;
  provider: string;
  provider_tx_ref: string;
  status: string;
  webhook_confirmed: boolean;
  created_at: string;
  confirmed_at: string | null;
}

interface FailedPayment {
  id: number;
  user_id: number;
  user_email: string;
  tier: string;
  amount_kobo: number;
  amount_ngn: number;
  provider: string;
  provider_tx_ref: string;
  created_at: string;
}

interface ActiveSubscription {
  user_id: number;
  email: string;
  tier: string;
  subscription_expires_at: string | null;
  days_remaining: number | null;
  created_at: string;
}

interface ListResponse {
  items: Payment[] | FailedPayment[] | ActiveSubscription[];
  total: number;
  page: number;
  limit: number;
}

export function PaymentPage() {
  const { onMenuClick } = useLayoutContext();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'subscriptions' | 'failed' | 'active'>('subscriptions');
  const [page, setPage] = useState(1);
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [refundModalOpen, setRefundModalOpen] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [refundReason, setRefundReason] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [detailModalOpen, setDetailModalOpen] = useState(false);

  // Fetch subscriptions
  const { data: subscriptions, isLoading: subsLoading } = useQuery({
    queryKey: ['admin', 'payments', 'subscriptions', page],
    queryFn: async () => {
      const { data } = await adminApi.get<ListResponse>('/admin/payments/subscriptions', {
        params: { page, limit: 50 },
      });
      return data;
    },
    enabled: tab === 'subscriptions',
  });

  // Fetch failed payments
  const { data: failedPayments, isLoading: failedLoading } = useQuery({
    queryKey: ['admin', 'payments', 'failed', page],
    queryFn: async () => {
      const { data } = await adminApi.get<ListResponse>('/admin/payments/failed', {
        params: { page, limit: 50 },
      });
      return data;
    },
    enabled: tab === 'failed',
  });

  // Fetch active subscriptions
  const { data: activeSubscriptions, isLoading: activeLoading } = useQuery({
    queryKey: ['admin', 'subscriptions', 'active', page],
    queryFn: async () => {
       const { data } = await adminApi.get<ListResponse>('/admin/payments/subscriptions/active', {
        params: { page, limit: 50 },
      });
      return data;
    },
    enabled: tab === 'active',
  });

  // Refund mutation
  const refundMutation = useMutation({
    mutationFn: async ({ paymentId, reason }: { paymentId: number; reason: string }) => {
      await adminApi.post(`/admin/payments/subscriptions/${paymentId}/refund`, null, {
        params: { reason },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'payments'] });
      setRefundModalOpen(false);
      setRefundReason('');
      setSelectedPayment(null);
      setDetailModalOpen(false);
    },
  });

  // Cancel subscription mutation
  const cancelMutation = useMutation({
    mutationFn: async ({ userId, reason }: { userId: number; reason: string }) => {
      await adminApi.post(`/admin/payments/subscriptions/${userId}/cancel`, null, {
        params: { reason },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'subscriptions'] });
      setCancelModalOpen(false);
      setCancelReason('');
      setSelectedPayment(null);
    },
  });

  const handleViewDetail = async (payment: Payment) => {
    setSelectedPayment(payment);
    setDetailModalOpen(true);
  };

  const handleRefundClick = (payment: Payment) => {
    setSelectedPayment(payment);
    setRefundModalOpen(true);
  };

  const handleCancelClick = (subscription: ActiveSubscription) => {
    setSelectedPayment({
      ...selectedPayment!,
      user_id: subscription.user_id,
    });
    setCancelModalOpen(true);
  };

  const handleRefundConfirm = () => {
    if (selectedPayment && refundReason.trim()) {
      refundMutation.mutate({
        paymentId: selectedPayment.id,
        reason: refundReason,
      });
    }
  };

  const handleCancelConfirm = () => {
    if (selectedPayment && cancelReason.trim()) {
      cancelMutation.mutate({
        userId: selectedPayment.user_id,
        reason: cancelReason,
      });
    }
  };

  const data = tab === 'subscriptions' ? subscriptions : tab === 'failed' ? failedPayments : activeSubscriptions;
  const isLoading = tab === 'subscriptions' ? subsLoading : tab === 'failed' ? failedLoading : activeLoading;

  return (
    <>
      <TopHeader
        title="Payment Management"
        subtitle="Manage subscriptions, refunds, and payments"
        onMenuClick={onMenuClick}
        actions={
          <div className="flex rounded-lg border border-border">
            <button
              onClick={() => {
                setTab('subscriptions');
                setPage(1);
              }}
              className={`px-4 py-1.5 text-sm font-semibold transition-colors ${
                tab === 'subscriptions' ? 'bg-primary text-white' : 'text-text-muted hover:text-text-main'
              }`}
            >
              Subscriptions
            </button>
            <button
              onClick={() => {
                setTab('failed');
                setPage(1);
              }}
              className={`px-4 py-1.5 text-sm font-semibold transition-colors ${
                tab === 'failed' ? 'bg-primary text-white' : 'text-text-muted hover:text-text-main'
              }`}
            >
              Failed
            </button>
            <button
              onClick={() => {
                setTab('active');
                setPage(1);
              }}
              className={`px-4 py-1.5 text-sm font-semibold transition-colors ${
                tab === 'active' ? 'bg-primary text-white' : 'text-text-muted hover:text-text-main'
              }`}
            >
              Active
            </button>
          </div>
        }
      />
      <Container size="full">
        {tab === 'subscriptions' && (
          <div>
            {isLoading && <ShimmerLoader lines={5} />}
            {subscriptions && (
              <Card>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-border">
                    <thead className="bg-bg-muted">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                          Payment ID
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                          User Email
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                          Tier
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                          Amount
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                          Provider
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
                      {(subscriptions.items as Payment[]).map((payment) => (
                        <tr key={payment.id} className="hover:bg-bg-hover">
                          <td className="px-4 py-3 text-sm text-text-main">{payment.id}</td>
                          <td className="px-4 py-3 text-sm text-text-main">{payment.user_email}</td>
                          <td className="px-4 py-3 text-sm text-text-main">
                            <Badge variant="info">{payment.tier}</Badge>
                          </td>
                          <td className="px-4 py-3 text-sm text-text-main">₦{payment.amount_ngn.toFixed(2)}</td>
                          <td className="px-4 py-3 text-sm text-text-main capitalize">{payment.provider}</td>
                          <td className="px-4 py-3 text-sm text-text-main">
                            <Badge
                              variant={
                                payment.status === 'success'
                                  ? 'success'
                                  : payment.status === 'pending'
                                    ? 'warning'
                                    : 'error'
                              }
                            >
                              {payment.status}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-sm text-text-muted">
                            {new Date(payment.created_at).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            <div className="flex gap-2">
                              <Tooltip content="View payment details" position="top">
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => handleViewDetail(payment)}
                                >
                                  <Eye size={14} />
                                </Button>
                              </Tooltip>
                              {hasPermission('finance.approve') && payment.status === 'success' && (
                                <Tooltip content="Refund this payment" position="top">
                                  <Button
                                    variant="danger"
                                    size="sm"
                                    onClick={() => handleRefundClick(payment)}
                                  >
                                    <Trash2 size={14} />
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
                    totalPages={Math.ceil(subscriptions.total / 50)}
                    onPageChange={setPage}
                  />
                </div>
              </Card>
            )}
          </div>
        )}

        {tab === 'failed' && (
          <div>
            {isLoading && <ShimmerLoader lines={5} />}
            {failedPayments && (
              <Card>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-border">
                    <thead className="bg-bg-muted">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                          Payment ID
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                          User Email
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                          Tier
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                          Amount
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                          Provider
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                          Ref
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                          Created
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {(failedPayments.items as FailedPayment[]).map((payment) => (
                        <tr key={payment.id} className="hover:bg-bg-hover">
                          <td className="px-4 py-3 text-sm text-text-main">{payment.id}</td>
                          <td className="px-4 py-3 text-sm text-text-main">{payment.user_email}</td>
                          <td className="px-4 py-3 text-sm text-text-main">
                            <Badge variant="error">{payment.tier}</Badge>
                          </td>
                          <td className="px-4 py-3 text-sm text-text-main">₦{payment.amount_ngn.toFixed(2)}</td>
                          <td className="px-4 py-3 text-sm text-text-main capitalize">{payment.provider}</td>
                          <td className="px-4 py-3 text-sm text-text-muted font-mono text-xs">
                            {payment.provider_tx_ref.slice(-12)}...
                          </td>
                          <td className="px-4 py-3 text-sm text-text-muted">
                            {new Date(payment.created_at).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {failedPayments.items.length === 0 && (
                    <div className="p-6 text-center text-text-muted flex items-center justify-center gap-2">
                      <AlertCircle size={16} />
                      No failed payments found
                    </div>
                  )}
                </div>
                <div className="p-4 sm:p-6">
                  <Pagination
                    page={page}
                    totalPages={Math.ceil(failedPayments.total / 50)}
                    onPageChange={setPage}
                  />
                </div>
              </Card>
            )}
          </div>
        )}

        {tab === 'active' && (
          <div>
            {isLoading && <ShimmerLoader lines={5} />}
            {activeSubscriptions && (
              <Card>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-border">
                    <thead className="bg-bg-muted">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                          User Email
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                          Tier
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                          Expires At
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                          Days Left
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                          Subscribed
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {(activeSubscriptions.items as ActiveSubscription[]).map((sub) => (
                        <tr key={sub.user_id} className="hover:bg-bg-hover">
                          <td className="px-4 py-3 text-sm text-text-main">{sub.email}</td>
                          <td className="px-4 py-3 text-sm text-text-main">
                            <Badge variant="success">{sub.tier}</Badge>
                          </td>
                          <td className="px-4 py-3 text-sm text-text-main">
                            {sub.subscription_expires_at
                              ? new Date(sub.subscription_expires_at).toLocaleDateString()
                              : 'Unlimited'}
                          </td>
                          <td className="px-4 py-3 text-sm text-text-main">
                            {sub.days_remaining !== null ? (
                              <Badge
                                variant={
                                  sub.days_remaining <= 7
                                    ? 'warning'
                                    : sub.days_remaining <= 0
                                      ? 'error'
                                      : 'success'
                                }
                              >
                                {sub.days_remaining} days
                              </Badge>
                            ) : (
                              'N/A'
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-text-muted">
                            {new Date(sub.created_at).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {hasPermission('finance.approve') && (
                              <Tooltip content="Cancel this subscription" position="top">
                                <Button
                                  variant="danger"
                                  size="sm"
                                  onClick={() => {
                                    setSelectedPayment({
                                      id: 0,
                                      user_id: sub.user_id,
                                      user_email: sub.email,
                                      tier: sub.tier,
                                      amount_kobo: 0,
                                      amount_ngn: 0,
                                      provider: '',
                                      provider_tx_ref: '',
                                      status: '',
                                      webhook_confirmed: false,
                                      created_at: '',
                                      confirmed_at: null,
                                    });
                                    setCancelModalOpen(true);
                                  }}
                                >
                                  Cancel
                                </Button>
                              </Tooltip>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {activeSubscriptions.items.length === 0 && (
                    <div className="p-6 text-center text-text-muted flex items-center justify-center gap-2">
                      <CreditCard size={16} />
                      No active subscriptions found
                    </div>
                  )}
                </div>
                <div className="p-4 sm:p-6">
                  <Pagination
                    page={page}
                    totalPages={Math.ceil(activeSubscriptions.total / 50)}
                    onPageChange={setPage}
                  />
                </div>
              </Card>
            )}
          </div>
        )}
      </Container>

      {/* Payment Detail Modal */}
      <ConfirmModal
        isOpen={detailModalOpen}
        onClose={() => {
          setDetailModalOpen(false);
          setSelectedPayment(null);
        }}
        onConfirm={() => setDetailModalOpen(false)}
        title="Payment Details"
        message=""
        confirmText="Close"
        variant="secondary"
        hideCancel
      >
        {selectedPayment && (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase">Payment ID</label>
                <p className="text-sm text-text-main mt-1">{selectedPayment.id}</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase">User</label>
                <p className="text-sm text-text-main mt-1">{selectedPayment.user_email}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase">Tier</label>
                <p className="text-sm text-text-main mt-1 capitalize">{selectedPayment.tier}</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase">Amount</label>
                <p className="text-sm text-text-main mt-1">₦{selectedPayment.amount_ngn.toFixed(2)}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase">Provider</label>
                <p className="text-sm text-text-main mt-1 capitalize">{selectedPayment.provider}</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase">Status</label>
                <p className="text-sm text-text-main mt-1">
                  <Badge variant={selectedPayment.status === 'success' ? 'success' : 'warning'}>
                    {selectedPayment.status}
                  </Badge>
                </p>
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-text-muted uppercase">Reference</label>
              <p className="text-sm text-text-main font-mono mt-1 break-all">{selectedPayment.provider_tx_ref}</p>
            </div>
            {selectedPayment.status === 'success' && (
              <div className="pt-4 border-t border-border flex gap-2">
                <Button
                  variant="danger"
                  onClick={() => {
                    setDetailModalOpen(false);
                    handleRefundClick(selectedPayment);
                  }}
                  className="flex-1"
                >
                  <Trash2 size={16} className="mr-2" />
                  Refund Payment
                </Button>
              </div>
            )}
          </div>
        )}
      </ConfirmModal>

      {/* Refund Modal */}
      <ConfirmModal
        isOpen={refundModalOpen}
        onClose={() => {
          setRefundModalOpen(false);
          setRefundReason('');
          setSelectedPayment(null);
        }}
        onConfirm={handleRefundConfirm}
        title="Refund Payment"
        message={`Refund ₦${selectedPayment?.amount_ngn.toFixed(2)} to ${selectedPayment?.user_email}? User will be reverted to free tier.`}
        confirmText="Refund"
        variant="danger"
        isLoading={refundMutation.isPending}
      >
        <div className="mt-4">
          <label className="block text-sm font-medium text-text-main mb-2">
            Reason (Required) <span className="text-error">*</span>
          </label>
          <textarea
            value={refundReason}
            onChange={(e) => setRefundReason(e.target.value)}
            className="w-full rounded-md border border-border bg-bg-main px-3 py-2 text-text-main placeholder-text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            rows={3}
            placeholder="Reason for refund (customer complaint, duplicate charge, etc.)..."
            required
          />
        </div>
      </ConfirmModal>

      {/* Cancel Subscription Modal */}
      <ConfirmModal
        isOpen={cancelModalOpen}
        onClose={() => {
          setCancelModalOpen(false);
          setCancelReason('');
          setSelectedPayment(null);
        }}
        onConfirm={handleCancelConfirm}
        title="Cancel Subscription"
        message={`Cancel subscription for ${selectedPayment?.user_email}? They will be reverted to free tier.`}
        confirmText="Cancel Subscription"
        variant="danger"
        isLoading={cancelMutation.isPending}
      >
        <div className="mt-4">
          <label className="block text-sm font-medium text-text-main mb-2">
            Reason (Required) <span className="text-error">*</span>
          </label>
          <textarea
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            className="w-full rounded-md border border-border bg-bg-main px-3 py-2 text-text-main placeholder-text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            rows={3}
            placeholder="Reason for cancellation..."
            required
          />
        </div>
      </ConfirmModal>
    </>
  );
}
