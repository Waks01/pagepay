import { apiFetch } from '@/src/shared/api/client';

// ==================== Types ====================

export type Task = {
  id: number;
  title: string;
  description: string;
  task_type: string;
  platform: string;
  category: string;
  reward_amount: number;
  reward_multiplier: number;
  max_completions: number;
  completed_count: number;
  expires_at: string;
  sponsor_display_name?: string;
};

export type TaskDetail = {
  id: number;
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
  expires_at: string;
  time_limit_minutes: number | null;
  min_worker_level: number;
  min_approval_rate: number;
  platform_fee_amount: number;
  sponsor_display_name?: string;
};

export type TaskStartResponse = {
  submission_id: number;
  started_at: string;
  expires_at: string | null;
  message: string;
};

export type TaskSubmitRequest = {
  proof_image_base64?: string | null;
  proof_url?: string | null;
  proof_text?: string | null;
};

export type TaskSubmitResponse = {
  submission_id: number;
  status: string;
  message: string;
};

export type TaskSubmission = {
  id: number;
  task_id: number;
  task_title: string;
  task_type: string;
  platform: string;
  status: 'pending' | 'validating' | 'approved' | 'rejected';
  reward_amount: number;
  submitted_at: string;
  verified_at: string | null;
  rejection_reason: string | null;
  ai_confidence: number | null;
  proof_image_url: string | null;
  proof_url: string | null;
  proof_text: string | null;
};

export type WorkerStats = {
  user_id: number;
  worker_level: number;
  worker_xp: number;
  xp_to_next_level: number;
  tasks_completed: number;
  tasks_rejected: number;
  total_earned: number;
  approval_rate: number;
  current_streak: number;
  longest_streak: number;
  badges: string[];
  created_at: string;
  updated_at: string;
};

export type TaskListResponse = {
  items: Task[];
  total: number;
};

// ==================== API Functions ====================

export async function fetchTasks(): Promise<TaskListResponse> {
  const res = await apiFetch('/api/v1/tasks');
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to load tasks');
  }
  return res.json();
}

export async function fetchTaskDetail(taskId: number): Promise<TaskDetail> {
  const res = await apiFetch(`/api/v1/tasks/${taskId}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to load task details');
  }
  return res.json();
}

export async function startTask(taskId: number): Promise<TaskStartResponse> {
  const res = await apiFetch(`/api/v1/tasks/${taskId}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to start task');
  }
  return res.json();
}

export async function submitTask(
  taskId: number,
  payload: TaskSubmitRequest
): Promise<TaskSubmitResponse> {
  const res = await apiFetch(`/api/v1/tasks/${taskId}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to submit task');
  }
  return res.json();
}

export async function fetchWorkerStats(): Promise<WorkerStats> {
  const res = await apiFetch('/api/v1/tasks/my-stats');
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to load worker stats');
  }
  return res.json();
}

export async function fetchMySubmissions(): Promise<TaskSubmission[]> {
  const res = await apiFetch('/api/v1/tasks/my-submissions');
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to load submissions');
  }
  return res.json();
}
