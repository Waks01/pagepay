import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { useState } from 'react';
import { Card, StatCard, Badge, Button, Pagination, ShimmerLoader, Container, Tooltip, Modal, Select } from '@/shared/components';
import { TopHeader } from '@/shared/components/TopHeader';
import { useLayoutContext } from '@/shared/components/Layout';
import { useAuthStore } from '@/store/auth';
import { useToast } from '@/shared/hooks/use-toast';
import { Input } from '@/shared/components/Input';
import { ConfirmModal } from '@/shared/components/ConfirmModal';
import { CheckCircle, XCircle, Plus, Trash2, Pencil, ListTodo, Briefcase, Inbox } from 'lucide-react';

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

interface AdminTask {
  id: number;
  title: string;
  task_type: string;
  platform: string;
  category: string;
  task_source: string;
  reward_type: string;
  reward_amount: number;
  max_completions: number;
  completed_count: number;
  status: string;
  expires_at: string | null;
  created_at: string;
}

interface TaskCreateForm {
  title: string;
  description: string;
  instructions: string;
  // Backend TaskCreateRequest uses these schema-defined Literals. The
  // platform "web" (not "website") and the task_type list below are
  // validated by FastAPI — using anything outside the Literal returns 422.
  task_type: string;
  platform: string;
  proof_type: string;
  target_url: string;
  reward_amount: string; // admin input in NGN; backend expects kobo (×100)
  max_completions: string;
  expires_in_days: string;
}

// Human label for a `task_type` code like "youtube_subscribe".
// Splits on "_", title-cases each piece, and joins platform · action
// so admin users see "YouTube · Subscribe" rather than "youtube_subscribe".
// Defensive: returns the raw string if the format is unexpected.
function formatTaskType(t: string): string {
  const parts = t.split('_').map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  if (parts.length <= 1) return parts.join(' ') || t;
  return `${parts[0]} · ${parts.slice(1).join(' ')}`;
}

// Subset of the TaskCreateRequest Literal that an admin is most likely to
// create. Defaults to YouTube since the form's default platform is YouTube.
const TASK_TYPES = [
  'youtube_subscribe',
  'youtube_like',
  'youtube_watch',
  'youtube_comment',
  'twitter_follow',
  'instagram_follow',
  'tiktok_follow',
  'facebook_follow',
  'website_visit',
  'app_download',
  'survey',
  'custom',
] as const;

const PROOF_TYPES = ['screenshot', 'link', 'text', 'photo', 'video'] as const;

const DEFAULT_PLATFORMS = [
  'youtube',
  'instagram',
  'twitter',
  'tiktok',
  'facebook',
  'web',
];

const EMPTY_FORM: TaskCreateForm = {
  title: '',
  description: '',
  instructions: '',
  task_type: 'youtube_subscribe',
  platform: 'youtube',
  proof_type: 'screenshot',
  target_url: '',
  reward_amount: '100',
  max_completions: '500',
  expires_in_days: '30',
};

/**
 * Empty-state panel — rendered when a list query has returned 0 items.
 * Same component drives all three tabs so the visual language stays
 * consistent. The icon + title + body copy + primary CTA are configurable
 * so each tab can specialize without re-implementing the layout.
 */
