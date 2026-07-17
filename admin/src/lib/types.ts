export interface AdminLoginRequest {
  email: string;
  password: string;
}

export interface AdminLoginResponse {
  access_token: string;
  token_type: string;
  role: string;
  permissions: string[];
}

export interface AdminUserOut {
  id: number;
  email: string;
  role: string;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  permissions: string[];
}

export interface DashboardStats {
  total_users: number;
  active_users_today: number;
  // Ad Revenue breakdown
  ad_revenue_usd: number;
  ad_revenue_ngn: number; // In kobo
  ad_platform_share_usd: number;
  ad_platform_share_ngn: number; // In kobo
  ad_user_share_usd: number;
  ad_user_share_ngn: number; // In kobo
  // Task Revenue breakdown
  task_revenue_ngn: number; // In kobo
  task_platform_share_ngn: number; // In kobo
  task_worker_share_ngn: number; // In kobo
  // Premium Revenue
  premium_revenue_ngn: number; // In kobo
  premium_revenue_usd: number;
  // Combined totals
  total_revenue_usd: number;
  total_revenue_ngn: number; // In kobo
  platform_earnings_ngn: number; // In kobo
  user_earnings_ngn: number; // In kobo
  total_points_distributed: number;
  // Other stats
  pending_payouts: number;
  pending_notes: number;
  high_severity_fraud_flags: number;
}

export interface UserListItem {
  id: number;
  email: string;
  phone: string | null;
  tier: string;
  status: string;
  points_balance: number;
  referral_code: string | null;
  created_at: string;
  last_active_at: string | null;
}

export interface UserListResponse {
  items: UserListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface UserDetail {
  id: number;
  email: string;
  phone: string | null;
  tier: string;
  status: string;
  points_balance: number;
  referral_code: string | null;
  referred_by: number | null;
  subscription_expires_at: string | null;
  created_at: string;
  last_active_at: string | null;
}

export interface UserSession {
  id: number;
  content_id: number;
  start_time: string;
  duration_seconds: number;
  verified: boolean;
  points_earned: number;
}

export interface UserSessionsResponse {
  items: UserSession[];
  total: number;
  page: number;
  limit: number;
}

export interface UserTransaction {
  type: string;
  id: number;
  created_at: string;
}

export interface UserTransactionsResponse {
  items: UserTransaction[];
  total: number;
  page: number;
  limit: number;
}

export interface RevenueSummary {
  // Ad Revenue breakdown
  ad_revenue_usd: number;
  ad_revenue_ngn: number; // In kobo
  ad_platform_share_usd: number;
  ad_platform_share_ngn: number; // In kobo
  ad_user_share_usd: number;
  ad_user_share_ngn: number; // In kobo
  // Premium Revenue
  premium_revenue_ngn: number; // In kobo
  premium_revenue_usd: number;
  // Combined totals
  total_revenue_usd: number;
  total_revenue_ngn: number; // In kobo
  platform_earnings_ngn: number; // In kobo
  user_earnings_ngn: number; // In kobo
  total_points_distributed: number;
  average_fx_rate: number;
  current_fx_rate: number;
  period_start: string;
  period_end: string;
}

export interface PayoutItem {
  id: number;
  user_id: number;
  amount_kobo: number;
  fee_kobo: number;
  status: string;
  recipient_code: string;
  created_at: string;
  reason?: string | null; // Failure reason
  settled_at?: string | null; // Settlement timestamp
  paystack_transfer_code?: string | null; // Paystack transfer ID
  paystack_event_id?: string | null; // Webhook event ID
}

export interface PayoutListResponse {
  items: PayoutItem[];
  total: number;
  page: number;
  limit: number;
}

export interface ContentItem {
  id: number;
  title: string;
  content_type: string;
  category: string;
  author: string | null;
  created_at: string;
}

export interface ContentListResponse {
  items: ContentItem[];
  total: number;
  page: number;
  limit: number;
}

export interface FraudFlagOut {
  id: number;
  user_id: number | null;
  session_id: number | null;
  flag_type: string;
  severity: string;
  details: string;
  status: string;
  reviewed_by: number | null;
  review_notes: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface FraudFlagListResponse {
  items: FraudFlagOut[];
  total: number;
}

export interface AdminAuditLogOut {
  id: number;
  admin_email: string | null;
  action: string;
  target_type: string;
  target_id: number | null;
  changes: string | null;
  ip_address: string | null;
  result: string;
  created_at: string;
}

export interface ConfigItem {
  key: string;
  value: string;
  environment: string;
  description: string | null;
  updated_at: string | null;
}

export interface AiProviderHealth {
  provider: string;
  consecutive_failures: number;
  circuit_open_until: string | null;
  last_failure_at: string | null;
}

export interface DailyActiveUsers {
  date: string;
  count: number;
}

export interface RetentionCohort {
  signup_date: string;
  day_1: number;
  day_7: number;
}

export interface ContentPerformanceItem {
  content_id: number;
  title: string;
  reading_sessions: number;
}

export interface PlatformConfig {
  ad_revenue_platform_percent: number;
  ad_revenue_user_percent: number;
  task_revenue_platform_percent: number;
  task_revenue_worker_percent: number;
  task_base_rates_kobo: Record<string, number>;
}
