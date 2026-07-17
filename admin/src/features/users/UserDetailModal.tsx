import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import type { UserDetail, UserSessionsResponse, UserTransactionsResponse, UserActivityResponse, UserAdWatchResponse, UserWalletResponse, UserNotesResponse } from '@/lib/types';
import { Modal, Badge, Button, ShimmerLoader, ConfirmModal, Input } from '@/shared/components';
import { useAuthStore } from '@/store/auth';
import { DollarSign, Activity, Receipt, Calendar, User as UserIcon, Shield, Ban } from 'lucide-react';
import React from 'react';

interface UserDetailModalProps {
  userId: number | null;
  onClose: () => void;
}

export function UserDetailModal({ userId, onClose }: UserDetailModalProps) {
  const queryClient = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [activeTab, setActiveTab] = React.useState<'details' | 'sessions' | 'transactions' | 'activity' | 'ads' | 'wallet' | 'notes'>('details');
  const [adjustBalanceModalOpen, setAdjustBalanceModalOpen] = React.useState(false);
  const [banModalOpen, setBanModalOpen] = React.useState(false);
  const [unbanModalOpen, setUnbanModalOpen] = React.useState(false);
  const [balanceAmount, setBalanceAmount] = React.useState('');
  const [balanceReason, setBalanceReason] = React.useState('');

  const { data: user, isLoading: userLoading } = useQuery({
    queryKey: ['admin', 'users', userId],
    queryFn: async () => {
      if (!userId) return null;
      const { data } = await adminApi.get<UserDetail>(`/admin/users/${userId}`);
      return data;
    },
    enabled: !!userId,
    staleTime: 30_000,
  });

  const { data: sessions, isLoading: sessionsLoading } = useQuery({
    queryKey: ['admin', 'users', userId, 'sessions'],
    queryFn: async () => {
      if (!userId) return null;
      const { data } = await adminApi.get<UserSessionsResponse>(`/admin/users/${userId}/sessions`, {
        params: { page: 1, limit: 20 },
      });
      return data;
    },
    enabled: !!userId && activeTab === 'sessions',
    staleTime: 30_000,
  });

  const { data: transactions, isLoading: transactionsLoading } = useQuery({
    queryKey: ['admin', 'users', userId, 'transactions'],
    queryFn: async () => {
      if (!userId) return null;
      const { data } = await adminApi.get<UserTransactionsResponse>(`/admin/users/${userId}/transactions`, {
        params: { page: 1, limit: 20 },
      });
      return data;
    },
    enabled: !!userId && activeTab === 'transactions',
    staleTime: 30_000,
  });

  const { data: activity, isLoading: activityLoading } = useQuery({
    queryKey: ['admin', 'users', userId, 'activity'],
    queryFn: async () => {
      if (!userId) return null;
      const { data } = await adminApi.get<UserActivityResponse>(`/admin/users/${userId}/activity`, {
        params: { limit: 50 },
      });
      return data;
    },
    enabled: !!userId && activeTab === 'activity',
    staleTime: 30_000,
  });

  const { data: ads, isLoading: adsLoading } = useQuery({
    queryKey: ['admin', 'users', userId, 'ads'],
    queryFn: async () => {
      if (!userId) return null;
      const { data } = await adminApi.get<UserAdWatchResponse>(`/admin/users/${userId}/ads`, {
        params: { limit: 50 },
      });
      return data;
    },
    enabled: !!userId && activeTab === 'ads',
    staleTime: 30_000,
  });

  const { data: wallet, isLoading: walletLoading } = useQuery({
    queryKey: ['admin', 'users', userId, 'wallet'],
    queryFn: async () => {
      if (!userId) return null;
      const { data } = await adminApi.get<UserWalletResponse>(`/admin/users/${userId}/wallet`, {
        params: { limit: 100 },
      });
      return data;
    },
    enabled: !!userId && activeTab === 'wallet',
    staleTime: 30_000,
  });

  const { data: notes, isLoading: notesLoading } = useQuery({
    queryKey: ['admin', 'users', userId, 'notes'],
    queryFn: async () => {
      if (!userId) return null;
      const { data } = await adminApi.get<UserNotesResponse>(`/admin/users/${userId}/notes`);
      return data;
    },
    enabled: !!userId && activeTab === 'notes',
    staleTime: 30_000,
  });

  const addNoteMutation = useMutation({
    mutationFn: async ({ userId, note }: { userId: number; note: string }) => {
      await adminApi.post(`/admin/users/${userId}/notes`, null, { params: { note } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users', userId, 'notes'] });
    },
  });

  const deleteNoteMutation = useMutation({
    mutationFn: async (noteId: number) => {
      await adminApi.delete(`/admin/users/notes/${noteId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users', userId, 'notes'] });
    },
  });

  const [newNote, setNewNote] = React.useState('');

  const handleAddNote = () => {
    if (!userId || !newNote.trim()) return;
    addNoteMutation.mutate({ userId, note: newNote.trim() });
    setNewNote('');
  };

  const adjustBalanceMutation = useMutation({
    mutationFn: async ({ userId, amount, reason }: { userId: number; amount: number; reason: string }) => {
      await adminApi.post(`/admin/users/${userId}/adjust-balance`, null, {
        params: { amount, reason },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      setAdjustBalanceModalOpen(false);
      setBalanceAmount('');
      setBalanceReason('');
    },
  });

  const banMutation = useMutation({
    mutationFn: async ({ userId, reason }: { userId: number; reason: string }) => {
      await adminApi.post(`/admin/users/${userId}/ban`, null, { params: { reason } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      setBanModalOpen(false);
    },
  });

  const unbanMutation = useMutation({
    mutationFn: async (userId: number) => {
      await adminApi.post(`/admin/users/${userId}/unban`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      setUnbanModalOpen(false);
    },
  });

  const handleAdjustBalanceConfirm = () => {
    if (!userId || !balanceAmount || !balanceReason) return;
    const amount = parseInt(balanceAmount, 10);
    if (isNaN(amount)) return;
    adjustBalanceMutation.mutate({ userId, amount, reason: balanceReason });
  };

  const handleBanConfirm = (reason?: string) => {
    if (!userId || !reason) return;
    banMutation.mutate({ userId, reason });
  };

  const handleUnbanConfirm = () => {
    if (!userId) return;
    unbanMutation.mutate(userId);
  };

  if (!userId) return null;

  return (
    <Modal
      isOpen={!!userId}
      onClose={onClose}
      title={user ? `User: ${user.email}` : 'User Details'}
    >
      <div className="space-y-4">
        {/* Tabs */}
        <div className="flex gap-2 border-b border-border">
          <button
            onClick={() => setActiveTab('details')}
            className={`cursor-pointer px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'details'
                ? 'border-b-2 border-primary text-primary'
                : 'text-text-muted hover:text-text-main'
            }`}
          >
            <UserIcon size={16} className="mr-1.5 inline" />
            Details
          </button>
          <button
            onClick={() => setActiveTab('sessions')}
            className={`cursor-pointer px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'sessions'
                ? 'border-b-2 border-primary text-primary'
                : 'text-text-muted hover:text-text-main'
            }`}
          >
            <Activity size={16} className="mr-1.5 inline" />
            Sessions
          </button>
          <button
            onClick={() => setActiveTab('transactions')}
            className={`cursor-pointer px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'transactions'
                ? 'border-b-2 border-primary text-primary'
                : 'text-text-muted hover:text-text-main'
            }`}
          >
            <Receipt size={16} className="mr-1.5 inline" />
            Transactions
          </button>
          <button
            onClick={() => setActiveTab('activity')}
            className={`cursor-pointer px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'activity'
                ? 'border-b-2 border-primary text-primary'
                : 'text-text-muted hover:text-text-main'
            }`}
          >
            <Calendar size={16} className="mr-1.5 inline" />
            Activity
          </button>
          <button
            onClick={() => setActiveTab('ads')}
            className={`cursor-pointer px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'ads'
                ? 'border-b-2 border-primary text-primary'
                : 'text-text-muted hover:text-text-main'
            }`}
          >
            <DollarSign size={16} className="mr-1.5 inline" />
            Ads
          </button>
          <button
            onClick={() => setActiveTab('wallet')}
            className={`cursor-pointer px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'wallet'
                ? 'border-b-2 border-primary text-primary'
                : 'text-text-muted hover:text-text-main'
            }`}
          >
            <Receipt size={16} className="mr-1.5 inline" />
            Wallet
          </button>
          <button
            onClick={() => setActiveTab('notes')}
            className={`cursor-pointer px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'notes'
                ? 'border-b-2 border-primary text-primary'
                : 'text-text-muted hover:text-text-main'
            }`}
          >
            <Activity size={16} className="mr-1.5 inline" />
            Notes
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'details' && (
          <>
            {userLoading && <ShimmerLoader lines={6} />}
            {user && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-text-muted">ID:</span>
                    <p className="font-medium text-text-main">{user.id}</p>
                  </div>
                  <div>
                    <span className="text-text-muted">Email:</span>
                    <p className="font-medium text-text-main">{user.email}</p>
                  </div>
                  <div>
                    <span className="text-text-muted">Phone:</span>
                    <p className="font-medium text-text-main">{user.phone || '-'}</p>
                  </div>
                  <div>
                    <span className="text-text-muted">Tier:</span>
                    <p className="font-medium text-text-main">
                      <Badge variant="neutral">{user.tier}</Badge>
                    </p>
                  </div>
                  <div>
                    <span className="text-text-muted">Status:</span>
                    <p className="font-medium text-text-main">
                      <Badge variant={user.status === 'active' ? 'success' : 'error'}>{user.status}</Badge>
                    </p>
                  </div>
                  <div>
                    <span className="text-text-muted">Points Balance:</span>
                    <p className="font-medium text-text-main">{user.points_balance.toLocaleString()}</p>
                  </div>
                  <div>
                    <span className="text-text-muted">Referral Code:</span>
                    <p className="font-medium text-text-main">{user.referral_code || '-'}</p>
                  </div>
                  <div>
                    <span className="text-text-muted">Referred By:</span>
                    <p className="font-medium text-text-main">{user.referred_by || '-'}</p>
                  </div>
                  <div>
                    <span className="text-text-muted">Created:</span>
                    <p className="font-medium text-text-main">
                      <Calendar size={14} className="mr-1 inline" />
                      {new Date(user.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div>
                    <span className="text-text-muted">Last Active:</span>
                    <p className="font-medium text-text-main">
                      {user.last_active_at ? new Date(user.last_active_at).toLocaleDateString() : '-'}
                    </p>
                  </div>
                  {user.subscription_expires_at && (
                    <div className="col-span-2">
                      <span className="text-text-muted">Subscription Expires:</span>
                      <p className="font-medium text-text-main">
                        {new Date(user.subscription_expires_at).toLocaleDateString()}
                      </p>
                    </div>
                  )}
                </div>

                {hasPermission('users.adjust_balance') && (
                  <div className="mt-4 flex justify-end gap-2">
                    <Button
                      onClick={() => setAdjustBalanceModalOpen(true)}
                      variant="secondary"
                      disabled={adjustBalanceMutation.isPending}
                    >
                      <DollarSign size={16} />
                      Adjust Balance
                    </Button>
                    {hasPermission('users.ban') && user.status === 'active' && (
                      <Button
                        onClick={() => setBanModalOpen(true)}
                        variant="danger"
                        disabled={banMutation.isPending}
                      >
                        <Shield size={16} />
                        Ban User
                      </Button>
                    )}
                    {hasPermission('users.ban') && user.status === 'banned' && (
                      <Button
                        onClick={() => setUnbanModalOpen(true)}
                        variant="secondary"
                        disabled={unbanMutation.isPending}
                      >
                        <Ban size={16} />
                        Unban User
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {activeTab === 'sessions' && (
          <>
            {sessionsLoading && <ShimmerLoader lines={5} />}
            {sessions && sessions.items.length > 0 && (
              <div className="max-h-96 overflow-y-auto">
                <table className="min-w-full divide-y divide-border text-sm">
                  <thead className="bg-bg-muted sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-text-muted">Content ID</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-text-muted">Duration</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-text-muted">Points</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-text-muted">Verified</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-text-muted">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {sessions.items.map((session) => (
                      <tr key={session.id} className="hover:bg-bg-hover">
                        <td className="px-3 py-2">{session.content_id}</td>
                        <td className="px-3 py-2">{Math.round(session.duration_seconds / 60)}m</td>
                        <td className="px-3 py-2">{session.points_earned}</td>
                        <td className="px-3 py-2">
                          <Badge variant={session.verified ? 'success' : 'warning'}>
                            {session.verified ? 'Yes' : 'No'}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">{new Date(session.start_time).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-text-muted">
                  Showing {sessions.items.length} of {sessions.total} sessions
                </p>
              </div>
            )}
            {sessions && sessions.items.length === 0 && (
              <p className="text-center text-text-muted">No sessions found</p>
            )}
          </>
        )}

        {activeTab === 'transactions' && (
          <>
            {transactionsLoading && <ShimmerLoader lines={5} />}
            {transactions && transactions.items.length > 0 && (
              <div className="max-h-96 overflow-y-auto">
                <table className="min-w-full divide-y divide-border text-sm">
                  <thead className="bg-bg-muted sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-text-muted">Type</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-text-muted">ID</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-text-muted">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {transactions.items.map((txn, idx) => (
                      <tr key={`${txn.type}-${txn.id}-${idx}`} className="hover:bg-bg-hover">
                        <td className="px-3 py-2">
                          <Badge variant="neutral">{txn.type}</Badge>
                        </td>
                        <td className="px-3 py-2">{txn.id}</td>
                        <td className="px-3 py-2">{new Date(txn.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-text-muted">
                  Showing {transactions.items.length} of {transactions.total} transactions
                </p>
              </div>
            )}
            {transactions && transactions.items.length === 0 && (
              <p className="text-center text-text-muted">No transactions found</p>
            )}
          </>
        )}

        {activeTab === 'activity' && (
          <>
            {activityLoading && <ShimmerLoader lines={6} />}
            {activity && activity.items.length > 0 && (
              <div className="max-h-96 space-y-3 overflow-y-auto">
                {activity.items.map((ev) => (
                  <div
                    key={`${ev.type}-${ev.id}`}
                    className="flex items-start gap-3 rounded-md border border-border bg-bg-muted p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text-main">{ev.summary}</p>
                      {ev.detail && (
                        <p className="mt-0.5 text-xs text-text-muted">{ev.detail}</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <Badge variant="neutral">{ev.type.replace('_', ' ')}</Badge>
                      {ev.timestamp && (
                        <p className="mt-1 text-xs text-text-muted">
                          {new Date(ev.timestamp).toLocaleString()}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {activity && activity.items.length === 0 && (
              <p className="text-center text-text-muted">No activity found</p>
            )}
          </>
        )}

        {activeTab === 'ads' && (
          <>
            {adsLoading && <ShimmerLoader lines={5} />}
            {ads && ads.items.length > 0 && (
              <div className="max-h-96 overflow-y-auto">
                <table className="min-w-full divide-y divide-border text-sm">
                  <thead className="bg-bg-muted sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-text-muted">Ad Unit</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-text-muted">Provider</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-text-muted">Watched</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-text-muted">Points</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-text-muted">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {ads.items.map((ad) => (
                      <tr key={ad.id} className="hover:bg-bg-hover">
                        <td className="px-3 py-2">{ad.ad_unit || '-'}</td>
                        <td className="px-3 py-2">{ad.provider || '-'}</td>
                        <td className="px-3 py-2">
                          <Badge variant={ad.watched_fully ? 'success' : 'warning'}>
                            {ad.watched_fully ? 'Yes' : 'No'}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">{ad.points_credited}</td>
                        <td className="px-3 py-2">
                          {ad.created_at ? new Date(ad.created_at).toLocaleString() : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {ads && ads.items.length === 0 && (
              <p className="text-center text-text-muted">No ads watched</p>
            )}
          </>
        )}

        {activeTab === 'wallet' && (
          <>
            {walletLoading && <ShimmerLoader lines={6} />}
            {wallet && (
              <>
                <p className="mb-2 text-sm text-text-muted">
                  Current balance: <span className="font-semibold text-text-main">{wallet.current_balance.toLocaleString()}</span> pts
                </p>
                <div className="max-h-96 space-y-2 overflow-y-auto">
                  {wallet.items.map((entry) => (
                    <div
                      key={`${entry.type}-${entry.id}`}
                      className="flex items-start gap-3 rounded-md border border-border bg-bg-muted p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-text-main">{entry.detail}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <Badge
                          variant={
                            entry.type === 'ad_credit'
                              ? 'success'
                              : entry.type === 'payout' || entry.type === 'payment'
                                ? 'error'
                                : 'neutral'
                          }
                        >
                          {entry.type.replace('_', ' ')}
                        </Badge>
                        {entry.delta !== null && (
                          <p className={`mt-1 text-xs ${entry.delta >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {entry.delta >= 0 ? '+' : ''}{entry.delta.toLocaleString()}
                          </p>
                        )}
                        {entry.timestamp && (
                          <p className="mt-1 text-xs text-text-muted">
                            {new Date(entry.timestamp).toLocaleString()}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {wallet && wallet.items.length === 0 && (
              <p className="text-center text-text-muted">No wallet history</p>
            )}
          </>
        )}

        {activeTab === 'notes' && (
          <>
            {notesLoading && <ShimmerLoader lines={4} />}
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  label="New note"
                  placeholder="Add a note about this user..."
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  className="flex-1"
                />
                <Button
                  variant="primary"
                  className="mt-6"
                  onClick={handleAddNote}
                  disabled={addNoteMutation.isPending || !newNote.trim()}
                  loading={addNoteMutation.isPending}
                >
                  Add
                </Button>
              </div>
              {notes && notes.items.length > 0 && (
                <div className="space-y-2">
                  {notes.items.map((n) => (
                    <div
                      key={n.id}
                      className="flex items-start justify-between gap-3 rounded-md border border-border bg-bg-muted p-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-text-main whitespace-pre-wrap">{n.note}</p>
                        <p className="mt-1 text-xs text-text-muted">
                          {n.admin_email || 'admin'} · {n.created_at ? new Date(n.created_at).toLocaleString() : ''}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => deleteNoteMutation.mutate(n.id)}
                        disabled={deleteNoteMutation.isPending}
                      >
                        Delete
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {notes && notes.items.length === 0 && !notesLoading && (
                <p className="text-center text-text-muted">No notes yet</p>
              )}
            </div>
          </>
        )}
      </div>

      {/* Adjust Balance Modal */}
      <Modal
        isOpen={adjustBalanceModalOpen}
        onClose={() => {
          setAdjustBalanceModalOpen(false);
          setBalanceAmount('');
          setBalanceReason('');
        }}
        title="Adjust User Balance"
      >
        <div className="space-y-4">
          <p className="text-text-main">Enter the amount to adjust (positive to add, negative to subtract) and provide a reason.</p>
          <Input
            label="Amount"
            type="number"
            placeholder="e.g., 100 or -50"
            value={balanceAmount}
            onChange={(e) => setBalanceAmount(e.target.value)}
            autoFocus
          />
          <Input
            label="Reason"
            placeholder="Enter reason for adjustment..."
            value={balanceReason}
            onChange={(e) => setBalanceReason(e.target.value)}
          />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="secondary"
              onClick={() => {
                setAdjustBalanceModalOpen(false);
                setBalanceAmount('');
                setBalanceReason('');
              }}
              disabled={adjustBalanceMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleAdjustBalanceConfirm}
              disabled={adjustBalanceMutation.isPending || !balanceAmount || !balanceReason}
              loading={adjustBalanceMutation.isPending}
            >
              Adjust Balance
            </Button>
          </div>
        </div>
      </Modal>

      {/* Ban Modal */}
      <ConfirmModal
        isOpen={banModalOpen}
        onClose={() => setBanModalOpen(false)}
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

      {/* Unban Modal */}
      <ConfirmModal
        isOpen={unbanModalOpen}
        onClose={() => setUnbanModalOpen(false)}
        onConfirm={handleUnbanConfirm}
        title="Unban User"
        message="Are you sure you want to unban this user? They will regain access to the platform."
        confirmText="Unban User"
        cancelText="Cancel"
        variant="primary"
        isLoading={unbanMutation.isPending}
      />
    </Modal>
  );
}
