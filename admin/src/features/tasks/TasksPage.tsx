import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { useState } from 'react';
import { Card, StatCard, Badge, Button, Pagination, ShimmerLoader, Container, Tooltip } from '@/shared/components';
import { TopHeader } from '@/shared/components/TopHeader';
import { useLayoutContext } from '@/shared/components/Layout';
import { useAuthStore } from '@/store/auth';
import { CheckCircle, XCircle } from 'lucide-react';

interface SponsorKYC {
  sponsor_id: number;
  user_email: string;
  user_phone: string | null;
  business_name: string;
  business_type: string | null;
  business_registration_number: string | null;
  id_document_type: string | null;
  id_document_number: string | null;
  id_document_url: string | null;
  business_document_url: string | null;
  contact_person_name: string | null;
  contact_person_phone: string | null;
  contact_person_email: string | null;
  submitted_at: string;
  status: string;
}

interface FlaggedSubmission {
  submission_id: number;
  task_id: number;
  task_title: string;
  worker_id: number;
  worker_email: string;
  proof_type: string;
  proof_url: string | null;
  proof_image_url: string | null;
  proof_text: string | null;
  status: string;
  ai_confidence: number | null;
  fraud_score: number;
  flagged_for_review: boolean;
  duplicate_screenshot_detected: boolean;
  submitted_at: string;
  reward_amount: number;
}

interface TaskAnalytics {
  period_days: number;
  tasks: {
    total: number;
    active: number;
    completed: number;
  };
  submissions: {
    total: number;
    approved: number;
    pending: number;
    approval_rate: number;
  };
  revenue: {
    platform_fee_collected: number;
    total_paid_to_workers: number;
    net_margin: number;
  };
  users: {
    total_workers: number;
    total_sponsors: number;
    verified_sponsors: number;
    pending_kyc: number;
  };
}

