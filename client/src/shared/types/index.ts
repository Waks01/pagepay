export type UserMe = {
  id: number;
  email: string | null;
  phone: string | null;
  username: string | null;
  points_balance: number;
  tier: string;
  is_worker: boolean;
  is_sponsor: boolean;
  email_verified: boolean;
  created_at: string;
};
