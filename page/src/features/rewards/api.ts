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

export type MilestoneLadderEntry = {
  day: number;
  reward_sv: number;
  celebration_component: string;
};

export type NextMilestone = {
  day: number;
  reward_sv: number;
  celebration_component: string;
  next_milestone_in_days: number;
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
  // Section 3.14: full milestone ladder
  milestones_claimed: number[];
  ladder: MilestoneLadderEntry[];
  next_milestone: NextMilestone | null;
};

export type StreakFreezeByAdResponse = {
  recovered: boolean;
  next_claim_available_at: string;
};

export type StreakFreezeByPointsResponse = {
  recovered: boolean;
  sv_spent: number;
  new_balance: number;
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
  doubled: boolean;
  base_points: number;
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

export async function fetchDailyRewardConfig(): Promise<DailyRewardInfo[]> {
  const res = await apiFetch("/api/v1/rewards/daily/config");
  if (!res.ok) {
    let errorMessage = `Failed to load daily reward config (HTTP ${res.status})`;
    try {
      const err = await res.json();
      if (typeof err.detail === "string") {
        errorMessage = err.detail;
      } else if (typeof err.message === "string") {
        errorMessage = err.message;
      }
    } catch {
      errorMessage = res.statusText || errorMessage;
    }
    if (__DEV__) {
      console.error("[fetchDailyRewardConfig] Error:", {
        status: res.status,
        statusText: res.statusText,
        url: res.url,
        message: errorMessage,
      });
    }
    throw new Error(errorMessage);
  }
  return res.json();
}

export async function fetchDailyRewardStatus(): Promise<DailyRewardStatus> {
  const res = await apiFetch("/api/v1/rewards/daily/status");
  if (!res.ok) {
    let errorMessage = `Failed to load daily reward status (HTTP ${res.status})`;
    try {
      const err = await res.json();
      if (typeof err.detail === "string") {
        errorMessage = err.detail;
      } else if (typeof err.message === "string") {
        errorMessage = err.message;
      }
    } catch {
      errorMessage = res.statusText || errorMessage;
    }
    if (__DEV__) {
      console.error("[fetchDailyRewardStatus] Error:", {
        status: res.status,
        statusText: res.statusText,
        url: res.url,
        message: errorMessage,
      });
    }
    throw new Error(errorMessage);
  }
  return res.json();
}

export async function claimDailyReward(
  deviceId?: string,
): Promise<DailyRewardClaim> {
  const body: Record<string, unknown> = {};
  if (deviceId) {
    body.device_id = deviceId;
  }
  const res = await apiFetch("/api/v1/rewards/daily/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let errorMessage = `Failed to claim daily reward (HTTP ${res.status})`;

    try {
      const err = await res.json();
      if (typeof err.detail === "string") {
        errorMessage = err.detail;
      } else if (typeof err.message === "string") {
        errorMessage = err.message;
      }
    } catch {
      // If we can't parse JSON, use status text
      errorMessage = res.statusText || errorMessage;
    }

    // Log the full error for debugging
    if (__DEV__) {
      console.error("[claimDailyReward] Error:", {
        status: res.status,
        statusText: res.statusText,
        url: res.url,
        headers: Object.fromEntries(res.headers.entries()),
        message: errorMessage,
      });
    }

    throw new Error(errorMessage);
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

export async function freezeStreakByAd(
  deviceId?: string,
): Promise<StreakFreezeByAdResponse> {
  const body: Record<string, string | undefined> = {};
  if (deviceId) body.device_id = deviceId;
  const res = await apiFetch("/api/v1/rewards/daily/freeze-by-ad", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let errorMessage = `Failed to recover streak by ad (HTTP ${res.status})`;
    try {
      const err = await res.json();
      if (typeof err.detail === "string") errorMessage = err.detail;
      else if (typeof err.message === "string") errorMessage = err.message;
    } catch {
      errorMessage = res.statusText || errorMessage;
    }
    throw new Error(errorMessage);
  }
  return res.json();
}

export async function freezeStreakByPoints(
  deviceId?: string,
): Promise<StreakFreezeByPointsResponse> {
  const body: Record<string, string | undefined> = {};
  if (deviceId) body.device_id = deviceId;
  const res = await apiFetch("/api/v1/rewards/daily/freeze-by-points", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let errorMessage = `Failed to recover streak by points (HTTP ${res.status})`;
    try {
      const err = await res.json();
      if (typeof err.detail === "string") errorMessage = err.detail;
      else if (typeof err.message === "string") errorMessage = err.message;
    } catch {
      errorMessage = res.statusText || errorMessage;
    }
    throw new Error(errorMessage);
  }
  return res.json();
}
