import { apiFetch } from '@/src/shared/api/client';

// Work-level social types. Mirrors the backend's WorkSocialResponse
// and WorkCommentItem schemas in backend/app/schemas/__init__.py.

export type WorkLikeToggleResponse = {
  liked: boolean;
  likes_count: number;
};

export type WorkCommentItem = {
  id: number;
  user_id: number;
  work_id: number;
  body: string;
  parent_comment_id: number | null;
  status: string;
  created_at: string;
  author_name: string | null;
  likes_count: number;
  is_liked: boolean;
  replies: number;
};

export type WorkCommentFeedResponse = {
  total: number;
  comments: WorkCommentItem[];
};

export type WorkSocialResponse = {
  work_id: number;
  likes_count: number;
  comments_count: number;
  shares_count: number;
  is_liked: boolean;
};

export type WorkShareResponse = {
  shares_count: number;
};

// ── API functions ────────────────────────────────────────────────────────

export async function toggleWorkLike(workId: number): Promise<WorkLikeToggleResponse> {
  const res = await apiFetch(`/api/v1/works/${workId}/like`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to toggle like');
  }
  return res.json();
}

export async function fetchWorkSocial(workId: number): Promise<WorkSocialResponse> {
  const res = await apiFetch(`/api/v1/works/${workId}/social`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to load work social');
  }
  return res.json();
}

export async function fetchWorkComments(
  workId: number,
  params?: { limit?: number; offset?: number },
): Promise<WorkCommentFeedResponse> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  const q = qs.toString();
  const res = await apiFetch(`/api/v1/works/${workId}/comments${q ? `?${q}` : ''}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to load comments');
  }
  return res.json();
}

export async function postWorkComment(
  workId: number,
  body: string,
  parentCommentId?: number,
): Promise<WorkCommentItem> {
  const res = await apiFetch(`/api/v1/works/${workId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      body,
      parent_comment_id: parentCommentId ?? null,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to post comment');
  }
  return res.json();
}

export async function toggleCommentLike(
  commentId: number,
): Promise<WorkLikeToggleResponse> {
  const res = await apiFetch(`/api/v1/works/comments/${commentId}/like`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to toggle comment like');
  }
  return res.json();
}

export async function logWorkShare(
  workId: number,
  platform: string,
): Promise<WorkShareResponse> {
  const res = await apiFetch(`/api/v1/works/${workId}/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to log share');
  }
  return res.json();
}
