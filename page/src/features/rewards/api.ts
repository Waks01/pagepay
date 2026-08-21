/**
 * Daily Rewards API functions
 */

import { apiFetch } from "../../shared/api/client";

export type DailyRewardInfo = {
  id: number;
  day_number: number;
  reward_type: string;
  reward_value: number;
  title: string;
  description: string | null;
  icon_emoji: string;
};

export type DailyRewardStatus = {
  current_streak: number;
  longest_streak: number;
  can_claim_today: boolean;
  todays_reward: DailyRewardInfo | null;
  last_claim_date: string | null;
  next_milestone_day: number | null;
  recent_claims: Array<{
    date: string;
    points_earned: number;
    streak_day: number;
  }>;
};

export type DailyRewardClaim = {
  success: boolean;
  points_earned: number;
  reward_title: string;
  reward_description: string | null;
  reward_emoji: string;
  new_total_points: number;
  streak_day: number;
  is_multiplier: boolean;
  multiplier_value: number | null;
};

export type DailyRewardHistory = {
  claims: Array<{
    date: string;
    points_earned: number;
    streak_day: number;
    reward_title: string;
    reward_emoji: string;
    reward_type: string;
    claimed_at: string;
  }>;
  total_points_earned: number;
};

export async function fetchDailyRewardStatus(): Promise<DailyRewardStatus> {
  const res = await apiFetch("/api/v1/rewards/daily/status");
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Failed to load daily reward status");
  }
  return res.json();
}

export async function claimDailyReward(): Promise<DailyRewardClaim> {
  const res = await apiFetch("/api/v1/rewards/daily/claim", { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Failed to claim daily reward");
  }
  return res.json();
}

export async function fetchDailyRewardHistory(): Promise<DailyRewardHistory> {
  const res = await apiFetch("/api/v1/rewards/daily/history");
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Failed to load daily reward history");
  }
  return res.json();
}
