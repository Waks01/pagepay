import { apiFetch } from '@/src/shared/api/client';

// ==================== Types ====================

export type SponsorRegisterRequest = {
  email: string;
  password: string;
  display_name: string;
  phone?: string;
};

export type SponsorRegisterResponse = {
  access_token: string;
  token_type: string;
  user_id: number;
  email: string;
  is_sponsor: boolean;
};

export type SponsorKYCSubmitRequest = {
  id_type: 'nin' | 'bvn' | 'voters_card' | 'drivers_license' | 'passport';
  id_number: string;
  id_document_base64?: string;
  business_registration_number?: string;
  business_document_base64?: string;
};

export type SponsorKYCResponse = {
  kyc_status: 'pending' | 'approved' | 'rejected';
  submitted_at: string;
  reviewed_at?: string;
  message: string;
};

export type SponsorWalletDepositRequest = {
  amount_kobo: number;
};

export type SponsorWalletDepositResponse = {
  authorization_url: string;
  reference: string;
  amount: number;
};

export type TaskCreateRequest = {
  title: string;
  description: string;
  instructions: string;
  task_type: string;
  platform: string;
  category: string;
  target_url?: string;
  proof_type: string;
  proof_instructions?: string;
  reward_amount_kobo: number;
  reward_multiplier: number;
  max_completions: number;
  time_limit_minutes?: number;
  expires_in_days: number;
  min_worker_level?: number;
  min_approval_rate?: number;
  target_gender?: string;
  target_age_min?: number;
  target_age_max?: number;
  target_cities?: string[];
  ai_verification_enabled?: boolean;
  require_manual_review?: boolean;
};

export type TaskResponseFull = {
  id: number;
  sponsor_id: number;
  title: string;
  description: string;
  instructions: string;
  task_type: string;
  platform: string;
  category: string;
  target_url: string | null;
  proof_type: string;
  proof_instructions: string | null;
  reward_amount: number;
  reward_multiplier: number;
  max_completions: number;
  completed_count: number;
  approved_count: number;
  rejected_count: number;
  pending_count: number;
  status: 'draft' | 'active' | 'paused' | 'completed' | 'expired';
  expires_at: string;
  created_at: string;
  published_at: string | null;
  time_limit_minutes: number | null;
  min_worker_level: number;
  min_approval_rate: number;
  platform_fee_amount: number;
  escrow_locked_amount: number;
  total_spent: number;
};

export type TaskSubmissionDetail = {
  id: number;
  task_id: number;
  user_id: number;
  worker_email: string;
  status: 'pending' | 'validating' | 'approved' | 'rejected';
  proof_image_url: string | null;
  proof_url: string | null;
  proof_text: string | null;
  submitted_at: string;
  verified_at: string | null;
  rejection_reason: string | null;
  ai_confidence: number | null;
  ai_verification_details: any;
  flagged_for_review: boolean;
};

export type SponsorAnalytics = {
  total_tasks_created: number;
  active_tasks: number;
  completed_tasks: number;
  total_spent_kobo: number;
  total_submissions: number;
  approval_rate: number;
  avg_approval_time_seconds: number;
};

// ==================== API Functions ====================

export async function registerSponsor(payload: SponsorRegisterRequest): Promise<SponsorRegisterResponse> {
  const res = await apiFetch('/api/v1/sponsor/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to register sponsor');
  }
  return res.json();
}

export async function submitSponsorKYC(payload: SponsorKYCSubmitRequest): Promise<SponsorKYCResponse> {
  const res = await apiFetch('/api/v1/sponsor/kyc', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to submit KYC');
  }
  return res.json();
}

export async function depositToSponsorWallet(payload: SponsorWalletDepositRequest): Promise<SponsorWalletDepositResponse> {
  const res = await apiFetch('/api/v1/sponsor/wallet/deposit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to initiate deposit');
  }
  return res.json();
}

export async function createTask(payload: TaskCreateRequest): Promise<TaskResponseFull> {
  const res = await apiFetch('/api/v1/sponsor/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to create task');
  }
  return res.json();
}

export async function publishTask(taskId: number): Promise<{ message: string; escrow_locked: number }> {
  const res = await apiFetch(`/api/v1/sponsor/tasks/${taskId}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to publish task');
  }
  return res.json();
}

export async function fetchSponsorTasks(status?: string): Promise<TaskResponseFull[]> {
  const query = status ? `?status=${status}` : '';
  const res = await apiFetch(`/api/v1/sponsor/tasks${query}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to load tasks');
  }
  return res.json();
}

export async function fetchTaskSubmissions(taskId: number): Promise<TaskSubmissionDetail[]> {
  const res = await apiFetch(`/api/v1/sponsor/tasks/${taskId}/submissions`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to load submissions');
  }
  return res.json();
}

export async function approveSubmission(submissionId: number): Promise<{ message: string }> {
  const res = await apiFetch(`/api/v1/sponsor/submissions/${submissionId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to approve submission');
  }
  return res.json();
}

export async function rejectSubmission(submissionId: number, reason: string): Promise<{ message: string }> {
  const res = await apiFetch(`/api/v1/sponsor/submissions/${submissionId}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to reject submission');
  }
  return res.json();
}