export function TasksPage() {
  const { onMenuClick } = useLayoutContext();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [tab, setTab] = useState<'kyc' | 'submissions' | 'analytics'>('kyc');
  const [kycPage, setKycPage] = useState(1);
  const [submissionsPage, setSubmissionsPage] = useState(1);

  const queryClient = useQueryClient();

  // Fetch pending KYC
  const { data: kyc, isLoading: kycLoading } = useQuery({
    queryKey: ['admin', 'tasks', 'kyc', kycPage],
    queryFn: async () => {
      const { data } = await adminApi.get<{ items: SponsorKYC[]; total: number; page: number; limit: number }>('/admin/tasks/kyc/pending', {
        params: { page: kycPage, limit: 50 },
      });
      return data;
    },
    staleTime: 30_000,
    enabled: tab === 'kyc',
  });

  // Fetch flagged submissions
  const { data: submissions, isLoading: submissionsLoading } = useQuery({
    queryKey: ['admin', 'tasks', 'submissions', submissionsPage],
    queryFn: async () => {
      const { data } = await adminApi.get<{ items: FlaggedSubmission[]; total: number; page: number; limit: number }>('/admin/tasks/submissions/flagged', {
        params: { page: submissionsPage, limit: 50 },
      });
      return data;
    },
    staleTime: 30_000,
    enabled: tab === 'submissions',
  });

  // Fetch task analytics
  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['admin', 'tasks', 'analytics'],
    queryFn: async () => {
      const { data } = await adminApi.get<TaskAnalytics>('/admin/tasks/analytics', {
        params: { days: 30 },
      });
      return data;
    },
    staleTime: 60_000,
    enabled: tab === 'analytics',
  });

  // KYC mutations
  const approveKycMutation = useMutation({
    mutationFn: async (sponsorId: number) => {
      const notes = prompt('Approval notes (optional):');
      await adminApi.post(`/admin/tasks/kyc/${sponsorId}/approve`, null, { params: { admin_notes: notes || undefined } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'tasks', 'kyc'] });
    },
  });

  const rejectKycMutation = useMutation({
    mutationFn: async ({ sponsorId, reason }: { sponsorId: number; reason: string }) => {
      await adminApi.post(`/admin/tasks/kyc/${sponsorId}/reject`, null, { params: { reason } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'tasks', 'kyc'] });
    },
  });

  // Submission mutations
  const approveSubmissionMutation = useMutation({
    mutationFn: async (submissionId: number) => {
      const notes = prompt('Approval notes (optional):');
      await adminApi.post(`/admin/tasks/submissions/${submissionId}/approve`, null, { params: { notes: notes || undefined } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'tasks', 'submissions'] });
    },
  });

  const rejectSubmissionMutation = useMutation({
    mutationFn: async ({ submissionId, reason }: { submissionId: number; reason: string }) => {
      await adminApi.post(`/admin/tasks/submissions/${submissionId}/reject`, null, { params: { reason } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'tasks', 'submissions'] });
    },
  });

  const handleApproveKyc = (sponsorId: number) => {
    if (confirm('Approve this KYC application?')) {
      approveKycMutation.mutate(sponsorId);
    }
  };

  const handleRejectKyc = (sponsorId: number) => {
    const reason = prompt('Rejection reason:');
    if (reason && reason.length >= 10) {
      rejectKycMutation.mutate({ sponsorId, reason });
    } else if (reason) {
      alert('Reason must be at least 10 characters');
    }
  };

  const handleApproveSubmission = (submissionId: number) => {
    if (confirm('Approve this task submission?')) {
      approveSubmissionMutation.mutate(submissionId);
    }
  };

  const handleRejectSubmission = (submissionId: number) => {
    const reason = prompt('Rejection reason:');
    if (reason && reason.length >= 10) {
      rejectSubmissionMutation.mutate({ submissionId, reason });
    } else if (reason) {
      alert('Reason must be at least 10 characters');
    }
  };

  return (
    <>
      <TopHeader
        title="Tasks Platform"
        subtitle="Manage Phase 7 social tasks marketplace"
        onMenuClick={onMenuClick}
        actions={
          <div className="flex rounded-lg border border-border">
            <button
              onClick={() => setTab('kyc')}
              className={`px-4 py-1.5 text-sm font-semibold transition-colors ${tab === 'kyc' ? 'bg-primary text-white' : 'text-text-muted hover:text-text-main'}`}
            >
              KYC
            </button>
            <button
              onClick={() => setTab('submissions')}
              className={`px-4 py-1.5 text-sm font-semibold transition-colors ${tab === 'submissions' ? 'bg-primary text-white' : 'text-text-muted hover:text-text-main'}`}
            >
              Submissions
            </button>
            <button
              onClick={() => setTab('analytics')}
              className={`px-4 py-1.5 text-sm font-semibold transition-colors ${tab === 'analytics' ? 'bg-primary text-white' : 'text-text-muted hover:text-text-main'}`}
            >
              Analytics
            </button>
          </div>
        }
      />
      <Container size="full">
        {tab === 'kyc' && (
          <div>
            {kycLoading && <ShimmerLoader lines={5} />}
            {kyc && (
              <Card>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-border">
                    <thead className="bg-bg-muted">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Sponsor ID</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Email</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Business</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Type</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Contact</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Submitted</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {kyc.items.map((k) => (
                        <tr key={k.sponsor_id} className="hover:bg-bg-hover">
                          <td className="px-4 py-3 text-sm text-text-main">{k.sponsor_id}</td>
                          <td className="px-4 py-3 text-sm text-text-main">{k.user_email}</td>
                          <td className="px-4 py-3 text-sm text-text-main">{k.business_name}</td>
                          <td className="px-4 py-3 text-sm text-text-main">{k.business_type || '-'}</td>
                          <td className="px-4 py-3 text-sm text-text-main">{k.contact_person_name || '-'}</td>
                          <td className="px-4 py-3 text-sm text-text-main">{new Date(k.submitted_at).toLocaleDateString()}</td>
                          <td className="px-4 py-3 text-sm text-text-main">
                            {hasPermission('tasks.kyc') && (
                              <div className="flex gap-2">
                                <Tooltip content="Approve KYC application" position="top">
                                  <Button size="sm" variant="secondary" onClick={() => handleApproveKyc(k.sponsor_id)}>
                                    <CheckCircle size={14} /> Approve
                                  </Button>
                                </Tooltip>
                                <Tooltip content="Reject KYC application" position="top">
                                  <Button size="sm" variant="danger" onClick={() => handleRejectKyc(k.sponsor_id)}>
                                    <XCircle size={14} /> Reject
                                  </Button>
                                </Tooltip>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="p-4 sm:p-6">
                  <Pagination page={kycPage} totalPages={Math.ceil(kyc.total / 50)} onPageChange={setKycPage} />
                </div>
              </Card>
            )}
          </div>
        )}

        {tab === 'submissions' && (
          <div>
            {submissionsLoading && <ShimmerLoader lines={5} />}
            {submissions && (
              <Card>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-border">
                    <thead className="bg-bg-muted">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">ID</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Task</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Worker</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Proof</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">AI Confidence</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Fraud Score</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {submissions.items.map((s) => (
                        <tr key={s.submission_id} className="hover:bg-bg-hover">
                          <td className="px-4 py-3 text-sm text-text-main">{s.submission_id}</td>
                          <td className="px-4 py-3 text-sm text-text-main">{s.task_title}</td>
                          <td className="px-4 py-3 text-sm text-text-main">{s.worker_email}</td>
                          <td className="px-4 py-3 text-sm text-text-main">{s.proof_type}</td>
                          <td className="px-4 py-3 text-sm text-text-main">{s.ai_confidence ? `${(s.ai_confidence * 100).toFixed(1)}%` : '-'}</td>
                          <td className="px-4 py-3 text-sm text-text-main">
                            <Badge variant={s.fraud_score > 70 ? 'error' : s.fraud_score > 40 ? 'warning' : 'neutral'}>
                              {s.fraud_score}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-sm text-text-main">
                            <Badge variant={s.status === 'approved' ? 'success' : s.status === 'rejected' ? 'error' : 'warning'}>
                              {s.status}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-sm text-text-main">
                            {hasPermission('tasks.review') && s.status === 'pending' && (
                              <div className="flex gap-2">
                                <Tooltip content="Approve this submission" position="top">
                                  <Button size="sm" variant="secondary" onClick={() => handleApproveSubmission(s.submission_id)}>
                                    <CheckCircle size={14} /> Approve
                                  </Button>
                                </Tooltip>
                                <Tooltip content="Reject this submission" position="top">
                                  <Button size="sm" variant="danger" onClick={() => handleRejectSubmission(s.submission_id)}>
                                    <XCircle size={14} /> Reject
                                  </Button>
                                </Tooltip>
                              </div>
                            )}
                            {s.status !== 'pending' && <span className="text-text-muted">-</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="p-4 sm:p-6">
                  <Pagination page={submissionsPage} totalPages={Math.ceil(submissions.total / 50)} onPageChange={setSubmissionsPage} />
                </div>
              </Card>
            )}
          </div>
        )}

        {tab === 'analytics' && (
          <div className="space-y-6">
            {analyticsLoading && <ShimmerLoader lines={6} />}
            {analytics && (
              <>
                <div>
                  <h3 className="mb-4 text-lg font-semibold text-text-main">Platform Overview</h3>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <StatCard label="Total Tasks" value={analytics.tasks.total.toLocaleString()} />
                    <StatCard label="Active Tasks" value={analytics.tasks.active.toLocaleString()} />
                    <StatCard label="Completed Tasks" value={analytics.tasks.completed.toLocaleString()} />
                    <StatCard label="Approval Rate" value={`${analytics.submissions.approval_rate.toFixed(1)}%`} />
                  </div>
                </div>

                <div>
                  <h3 className="mb-4 text-lg font-semibold text-text-main">Submissions (Last {analytics.period_days} days)</h3>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <StatCard label="Total Submissions" value={analytics.submissions.total.toLocaleString()} />
                    <StatCard label="Approved" value={analytics.submissions.approved.toLocaleString()} />
                    <StatCard label="Pending Review" value={analytics.submissions.pending.toLocaleString()} />
                  </div>
                </div>

                <div>
                  <h3 className="mb-4 text-lg font-semibold text-text-main">Revenue</h3>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <StatCard label="Platform Fees" value={`₦${(analytics.revenue.platform_fee_collected / 100).toLocaleString()}`} />
                    <StatCard label="Paid to Workers" value={`₦${(analytics.revenue.total_paid_to_workers / 100).toLocaleString()}`} />
                    <StatCard label="Net Margin" value={`₦${(analytics.revenue.net_margin / 100).toLocaleString()}`} />
                  </div>
                </div>

                <div>
                  <h3 className="mb-4 text-lg font-semibold text-text-main">Users</h3>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <StatCard label="Workers" value={analytics.users.total_workers.toLocaleString()} />
                    <StatCard label="Sponsors" value={analytics.users.total_sponsors.toLocaleString()} />
                    <StatCard label="Verified Sponsors" value={analytics.users.verified_sponsors.toLocaleString()} />
                    <StatCard label="Pending KYC" value={analytics.users.pending_kyc.toLocaleString()} />
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </Container>
    </>
  );
}
