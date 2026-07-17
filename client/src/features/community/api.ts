import { apiFetch } from '@/src/shared/api/client';

export type ReferralStats = {
  code: string;
  clicks: number;
  signups: number;
  pending_rewards: number;
  claimed_rewards: number;
};

export type ReferralGenerateResponse = {
  code: string;
  link: string;
};

export type ReferralValidateResponse = {
  rewarded: boolean;
  referrer_points: number;
  referee_points: number;
  message: string;
};

export type CommunityNoteCreate = {
  title: string;
  content: string;
  course_code?: string;
  university?: string;
};

export type CommunityFeedItem = {
  id: number;
  title: string;
  content: string;
  course_code: string | null;
  university: string | null;
  likes_count: number;
  created_at: string;
  author_name: string | null;
  is_liked: boolean;
};

export type StreakResponse = {
  current_streak: number;
  longest_streak: number;
  last_activity_date: string | null;
  bonus_multiplier: number;
  bonus_label: string;
};

export async function generateReferralCode(): Promise<ReferralGenerateResponse> {
  const res = await apiFetch('/api/v1/referral/generate');
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to generate referral code');
  }
  return res.json();
}

export async function getReferralStats(): Promise<ReferralStats> {
  const res = await apiFetch('/api/v1/referral/stats');
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to load referral stats');
  }
  return res.json();
}

export async function validateReferral(): Promise<ReferralValidateResponse> {
  const res = await apiFetch('/api/v1/referral/validate', { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to validate referral');
  }
  return res.json();
}

export async function uploadCommunityNote(payload: CommunityNoteCreate) {
  const res = await apiFetch('/api/v1/community/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Upload failed');
  }
  return res.json();
}

export async function fetchCommunityFeed(params?: { course_code?: string; sort?: string; limit?: number; offset?: number }) {
  const qs = new URLSearchParams();
  if (params?.course_code) qs.set('course_code', params.course_code);
  if (params?.sort) qs.set('sort', params.sort);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  const q = qs.toString();
  const res = await apiFetch(`/api/v1/community/feed${q ? `?${q}` : ''}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to load feed');
  }
  return res.json() as Promise<CommunityFeedItem[]>;
}

export async function toggleCommunityLike(noteId: number) {
  const res = await apiFetch(`/api/v1/community/${noteId}/like`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to toggle like');
  }
  return res.json();
}

export async function fetchStreak(): Promise<StreakResponse> {
  const res = await apiFetch('/api/v1/users/me/streak');
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to load streak');
  }
  return res.json();
}
