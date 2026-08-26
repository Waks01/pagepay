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

/** One row from GET /api/v1/wallet/history. Mirrors backend/app/routers/wallet.py. */
export type HistoryItem = {
  kind: 'read' | 'ad' | 'bill' | 'payment' | 'withdrawal' | 'study' | 'bonus' | 'history' | 'daily_reward';
  type: string;
  status: 'success' | 'pending' | 'failed';
  txId: string;
  ref: string;
  description: string;
  /** Earned points (positive for credits, negative for debits). */
  points: number;
  /** Signed amount: positive kobo for credits, negative for debits. */
  amount: number;
  date: string;
  ledger: 'service_credit' | 'cashable' | null;
  details: Record<string, unknown>;
};
