import { apiFetch } from '@/src/shared/api/client';

// ==================== Types ====================

export type AdminTask = {
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
  expires_at: string;
  created_at: string;
};

export type AdminSubmission = {
  submission_id: number;
  task_id: number;
  task_title: string;
  task_type: string;
  platform: string;
  task_source: string;
  reward_type: string;
  reward_amount: number;
  worker_id: number;
  worker_email: string;
  proof_type: string;
  proof_url: string | null;
  proof_image_url: string | null;
  proof_text: string | null;
  status: string;
  rejection_reason: string | null;
  submitted_at: string;
};

export type AdminTaskCreateRequest = {
  title: string;
  description: string;
  platform: string;
  task_type?: string;
  category?: string;
  reward_type?: string;
  reward_amount: number;
  instructions: string;
  target_url?: string;
  proof_type?: string;
  proof_instructions?: string;
  max_completions?: number;
  expires_in_days?: number;
};

// ==================== API Functions ====================

export async function adminListTasks(params?: {
  status?: string;
  task_source?: string;
  page?: number;
  limit?: number;
}): Promise<{ items: AdminTask[]; total: number; page: number; limit: number }> {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.task_source) query.set('task_source', params.task_source);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));

  const res = await apiFetch(`/api/v1/tasks/admin/list?${query.toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to load tasks');
  }
  return res.json();
}

export async function adminCreateTask(payload: AdminTaskCreateRequest): Promise<{ success: boolean; task_id: number }> {
  const query = new URLSearchParams();
  Object.entries(payload).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  });

  const res = await apiFetch('/api/v1/tasks/admin/create', {
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

export async function adminUpdateTask(
  taskId: number,
  payload: Partial<AdminTaskCreateRequest>
): Promise<{ success: boolean }> {
  const query = new URLSearchParams();
  Object.entries(payload).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  });

  const res = await apiFetch(`/api/v1/tasks/admin/${taskId}?${query.toString()}`, {
    method: 'PUT',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to update task');
  }
  return res.json();
}

export async function adminDeleteTask(taskId: number): Promise<{ success: boolean }> {
  const res = await apiFetch(`/api/v1/tasks/admin/${taskId}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to delete task');
  }
  return res.json();
}

export async function adminListSubmissions(params?: {
  status?: string;
  task_source?: string;
  page?: number;
  limit?: number;
}): Promise<{ items: AdminSubmission[]; total: number; page: number; limit: number }> {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.task_source) query.set('task_source', params.task_source);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));

  const res = await apiFetch(`/api/v1/tasks/admin/submissions?${query.toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to load submissions');
  }
  return res.json();
}

export async function adminApproveSubmission(
  submissionId: number
): Promise<{ success: boolean; reward_paid: number }> {
  const res = await apiFetch(`/api/v1/tasks/admin/submissions/${submissionId}/approve`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to approve submission');
  }
  return res.json();
}

export async function adminRejectSubmission(
  submissionId: number,
  reason: string
): Promise<{ success: boolean; reason: string }> {
  const res = await apiFetch(`/api/v1/tasks/admin/submissions/${submissionId}/reject?reason=${encodeURIComponent(reason)}`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to reject submission');
  }
  return res.json();
}
