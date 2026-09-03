export type TransactionHistoryItem = {
  id: number;
  type:
    | "bill"
    | "payment"
    | "payout"
    | "daily_reward"
    | "reading_reward"
    | "study"
    | "ad"
    | "bonus"
    | "streak_freeze"
    | "audio_unlock";
  subtype: string | null;
  status: string;
  amount: number;
  unit: "NGN" | "SP" | "USD";
  description: string;
  reference: string | null;
  timestamp: string;
  ledger: string | null;
  metadata: Record<string, unknown> | null;
};
