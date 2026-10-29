export type UserMe = {
  id: number;
  email: string | null;
  phone: string | null;
  username: string | null;
  service_credit_balance: number;
  cashable_balance: number;
  points_balance: number;
  tier: string;
  is_worker: boolean;
  is_sponsor: boolean;
  email_verified: boolean;
  created_at: string;
  avatar_url: string | null;
};
