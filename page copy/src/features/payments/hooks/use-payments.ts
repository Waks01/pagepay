import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/src/shared/api/client';

export type Tier = {
  tier: string;
  display_name: string;
  price_kobo: number;
  duration_days: number;
  benefits: string[];
};

export type UserTierInfo = {
  current_tier: string;
  subscription_expires_at: string | null;
  is_premium: boolean;
  days_remaining: number | null;
};

export type PaymentInitiateResponse = {
  payment_url: string;
  provider_tx_ref: string;
  provider: string;
  amount_kobo: number;
  tier: string;
};

export function useTiers() {
  return useQuery({
    queryKey: ['payments', 'tiers'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/payments/tiers');
      if (!res.ok) throw new Error('Failed to load tiers');
      return res.json() as Promise<Tier[]>;
    },
  });
}

export function useUserTier() {
  return useQuery({
    queryKey: ['payments', 'tier-info'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/payments/tier-info');
      if (!res.ok) throw new Error('Failed to load tier info');
      return res.json() as Promise<UserTierInfo>;
    },
  });
}

export function useInitiatePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { tier: string; provider?: string }) =>
      (
        await apiFetch('/api/v1/payments/initiate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tier: payload.tier, provider: payload.provider || 'paystack' }),
        })
      ).json() as Promise<PaymentInitiateResponse>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payments', 'tier-info'] });
    },
  });
}
