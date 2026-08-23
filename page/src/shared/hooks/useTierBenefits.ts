/**
 * Phase 4: Premium Tier Benefits Hook
 * 
 * React hook for accessing user tier and benefits information.
 * Automatically fetches and caches tier data.
 */

import { useEffect, useState } from 'react';
import { getUserTier, getTierBenefits } from '@/src/shared/api/client';

export type UserTier = 'free' | 'premium_monthly' | 'premium_yearly';

export interface TierStatus {
  tier: UserTier;
  isPremium: boolean;
  expiresAt: string | null;
}

export interface TierMultipliers {
  points_earning: number;
  reading_points: number;
  ad_rewards: number;
  task_rewards: number;
  bills_cashback: number;
  daily_rewards: number;
}

export interface TierConfig {
  tier_id: string;
  display_name: string;
  price_kobo: number;
  duration_days: number | null;
  multipliers: TierMultipliers;
  features: any;
  benefits_display: string[];
}

export interface TierBenefitsData {
  free: TierConfig;
  premium_monthly: TierConfig;
  premium_yearly: TierConfig;
  comparison: any;
}

/**
 * Hook to get current user's tier status
 */
export function useUserTier() {
  const [tierStatus, setTierStatus] = useState<TierStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function fetchTier() {
      try {
        const data = await getUserTier();
        if (mounted) {
          setTierStatus({
            tier: data.tier,
            isPremium: data.is_premium,
            expiresAt: data.expires_at,
          });
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load tier');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    fetchTier();

    return () => {
      mounted = false;
    };
  }, []);

  return { tierStatus, loading, error };
}

/**
 * Hook to get tier benefits configuration
 */
export function useTierBenefitsConfig() {
  const [benefits, setBenefits] = useState<TierBenefitsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function fetchBenefits() {
      try {
        const data = await getTierBenefits();
        if (mounted) {
          setBenefits(data);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load benefits');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    fetchBenefits();

    return () => {
      mounted = false;
    };
  }, []);

  return { benefits, loading, error };
}

/**
 * Hook to get multipliers for current user's tier
 */
export function useMultipliers() {
  const { tierStatus, loading: tierLoading } = useUserTier();
  const { benefits, loading: benefitsLoading } = useTierBenefitsConfig();

  const loading = tierLoading || benefitsLoading;

  if (!tierStatus || !benefits) {
    return { multipliers: null, loading };
  }

  const tierConfig = benefits[tierStatus.tier];
  return { 
    multipliers: tierConfig?.multipliers || null, 
    loading 
  };
}

/**
 * Helper to calculate points with multiplier
 */
export function calculatePoints(
  basePoints: number,
  multiplier: number
): number {
  return Math.floor(basePoints * multiplier);
}

/**
 * Helper to get benefit display strings for current tier
 */
export function useTierBenefitsList() {
  const { tierStatus, loading: tierLoading } = useUserTier();
  const { benefits, loading: benefitsLoading } = useTierBenefitsConfig();

  const loading = tierLoading || benefitsLoading;

  if (!tierStatus || !benefits) {
    return { benefitsList: [], loading };
  }

  const tierConfig = benefits[tierStatus.tier];
  return {
    benefitsList: tierConfig?.benefits_display || [],
    loading
  };
}