function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <Card>
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-bg-muted text-text-muted">
          {icon}
        </div>
        <h3 className="mb-1 text-base font-semibold text-text-main">{title}</h3>
        <p className="max-w-sm text-sm text-text-muted">{description}</p>
        {actionLabel && onAction && (
          <div className="mt-6">
            <Button variant="primary" onClick={onAction}>
              {actionLabel}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

export function TasksPage() {
  const { onMenuClick } = useLayoutContext();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'tasks' | 'kyc' | 'submissions' | 'analytics'>('tasks');
  const [kycPage, setKycPage] = useState(1);
  const [submissionsPage, setSubmissionsPage] = useState(1);
  const [tasksPage, setTasksPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<TaskCreateForm>(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  // Fetch task list
  const { data: tasks, isLoading: tasksLoading } = useQuery({
    queryKey: ['admin', 'tasks', 'list', tasksPage],
    queryFn: async () => {
      const { data } = await adminApi.get<{ items: AdminTask[]; total: number; page: number; limit: number }>(
        '/admin/tasks/admin/list',
        { params: { page: tasksPage, limit: 50 } },
      );
      return data;
    },
    staleTime: 30_000,
    enabled: tab === 'tasks',
  });

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
      toast.success('KYC approved');
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'Failed to approve KYC'),
  });

  const rejectKycMutation = useMutation({
    mutationFn: async ({ sponsorId, reason }: { sponsorId: number; reason: string }) => {
      await adminApi.post(`/admin/tasks/kyc/${sponsorId}/reject`, null, { params: { reason } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'tasks', 'kyc'] });
      toast.success('KYC rejected');
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'Failed to reject KYC'),
  });

  // Submission mutations
  const approveSubmissionMutation = useMutation({
    mutationFn: async (submissionId: number) => {
      const notes = prompt('Approval notes (optional):');
      await adminApi.post(`/admin/tasks/submissions/${submissionId}/approve`, null, { params: { notes: notes || undefined } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'tasks', 'submissions'] });
      toast.success('Submission approved');
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'Failed to approve submission'),
  });

  const rejectSubmissionMutation = useMutation({
    mutationFn: async ({ submissionId, reason }: { submissionId: number; reason: string }) => {
      await adminApi.post(`/admin/tasks/submissions/${submissionId}/reject`, null, { params: { reason } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'tasks', 'submissions'] });
      toast.success('Submission rejected');
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'Failed to reject submission'),
  });

  // Task management mutations
  const createTaskMutation = useMutation({
    mutationFn: async (payload: TaskCreateForm) => {
      // Backend uses AdminTaskCreateRequest (see
      // `backend/app/schemas/__init__.py`). That schema intentionally
      // diverges from the sponsor TaskCreateRequest — admin tasks are
      // funded from an internal pool so business-policy bounds (₦50
      // floor on reward, 500-completion minimum) don't apply. Schema
      // still enforces:
      //   - `title` ≥ 5 chars, `description`/`instructions` ≥ 20 chars
      //   - `reward_amount_kobo` (NOT naira), ≥ 100 kobo (₦1)
      //   - `max_completions` ≥ 1
      //   - `task_type` / `platform` / `proof_type` from Literal lists
      // The form's NGN input gets multiplied by 100 here.
      const naira = parseInt(payload.reward_amount, 10);
      const body = {
        title: payload.title,
        description: payload.description,
        instructions: payload.instructions,
        task_type: payload.task_type,
        platform: payload.platform,
        category: 'social_media',
        target_url: payload.target_url || undefined,
        proof_type: payload.proof_type,
        reward_amount_kobo: Number.isFinite(naira) ? naira * 100 : 0,
        reward_multiplier: 1.0,
        max_completions: parseInt(payload.max_completions, 10),
        expires_in_days: parseInt(payload.expires_in_days, 10),
      };
      console.log('[createTask] payload →', JSON.stringify(body));
      const { data } = await adminApi.post<{ success: boolean; task_id: number }>(
        '/admin/tasks/admin/create',
        body,
      );
      console.log('[createTask] response ←', JSON.stringify(data));
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'tasks', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'tasks', 'analytics'] });
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      toast.success(`Task created (id #${data.task_id})`);
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail;
      console.error(
        '[createTask] ← ERROR',
        'status=' + err?.response?.status,
        'detail=' + JSON.stringify(err?.response?.data?.detail),
      );
      toast.error(typeof detail === 'string' ? detail : 'Failed to create task');
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (taskId: number) => {
      await adminApi.delete(`/admin/tasks/admin/${taskId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'tasks', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'tasks', 'analytics'] });
      setDeleteId(null);
      toast.success('Task deleted');
    },
    onError: (err: any) => {
      setDeleteId(null);
      toast.error(err?.response?.data?.detail || 'Failed to delete task');
    },
  });

  const handleApproveKyc = (sponsorId: number) => {
    if (confirm('Approve this KYC application?')) {
      approveKycMutation.mutate(sponsorId);
    }
  };

  const handleRejectKyc = (sponsorId: number) => {
    const reason = prompt('Rejection reason (min 10 chars):');
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
    const reason = prompt('Rejection reason (min 10 chars):');
    if (reason && reason.length >= 10) {
      rejectSubmissionMutation.mutate({ submissionId, reason });
    } else if (reason) {
      alert('Reason must be at least 10 characters');
    }
  };

  // Per-field validators — mirror the backend AdminTaskCreateRequest
  // schema bounds (see `backend/app/schemas/__init__.py`). Returns an
  // object whose keys are field names and values are the human-readable
  // error string for that field, or undefined if the field is valid.
  //
  // Notes vs the sponsor flow:
  //   - reward has NO ceiling and only a ₦1 floor (any positive integer).
  //   - max_completions has a 1 floor, not 500.
  //
  // Live on every keystroke (the modal binds `form` straight to the
  // fields); the resulting object drives both the red border / inline
  // helper text on each field and the submit-button disabled state.
  const formErrors: Partial<Record<keyof TaskCreateForm, string>> = (() => {
    const errs: Partial<Record<keyof TaskCreateForm, string>> = {};

    const title = form.title.trim();
    if (title.length === 0) errs.title = 'Title is required';
    else if (title.length < 5) errs.title = `Title needs ${5 - title.length} more character${5 - title.length === 1 ? '' : 's'} (min 5)`;

    const desc = form.description.trim();
    if (desc.length === 0) errs.description = 'Description is required';
    else if (desc.length < 20) errs.description = `Description needs ${20 - desc.length} more character${20 - desc.length === 1 ? '' : 's'} (min 20)`;

    const instr = form.instructions.trim();
    if (instr.length === 0) errs.instructions = 'Instructions are required';
    else if (instr.length < 20) errs.instructions = `Instructions need ${20 - instr.length} more character${20 - instr.length === 1 ? '' : 's'} (min 20)`;

    const nairaRaw = form.reward_amount.trim();
    if (nairaRaw.length === 0) errs.reward_amount = 'Reward is required';
    else if (!/^\d+$/.test(nairaRaw)) errs.reward_amount = 'Reward must be a whole number (₦)';
    else {
      const naira = parseInt(nairaRaw, 10);
      if (naira < 1) errs.reward_amount = 'Reward must be at least ₦1';
    }

    const maxRaw = form.max_completions.trim();
    if (maxRaw.length === 0) errs.max_completions = 'Max completions is required';
    else if (!/^\d+$/.test(maxRaw)) errs.max_completions = 'Must be a whole number';
    else {
      const max = parseInt(maxRaw, 10);
      if (max < 1) errs.max_completions = 'Must be at least 1';
      else if (max > 10_000) errs.max_completions = 'Must be at most 10,000';
    }

    const daysRaw = form.expires_in_days.trim();
    if (daysRaw.length === 0) errs.expires_in_days = 'Expiry is required';
    else if (!/^\d+$/.test(daysRaw)) errs.expires_in_days = 'Must be a whole number of days';
    else {
      const days = parseInt(daysRaw, 10);
      if (days < 1) errs.expires_in_days = 'Must be at least 1 day';
      else if (days > 365) errs.expires_in_days = 'Cannot exceed 365 days';
    }

    return errs;
  })();

  const errorCount = Object.keys(formErrors).length;
  // Count "valid" against the six user-input fields. Selects are always
  // valid (they have a non-empty default), and target_url is optional.
  const fieldsToTrack: Array<keyof TaskCreateForm> = [
    'title', 'description', 'instructions', 'reward_amount', 'max_completions', 'expires_in_days',
  ];
  const validCount = fieldsToTrack.filter((k) => !formErrors[k]).length;
  const formValid = errorCount === 0;

  // Called from the modal's "Create Task" submit button (no React.FormEvent
  // available — that pattern was broken because the Button component drops
  // the `form` attribute, so type="submit" never associated the button with
  // the <form> and clicks were silently no-ops). We keep the form's
  // onSubmit={handleCreateSubmit} too, so Enter-key inside an input still
  // submits; the optional event lets `e.preventDefault()` work in that path.
  //
  // Validation runs live per-field via `formErrors` above — by the time the
  // user can click submit (button is disabled while `!formValid`), there
  // should be no work for this function to do. The defensive check stays
  // in case the button is enabled through a keyboard edge case.
  const handleCreateSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!formValid) return;
    createTaskMutation.mutate(form);
  };

  // Exact JSON the mutation will send to /admin/tasks/admin/create.
  // Recomputed every render (cheap) so the preview panel updates live
  // as the user edits. Helps the admin verify what the network call
  // actually looks like before clicking submit.
  const payloadPreview = JSON.stringify(
    {
      title: form.title,
      description: form.description,
      instructions: form.instructions,
      task_type: form.task_type,
      platform: form.platform,
      category: 'social_media',
      target_url: form.target_url || undefined,
      proof_type: form.proof_type,
      reward_amount_kobo: (() => {
        const n = parseInt(form.reward_amount, 10);
        return Number.isFinite(n) && n >= 0 ? n * 100 : 0;
      })(),
      reward_multiplier: 1.0,
      max_completions: parseInt(form.max_completions, 10) || 0,
      expires_in_days: parseInt(form.expires_in_days, 10) || 0,
    },
    null,
    2,
  );

  return (
    <>
      <TopHeader
        title="Tasks Platform"
        subtitle="Manage Phase 7 social tasks marketplace"
        onMenuClick={onMenuClick}
        actions={
          <div className="flex items-center gap-3">
            {tab === 'tasks' && hasPermission('tasks.manage') && (
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                <Plus size={16} className="text-icon-action" /> Create Task
              </Button>
            )}
            <div className="flex rounded-lg border border-border">
              <button
                onClick={() => setTab('tasks')}
                className={`px-4 py-1.5 text-sm font-semibold transition-colors ${tab === 'tasks' ? 'bg-primary text-white' : 'text-text-muted hover:text-text-main'}`}
              >
                Tasks
              </button>
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
          </div>
        }
      />
      <Container size="full">
        {tab === 'tasks' && (
          <div>
            {tasksLoading && <ShimmerLoader lines={5} />}
            {tasks && tasks.items.length === 0 && (
              <EmptyState
                icon={<ListTodo size={26} className="text-icon-action" />}
                title="No tasks yet"
                description="Create your first task to start engaging workers. Tasks appear here once they're published."
                {...(hasPermission('tasks.manage')
                  ? { actionLabel: 'Create Task', onAction: () => setCreateOpen(true) }
                  : {})}
              />
            )}
            {tasks && tasks.items.length > 0 && (
              <Card>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-border">
                    <thead className="bg-bg-muted">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">ID</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Title</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Platform</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Source</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Reward</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Completion</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Expires</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-muted">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {tasks.items.map((t) => (
                        <tr key={t.id} className="hover:bg-bg-hover">
                          <td className="px-4 py-3 text-sm text-text-main">#{t.id}</td>
                          <td className="px-4 py-3 text-sm text-text-main">{t.title}</td>
                          <td className="px-4 py-3 text-sm text-text-main capitalize">{t.platform}</td>
                          <td className="px-4 py-3 text-sm text-text-main">
                            <Badge variant={t.task_source === 'admin' ? 'info' : 'neutral'}>
                              {t.task_source}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-sm text-text-main">₦{t.reward_amount.toLocaleString()}</td>
                          <td className="px-4 py-3 text-sm text-text-main">
                            {t.completed_count} / {t.max_completions}
                          </td>
                          <td className="px-4 py-3 text-sm text-text-main">
                            <Badge variant={
                              t.status === 'active' ? 'success' :
                              t.status === 'completed' ? 'neutral' :
                              t.status === 'paused' ? 'warning' : 'neutral'
                            }>
                              {t.status}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-sm text-text-main">
                            {t.expires_at ? new Date(t.expires_at).toLocaleDateString() : '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-text-main">
                            {hasPermission('tasks.manage') && (
                              <div className="flex gap-2">
                                <Tooltip content="Delete this task" position="top">
                                  <Button
                                    size="sm"
                                    variant="danger"
                                    onClick={() => setDeleteId(t.id)}
                                  >
                                    <Trash2 size={14} className="text-icon-shield" /> Delete
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
                  <Pagination page={tasksPage} totalPages={Math.ceil(tasks.total / 50)} onPageChange={setTasksPage} />
                </div>
              </Card>
            )}
          </div>
        )}

        {tab === 'kyc' && (
          <div>
            {kycLoading && <ShimmerLoader lines={5} />}
            {kyc && kyc.items.length === 0 && (
              <EmptyState
                icon={<Briefcase size={26} className="text-icon-action" />}
                title="No pending KYC applications"
                description="Sponsor verification requests appear here for review. Once a sponsor submits their business documents, you'll be able to approve or reject them here."
              />
            )}
            {kyc && kyc.items.length > 0 && (
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
                                    <CheckCircle size={14} className="text-icon-finance" /> Approve
                                  </Button>
                                </Tooltip>
                                <Tooltip content="Reject KYC application" position="top">
                                  <Button size="sm" variant="danger" onClick={() => handleRejectKyc(k.sponsor_id)}>
                                    <XCircle size={14} className="text-icon-shield" /> Reject
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
            {submissions && submissions.items.length === 0 && (
              <EmptyState
                icon={<Inbox size={26} className="text-icon-action" />}
                title="No pending submissions"
                description="Flagged or pending task submissions appear here for review. Approve to release the worker reward, or reject to deny with feedback."
              />
            )}
            {submissions && submissions.items.length > 0 && (
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
                                    <CheckCircle size={14} className="text-icon-finance" /> Approve
                                  </Button>
                                </Tooltip>
                                <Tooltip content="Reject this submission" position="top">
                                  <Button size="sm" variant="danger" onClick={() => handleRejectSubmission(s.submission_id)}>
                                    <XCircle size={14} className="text-icon-shield" /> Reject
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

      {/* Create Task Modal */}
      <Modal
        isOpen={createOpen}
        onClose={() => {
          if (!createTaskMutation.isPending) {
            setCreateOpen(false);
            setForm(EMPTY_FORM);
          }
        }}
        title="Create New Task"
        size="xl"
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setCreateOpen(false);
                setForm(EMPTY_FORM);
              }}
              disabled={createTaskMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={!formValid || createTaskMutation.isPending}
              onClick={() => handleCreateSubmit()}
              title={!formValid ? `Fix ${errorCount} field${errorCount === 1 ? '' : 's'} before submitting` : undefined}
            >
              {createTaskMutation.isPending
                ? 'Creating...'
                : !formValid
                  ? `${errorCount} issue${errorCount === 1 ? '' : 's'} to fix`
                  : 'Create Task'}
            </Button>
          </>
        }
      >
        <form id="create-task-form" onSubmit={handleCreateSubmit} className="space-y-4">
          <Input
            label="Task Title *"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="e.g. Subscribe to PagePay on YouTube"
            disabled={createTaskMutation.isPending}
            error={formErrors.title}
          />
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-main">Description *</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Short description shown on the task card"
              rows={3}
              disabled={createTaskMutation.isPending}
              aria-invalid={!!formErrors.description}
              className={`w-full rounded-lg border bg-bg-main px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/30 focus:ring-offset-1 disabled:opacity-50 ${
                formErrors.description
                  ? 'border-error focus:border-error'
                  : 'border-border hover:border-border-hover focus:border-primary'
              }`}
            />
            <p className={`mt-1.5 text-xs ${formErrors.description ? 'text-error' : 'text-text-muted'}`}>
              {formErrors.description ?? `${form.description.trim().length} / 20 characters`}
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-main">Instructions *</label>
            <textarea
              value={form.instructions}
              onChange={(e) => setForm({ ...form, instructions: e.target.value })}
              placeholder="Step-by-step instructions for the worker"
              rows={4}
              disabled={createTaskMutation.isPending}
              aria-invalid={!!formErrors.instructions}
              className={`w-full rounded-lg border bg-bg-main px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/30 focus:ring-offset-1 disabled:opacity-50 ${
                formErrors.instructions
                  ? 'border-error focus:border-error'
                  : 'border-border hover:border-border-hover focus:border-primary'
              }`}
            />
            <p className={`mt-1.5 text-xs ${formErrors.instructions ? 'text-error' : 'text-text-muted'}`}>
              {formErrors.instructions ?? `${form.instructions.trim().length} / 20 characters`}
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-main">Platform</label>
            <div className="flex flex-wrap gap-2">
              {DEFAULT_PLATFORMS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setForm({ ...form, platform: p })}
                  disabled={createTaskMutation.isPending}
                  className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
                    form.platform === p
                      ? 'border-primary bg-primary text-white'
                      : 'border-border bg-bg-main text-text-muted hover:border-border-hover'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Task Type"
              value={form.task_type}
              onChange={(v) => setForm({ ...form, task_type: v })}
              disabled={createTaskMutation.isPending}
              options={TASK_TYPES.map((t) => ({
                value: t,
                label: formatTaskType(t),
              }))}
            />
            <Select
              label="Proof Type"
              value={form.proof_type}
              onChange={(v) => setForm({ ...form, proof_type: v })}
              disabled={createTaskMutation.isPending}
              options={PROOF_TYPES.map((p) => ({
                value: p,
                label: p.charAt(0).toUpperCase() + p.slice(1),
              }))}
            />
          </div>
          <Input
            label="Target URL (optional)"
            value={form.target_url}
            onChange={(e) => setForm({ ...form, target_url: e.target.value })}
            placeholder="https://youtube.com/@pagepay"
            disabled={createTaskMutation.isPending}
          />
          <div className="grid grid-cols-3 gap-3">
            <Input
              label="Reward (₦) *"
              type="number"
              min={1}
              value={form.reward_amount}
              onChange={(e) => setForm({ ...form, reward_amount: e.target.value })}
              disabled={createTaskMutation.isPending}
              error={formErrors.reward_amount}
            />
            <Input
              label="Max Completions *"
              type="number"
              min={1}
              value={form.max_completions}
              onChange={(e) => setForm({ ...form, max_completions: e.target.value })}
              disabled={createTaskMutation.isPending}
              error={formErrors.max_completions}
            />
            <Input
              label="Expires (days) *"
              type="number"
              min={1}
              value={form.expires_in_days}
              onChange={(e) => setForm({ ...form, expires_in_days: e.target.value })}
              disabled={createTaskMutation.isPending}
              error={formErrors.expires_in_days}
            />
          </div>

          {/* Live payload preview — shows the exact JSON the next submit
              will POST. Collapsed by default so it doesn't crowd the
              form; admins can expand it to verify what hits the wire. */}
          <details className="rounded-lg border border-border bg-bg-muted">
            <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold uppercase tracking-wider text-text-muted hover:text-text-main">
              Preview request payload
            </summary>
            <pre className="overflow-x-auto px-3 pb-3 pt-1 font-mono text-xs text-text-main">
              {payloadPreview}
            </pre>
          </details>

          {/* Per-field status — gives the admin an at-a-glance sense of
              what's left to fill. Updates live as formErrors recompute. */}
          <div className="flex items-center gap-3 rounded-lg border border-border bg-bg-muted px-3 py-2 text-xs">
            <span
              className={`font-semibold ${errorCount === 0 ? 'text-success' : 'text-text-main'}`}
            >
              {validCount} / {fieldsToTrack.length} fields valid
            </span>
            {errorCount > 0 && (
              <span className="text-error">
                {errorCount} {errorCount === 1 ? 'issue' : 'issues'} to fix
              </span>
            )}
          </div>
        </form>
      </Modal>

      {/* Delete Confirm Modal */}
      <ConfirmModal
        isOpen={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteTaskMutation.mutate(deleteId)}
        title="Delete Task"
        message="This will permanently delete the task and any pending submissions. This cannot be undone."
        confirmText="Delete"
        variant="danger"
        isLoading={deleteTaskMutation.isPending}
      />
    </>
  );
}
