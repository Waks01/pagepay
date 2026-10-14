# All fastapi app settings
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import model_validator


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    secret_key: str
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 10080
    environment: str = "development"
    cors_origins: str = "http://localhost:3000,http://localhost:8081,http://localhost:19006,https://pagepay-fff6.onrender.com"

    gnews_api_key: str | None = None
    gutendex_base_url: str = "https://gutendex.com"

    flutterwave_client_id: str | None = None
    flutterwave_client_secret: str | None = None
    flutterwave_secret_hash: str | None = None
    flutterwave_base_url: str = "https://api.flutterwave.com"

    # Payments provider for Phase 4. We're switching from Flutterwave to
    # Paystack — this is the placeholder where the secret key will live
    # when Phase 4 wires the payouts router to Paystack's
    # /transferrecipient, /transfer, and /verify endpoints. v1 leaves
    # the payouts endpoints as stubs and never reads this value.
    paystack_secret_key: str | None = None
    # Public key — used by the client (Paystack inline / popup) and also
    # surfaced in our backend logs when an operator needs to verify
    # which environment (test vs live) is configured.
    paystack_public_key: str | None = None
    # Base URL for the Paystack API. Default is production
    # (https://api.paystack.co). Set to the test-sandbox endpoint
    # (`https://api.paystack.co` is fine for both — Paystack switches
    # based on the secret key prefix, but we keep this knob in case
    # we ever proxy through a region-local endpoint).
    paystack_base_url: str = "https://api.paystack.co"
    # HTTP timeout for outbound Paystack calls. 10s matches Paystack's
    # SLA per their docs. Override lower (e.g. 5) in dev to surface
    # slow-API issues faster.
    paystack_http_timeout_seconds: float = 10.0
    # Cache TTL for the GET /bank list — Nigerian banks change rarely,
    # so a 1h cache dodges the per-call overhead in the bank picker.
    paystack_banks_cache_ttl_seconds: int = 3600
    # Base URL we expose to Paystack's dashboard (return URLs after a
    # checkout session; the webhook URL). Defaults to localhost so
    # `paystack-cli listen-forward` works out of the box. In production
    # this must be set to the real public domain (e.g.
    # `https://api.pagepay.ng`).
    # NOTE: Paystack uses your SECRET KEY to sign webhooks (no separate webhook secret).
    public_base_url: str = "http://localhost:8000"
    # Frontend URL for redirects after payment (wallet funding, subscriptions).
    # Development: exp://localhost:8081 (Expo dev client)
    # Production: client:// (app custom scheme, opens the app directly)
    # This is overridden by FRONTEND_URL env var in production.
    frontend_url: str = "client://"

    # ── Withdrawal fee tiers ────────────────────────────────────────
    # Mirrors Paystack's flat-fee transfer schedule (₦10 / ₦25 / ₦50) with
    # a markup on top. The user pays the fee in addition to the
    # withdrawal amount and receives the full amount they requested.
    # Markup goes to the merchant (us) as profit. The user always gets
    # the full amount they typed; we eat the difference between the fee
    # they pay and the fee Paystack charges us.
    #
    # Default schedule (set in ops meeting 2026-06-30):
    #   ≤ ₦5,000          → ₦15 total user fee (Paystack ₦10, profit ₦5)
    #   ₦5,001 – ₦50,000  → ₦35 total user fee (Paystack ₦25, profit ₦10)
    #   > ₦50,000         → ₦70 total user fee (Paystack ₦50, profit ₦20)
    #
    # Stored as a comma-separated list of `max_kobo:fee_kobo` pairs,
    # last pair has no max (interpreted as "everything above"). Example
    # for the default schedule:
    #   WITHDRAWAL_FEE_TIERS=500000:1500,5000000:3500,inf:7000
    #
    # The payouts router uses `compute_withdrawal_fee(amount_kobo)` which
    # walks the tiers in order and returns the matching fee.
    withdrawal_fee_tiers: str = "500000:1500,5000000:3500,inf:7000"
    # Minimum withdrawal in kobo. We default to ₦1,000 (100,000 kobo) so
    # the fee never exceeds 1.5% of the withdrawal — below that, the fee
    # feels punitive to the user. Bumping to ₦5,000 would push the max
    # fee-to-amount ratio down to 0.3%, at the cost of requiring more
    # points to cash out.
    min_withdrawal_kobo: int = 100000

    # ── Money-flow caps (anti money-laundering) ────────────────────
    # Per-transaction caps. The wallet.deposit and payouts.withdraw
    # endpoints enforce these BEFORE calling Paystack. Without them,
    # a stolen-card deposit can move through the system unconstrained.
    # 10,000,000 kobo = ₦100,000 per single deposit.
    max_deposit_kobo_per_tx: int = 10_000_000
    # 20,000,000 kobo = ₦200,000 per single withdrawal.
    max_withdrawal_kobo_per_tx: int = 20_000_000
    # 24-hour rolling caps. Tracked in-memory per process (sufficient
    # for a single Render instance; would need Redis if we scale out).
    # 50,000,000 kobo = ₦500,000 deposit/day.
    max_deposit_kobo_per_day: int = 50_000_000
    # 50,000,000 kobo = ₦500,000 withdrawal/day.
    max_withdrawal_kobo_per_day: int = 50_000_000

    admob_app_id_android: str | None = None
    admob_app_id_ios: str | None = None
    applovin_sdk_key: str | None = None
    # IMPORTANT: AdMob SSV uses ECDSA P-256 signature verification with
    # Google's public keys (fetched from gstatic.com/admob/reward/verifier-keys.json),
    # NOT HMAC-SHA256 with a shared secret. This field is kept for backwards
    # compatibility or reserved for future use (e.g., webhook authentication
    # layer in front of the SSV endpoint). The actual SSV verification logic
    # in routers/ads.py:admob_ssv_callback uses cryptography.hazmat ECDSA
    # verification. See: https://developers.google.com/admob/android/ssv
    admob_webhook_secret: str | None = None
    # AppLovin SSV shared secret. The AppLovin webhook handler
    # returns 501 until this is set (the rest of the AppLovin
    # integration lands when the spec calls for it).
    applovin_webhook_secret: str | None = None

    # ── Ad reward payout (SSV-only flow) ────────────────────────────
    # The platform keeps `platform_ad_revenue_percent` (20%) of what an
    # ad grosses; the user gets the rest. Only rewarded_* ad units earn —
    # in-feed and interstitial credits are blocked at the SSV handler.
    #
    # Two values, not one:
    #   `rewarded_ad_gross_points` is what an ad is worth, in points. At
    #     10 pts/₦ the $1.50 Nigerian rewarded-video eCPM assumption is
    #     ₦2.00 = 20 points.
    #   `rewarded_ad_payout_points` is what the user is credited, derived
    #     from the percent so the two can never drift apart.
    #
    # This used to be a single `rewarded_ad_payout_points = 20` holding
    # the GROSS figure. The name implied it was the payout, which made
    # "pay 20, keep 4" look like the model — when the actual credit is
    # 16. That error took a full analysis pass to unwind, so the naming
    # is now explicit and the payout is derived rather than hand-set.
    # Override via env `REWARDED_AD_GROSS_POINTS`.
    rewarded_ad_gross_points: int = 20
    # Points credited per rewarded ad to the user's spendable balance.
    # Derived: gross × (1 - platform_ad_revenue_percent).
    # Must land in `service_credit_balance`, never cashable — as
    # spendable service the payout costs ~₦0.81 to serve, which is what
    # keeps the margin at ~60% instead of ~20%.
    # Override via env `REWARDED_AD_PAYOUT_POINTS`.
    rewarded_ad_payout_points: int = int(20 * (1 - 0.20))  # 16
    # Bonus credited to the user when they finish a 1-minute reading
    # slice, independent of any ads watched. Settled at /session/end.
    # Override via env `READING_SLICE_BONUS_POINTS`.
    # Floor for participation: ads still dominate the reward (~80%),
    # but the user always gets *something* for finishing the slice.
    reading_slice_bonus_points: int = 2
    # Lifetime of an ad-request token. 5 minutes matches AdMob's
    # recommended window for a rewarded video to complete. Too short =
    # legit slow networks miss credits. Too long = attackers can
    # stockpile tokens.
    ad_request_token_ttl_seconds: int = 300
    # Per-user rate limit on /api/v1/ads/request-token. 30/min = 1
    # ad every 2s sustained. Caps attacker token-stuffing without
    # blocking legit users (a heavy user might watch 10-20 ads/day,
    # well under 30/min).
    ad_request_rate_limit_per_minute: int = 30
    # When True, credit/debit sites write to the new split-ledger columns
    # (service_credit_balance + cashable_balance). When False, legacy
    # behavior writes to points_balance. Default False for staged rollout.
    # Override via env `WALLET_SPLIT_ENABLED`.
    wallet_split_enabled: bool = True
    # Daily ad impression cap across all networks and use cases.
    # Override via env `DAILY_AD_IMPRESSION_CAP`.
    daily_ad_impression_cap: int = 200

    # ── Phase 8: Bills & Earn (VTU aggregator) ────────────────────────
    # Peyflex is the primary VTU provider (airtime, data, electricity, TV).
    # API key from peyflex.com.ng dashboard — never commit the real value.
    peyflex_api_key: str | None = None
    peyflex_base_url: str = "https://client.peyflex.com.ng/api"

    # Bigisub VTU provider (airtime, data, electricity, TV).
    # API key + PIN from bigisub.ng dashboard — never commit the real values.
    bigisub_api_key: str | None = None
    bigisub_base_url: str = "https://api.bigisub.ng/api/v2"
    bigisub_pin: str | None = None

    # Active VTU provider: "peyflex" or "bigisub".
    bills_provider: str = "peyflex"

    # Commission split: portion of the aggregator's commission that goes
    # back to the user as points (the rest funds the platform).
    # 0.70 = user gets 70% of the commission, platform keeps 30%.
    bills_user_share: float = 0.70
    # Every Nth item in the catalog feed is a sponsored slot. The
    # spec's default is 4 (in-feed native every 4th item). Set to
    # 0 to disable sponsored rotation entirely (rare — only for
    # diagnosing ad-funnel issues).
    feed_sponsored_every: int = 4
    # Maximum number of sponsored items returned per feed request.
    # Bounds the response size and prevents a sparse catalog from
    # returning a wall of ads.
    feed_max_sponsored: int = 5

    # Shared secret required by X-Admin-Token on /admin/* endpoints. The
    # cron container and any operator script must send the same value.
    # In dev it's the default below; production must override via env.
    admin_token: str = "dev-admin-token"

    # ── Auth: failed-login lockout + rate limit ──────────────────────
    # Account lockout policy. After `auth_max_failed_attempts` bad
    # passwords the account is locked for `auth_lockout_minutes`
    # minutes. Both are deliberately generous — a real user
    # mistyping should reset by the next session, but a brute-force
    # attacker with the right username is capped at 5 tries per lockout.
    # Override via env `AUTH_MAX_FAILED_ATTEMPTS` / `AUTH_LOCKOUT_MINUTES`.
    auth_max_failed_attempts: int = 5
    auth_lockout_minutes: int = 15

    # slowapi rate-limit DSL applied to POST /auth/login. The string
    # "<count>/<window>" is parsed by slowapi at request time:
    #   "5/15minutes" → max 5 calls per 15-minute window per key
    #   (key = user-id if authenticated, else client IP)
    # Override via env `AUTH_LOGIN_RATE_LIMIT` if you want to relax
    # this in dev (e.g. "100/minute") without touching code.
    auth_login_rate_limit: str = "5/15minutes"

    # ── APScheduler: in-process scheduled jobs ────────────────────────
    # Daily study reminder push notification time (UTC). Override via
    # env DAILY_REMINDER_HOUR / DAILY_REMINDER_MINUTE.
    daily_reminder_hour: int = 8
    daily_reminder_minute: int = 0

    # ── Referral program ─────────────────────────────────────────────
    # Points credited to the referrer when their referee completes the
    # first verified reading session. 500 pts = ₦50 at the default
    # 10 pts/₦1 rate. Override via env `REFERRAL_REFERRER_REWARD`.
    referral_referrer_reward: int = 500
    # Points credited to the referee when they complete signup using a
    # valid referral code (well — credited when they finish their first
    # session, not on signup itself). 200 pts = ₦20.
    referral_referee_reward: int = 200
    # Hard cap on how many referral rewards a single user can claim
    # in one calendar day. Bounds the cost of the program against a
    # single user farming themselves across many device-emulated
    # signups. Fraud detection still runs on top of this — daily cap
    # is the cheap first line of defense.
    referral_daily_cap: int = 10
    # Welcome bonus credited to a brand-new user on first signup. 100 pts
    # = ₦10 at the default 10 pts/₦1 rate. Idempotency is enforced by
    # the UNIQUE(user_id, source) constraint on point_credits — a
    # duplicate insert for the same user is a no-op, never a double
    # credit. Set to 0 to disable the bonus entirely (e.g. for a
    # re-launch promo) — the welcome email + in-app notification still
    # fire so the user knows they're onboarded.
    welcome_bonus_points: int = 100
    # Public base URL used to build share links of the form
    # "<base>/<code>". The client opens these as deep links into the
    # Expo app, where the route handler reads the code from the path.
    # In dev override with a tunnel URL (e.g. ngrok) so phones off-WiFi
    # can resolve the link.
    referral_app_base_url: str = "https://pagepay.app/ref"

    # ── FX rate lookup ──────────────────────────────────────────────
    # We hit `open.er-api.com` (free, no key) for live USD→NGN. The
    # URL is overrideable so tests / staging can point at a mock
    # server without patching code. Override via env `FX_URL`.
    fx_url: str = "https://open.er-api.com/v6/latest/USD"
    # In-process cache TTL. 60s balances "don't hammer upstream" vs
    # "don't lose money to stale rates during NGN volatility".
    fx_cache_ttl_seconds: int = 60
    fx_http_timeout_seconds: float = 5.0

    # ── AI provider credentials ───────────────────────────────────
    # Text generation runs on Cloudflare Workers AI (app/ai/router.py).
    # `gemini_api_key` is still used by the task-submission
    # verifier (app/services/ai_verification.py); the retired
    # Gemini/Groq/OpenRouter router settings were removed in the
    # AI router cleanup.
    gemini_api_key: str | None = None

    # ── Nitter mirrors (Twitter follow verification fallback) ───────
    # The Twitter API is paid and rate-limited; Nitter is an open
    # frontend that anyone can self-host. We try the public mirrors
    # in order until one returns "is_following=true". Uptime is
    # volatile so we list multiple. Stored as a comma-separated string
    # so the env override is straightforward (`NITTER_INSTANCES=
    # https://nitter.net,https://nitter.poast.org`). The router
    # reads it via `settings.nitter_instances_list` which splits and
    # strips. Default below is the three public mirrors we test
    # against in CI; swap freely in dev/staging.
    nitter_instances: str = (
        "https://nitter.net,"
        "https://nitter.space,"
        "https://lightbrd.com,"
        "https://nitter.catsarch.com"
    )

    @property
    def nitter_instances_list(self) -> list[str]:
        """Nitter mirrors as a list of trimmed, non-empty URLs.

        Order = priority. Caller iterates and stops at the first
        mirror that answers. We never reorder at runtime — the
        env-supplied order is the contract.
        """
        return [u.strip() for u in self.nitter_instances.split(",") if u.strip()]

    # ── Hive blockchain blog sync ───────────────────────────────────
    # Hive's official JSON-RPC endpoint for fetching posts. Phase 5
    # adds the cron job that pulls community blogs into our catalog.
    hive_api_url: str = "https://api.hive.blog"
    # Base URL used to build the canonical post URL we store in
    # content_catalog.source_url. Override via env `HIVE_BASE_URL`.
    hive_post_base_url: str = "https://hive.blog"

    # Default `max_tokens` for `ai.router.route_ai` when the caller
    # doesn't pin a value. 4000 tokens ≈ 3000 words ≈ ~10 pages of
    # plain prose — enough for any MCQ/flashcard/essay generator.
    # Override via env `AI_DEFAULT_MAX_TOKENS`.
    ai_default_max_tokens: int = 4000

    # Sampling temperatures. Structured/JSON generators stay cold for
    # parseable output; the chat tutor runs warmer for natural
    # conversation (see the note in app/ai/prompts.py).
    # Override via env `AI_TEMPERATURE_DEFAULT` / `AI_TEMPERATURE_CHAT`.
    ai_temperature_default: float = 0.3
    ai_temperature_chat: float = 0.7

    # Daily chat quota per user. /study/chat calls a paid model with no
    # free tier, so an unmetered endpoint is an open bill: a scripted
    # client could otherwise drain the Cloudflare account.
    #
    # Free is 5/day, deliberately low. Measured with model routing live
    # (68% Granite at ~N0.68/turn, 32% GLM at ~N2.43/turn) the blended
    # cost is ~N1.24/turn, so 5 turns/day is ~N186/user/month — an
    # acquisition cost the rewarded-ad margin (~N120/user/month at 10
    # ads/day) nearly covers. At the previous 50/day the same user cost
    # ~N1,860/month against ~N0 of revenue.
    #
    # Premium is 15/day: ~N556/month at full use, which leaves comfortable
    # margin against the subscription price. Metering beyond the quota
    # recovers the rest — see PRICING_AND_UNIT_ECONOMICS.md.
    #
    # Failed model calls refund the slot (services/ai_usage.py).
    # Override via env `STUDY_CHAT_DAILY_LIMIT` /
    # `STUDY_CHAT_PREMIUM_DAILY_LIMIT`.
    study_chat_daily_limit: int = 5
    study_chat_premium_daily_limit: int = 15

    # ── Paid chat turns (beyond the daily quota) ─────────────────────
    # Once the free quota is used, a student can buy a turn with SV.
    # Priced by the tier the question routes to, so the price tracks
    # the cost: Premium answers use GLM-4.7-Flash (~N2.43/turn) and
    # Standard ones Granite (~N0.68/turn).
    #
    # `study_chat_paid_daily_limit` caps billable turns per 24h window,
    # on top of the free quota. Without it a scripted client could buy
    # indefinitely, and the exposure stops being predictable.
    # Override via env `STUDY_CHAT_PAID_DAILY_LIMIT` /
    # `STUDY_CHAT_SV_STANDARD` / `STUDY_CHAT_SV_PREMIUM`.
    study_chat_paid_daily_limit: int = 50
    study_chat_sv_standard: int = 15
    study_chat_sv_premium: int = 35

    # Premium's monthly SV allowance, and the discount on topping up.
    #
    # The allowance is what makes the subscription price defensible: at
    # N3,000/month with 2,500 SV (N250 of compute, ~85 standard chat
    # turns) the base cost of serving a subscriber is ~N250 against
    # N3,000, and anything they buy beyond it is margin.
    #
    # top_up_discount_percent applies to *unified* deposits - see
    # services.sv_packs. A premium user buying N1,000 of SV receives
    # N1,000 worth at the undiscounted rate less 30%.
    # Override via env `PREMIUM_SV_MONTHLY_ALLOWANCE` /
    # `PREMIUM_TOP_UP_DISCOUNT_PERCENT`.
    premium_sv_monthly_allowance: int = 2_500
    premium_top_up_discount_percent: float = 0.30

    # Minimum effective reading duration (seconds) before a session is
    # considered "verified" and eligible for the slice bonus. The
    # session state machine sets `verified=True` only after the user
    # has both scrolled AND read for at least this many seconds.
    # 30s is intentionally shorter than the 60s post-read modal
    # threshold so the bonus settles even when a user skips the
    # post-read ad (the whole point of the bonus).
    session_verified_min_seconds: int = 30

    # ── AI verification confidence thresholds ─────────────────────────
    # Platform-wide gates for "is this submission verified by AI". The
    # same value is used across all social/URL/screenshot verifiers
    # (Instagram, TikTok, YouTube, Twitter, etc.) so the user-facing
    # trust floor is consistent.
    #
    # Notes on values:
    #   - 0.7 (= "the verifier is at least 70% sure") is the floor
    #     for a verified=true return from social channels.
    #   - 0.95 is the "high quality" gate in task_processor that grants
    #     a bonus 5 XP on top of the base 10 XP.
    ai_verification_confidence_floor: float = 0.7
    ai_high_quality_confidence_floor: float = 0.95

    # ── Task reputation / XP ─────────────────────────────────────────
    # Base XP awarded per *approved* task submission, plus the bonus
    # when the AI reports "high quality" (≥ ai_high_quality_confidence_floor).
    # Override via env `TASK_XP_BASE` / `TASK_XP_HIGH_QUALITY_BONUS`.
    task_xp_base: int = 10
    task_xp_high_quality_bonus: int = 5
    # XP curve steepness: each level-up multiplies the XP-to-next-level
    # by this factor. 1.5 = 50% more XP per level (classic RPG curve).
    task_xp_level_multiplier: float = 1.5

    # ── Study unlock costs ───────────────────────────────────────────
    # Points the user must spend to unlock a study asset. Videos cost
    # more because they require AI generation (expensive) and the
    # user gets longer-form content. Asset rows default to these
    # values when the row is created; the per-row `points_to_unlock`
    # column overrides per-asset if needed (i.e. for premium content).
    study_unlock_points_cost: int = 50
    study_video_unlock_points_cost: int = 200

    # ── Database connection pool ─────────────────────────────────────
    # Async engine pool tuning. Production runs behind uvicorn workers
    # so the total open connections is roughly
    # (workers × (pool_size + max_overflow)). The defaults
    # (20+10=30 per worker, pool_recycle 1800s = 30 min) match
    # asyncpg's recommended idle-window to dodge stale-connection
    # errors on managed Postgres (RDS, Supabase, Neon).
    db_pool_size: int = 10
    db_max_overflow: int = 5
    db_pool_recycle_seconds: int = 300

    # ── HTTP request body cap ────────────────────────────────────────
    # The RequestSizeLimitMiddleware rejects anything bigger than these
    # to keep a single client from DoS'ing the process. JSON/API
    # payloads default to 1 MB; multipart (file uploads) get 10 MB
    # because the SOW upload is a multipart POST of an image + PDF.
    # Override via env `MAX_JSON_BODY_BYTES` / `MAX_MULTIPART_BODY_BYTES`.
    max_json_body_bytes: int = 1 * 1024 * 1024         # 1 MB
    max_multipart_body_bytes: int = 10 * 1024 * 1024   # 10 MB

    # ── AI model routing ─────────────────────────────────────────────
    # Student chat is served by one of two models, chosen by question
    # complexity. The cheap model handles definitions and recall; the
    # premium model is reserved for multi-step reasoning, where getting
    # it wrong costs a student an exam.
    #
    # Measured at 17k input + 2k output tokens, ₦1,332/USD:
    #   premium ~₦2.43/turn, standard ~₦0.68/turn — a 3.6x cut on any
    #   turn the standard model can answer correctly.
    #
    # The classifier errs toward premium: a cheap wrong answer is worse
    # than an expensive right one. Turn `enabled` off to route
    # everything to premium while validating the split.
    # Override via env `AI_ROUTING_ENABLED` / `AI_STANDARD_MODEL` /
    # `AI_PREMIUM_MODEL`.
    # Publishing cost per M tokens, USD, keyed by model id. Used to
    # compute `AiUsageLog.cost_usd` at write time, so usage telemetry
    # stays comparable across a price change rather than being rewritten
    # by one. Values are the published list prices from Cloudflare's
    # pricing page (workers-ai/platform/pricing).
    # TTS is not token-priced: MeloTTS is $0.0002/audio-minute, logged
    # separately by the narration path.
    ai_model_cost_usd: dict[str, dict[str, float]] = {
        "@cf/ibm-granite/granite-4.0-h-micro": {
            "input": 0.017,
            "output": 0.112,
        },
        "@cf/zai-org/glm-4.7-flash": {
            "input": 0.060,
            "output": 0.400,
        },
        "@cf/meta/llama-3.2-11b-vision-instruct": {
            "input": 0.049,
            "output": 0.676,
        },
    }
    # Cost per audio-minute for MeloTTS, logged by the narration path.
    ai_tts_cost_usd_per_minute: float = 0.0002

    ai_routing_enabled: bool = True
    ai_standard_model: str = "@cf/ibm-granite/granite-4.0-h-micro"
    ai_premium_model: str = "@cf/zai-org/glm-4.7-flash"
    # Target share of turns sent to the standard model. Logged per call
    # so the actual split can be compared against this once real data
    # exists; not enforced — complexity decides, not a quota.
    ai_standard_share_target: float = 0.70

    # ── Content slicer tuning ────────────────────────────────────────
    # Casual-reader slicer (slicer.py): target chars per slice, hard
    # cap, and "don't bother slicing if shorter than this" threshold.
    # The defaults give a ~1-minute read at ~3,000 chars/min.
    # Override via env `SLICE_TARGET_CHARS` / `SLICE_MAX_CHARS` /
    # `SLICE_NO_SLICE_THRESHOLD_CHARS`.
    slice_target_chars: int = 3_000
    slice_max_chars: int = 3_900     # = TARGET × 1.30
    slice_no_slice_threshold_chars: int = 3_600

    # Topic-aware slicer (topic_slicer.py): same idea but for
    # OpenStax/education content, where we chunk by topic boundary
    # rather than raw char count. Defaults mirror the casual slicer.
    topic_slice_target_chars: int = 3_000
    topic_slice_max_chars: int = 3_600
    topic_slice_single_unit_threshold: int = 3_000

    # ── TTS (hybrid) ───────────────────────────────────────────────
    # Provider order for on-demand study TTS. First available provider
    # wins. Free tiers:
    #   Cloudflare Workers AI MeloTTS: free tier / pay-as-you-go
    #   NVIDIA Magpie TTS: free prototype tier, ~40 RPM
    #   OpenRouter: free :free models, ~20 RPM
    #   Gemini 3.1 Flash TTS: free tier input+output
    #   edge-tts: free, no key required, Microsoft neural voices
    tts_default_provider: str = "cloudflare"
    tts_default_voice: str = "en-US-AriaNeural"
    tts_default_rate: str = "+0%"
    tts_batch_concurrency: int = 5

    # ── Paid audio narration (study) ────────────────────────────────
    # Users pay service credits (SV) per generated episode. Deeper
    # explanation levels produce longer scripts, so they cost more.
    # Overridable via env so pricing can be tuned without a deploy.
    audio_narration_char_step: int = 500      # billed per this many output characters
    audio_narration_base_sv: dict[str, int] = {
        "primary": 10,
        "secondary": 15,
        "tertiary": 20,
        "research": 25,
    }
    # SV charged per char_step, by level.
    #
    # Rate floor rationale: producing 1,000 characters of narration
    # costs ~₦0.43 at current Cloudflare rates (MeloTTS $0.0002/audio
    # minute is ~69% of that; GLM output the rest). At 10 SV = ₦1, the
    # minimum rate must exceed ₦0.43 per 1k chars, i.e. > 4.3 SV per
    # char_step. `primary` was 4 SV, which was below cost and only
    # stayed solvent because `base_sv` subsidised it — raised to 6 so
    # every level clears marginal cost on its own. Revisit if either
    # the Cloudflare rate or the SV↔naira rate changes.
    audio_narration_rate_sv: dict[str, int] = {
        "primary": 6,
        "secondary": 6,
        "tertiary": 8,
        "research": 10,
    }
    # Hard ceiling on what one episode may narrate, so a single request
    # can never run away with tokens. ~10 min of speech at 150 wpm.
    audio_narration_max_chars: int = 8000
    # Target length for one episode; over this, a topic splits into
    # sequential episodes (index 0, 1, 2...) rather than one long file.
    audio_episode_target_chars: int = 6000
    audio_episode_max_chars: int = 8000

    # Provider API keys (all optional — missing keys skip that provider).
    cloudflare_account_id: str | None = None
    cloudflare_api_token: str | None = None
    nvidia_nim_api_key: str | None = None
    openrouter_api_key: str | None = None
    gemini_api_key: str | None = None

    # NVIDIA NIM TTS endpoint (Magpie TTS Multilingual).
    # Override via env NVIDIA_NIM_TTS_URL if you host it yourself.
    nvidia_nim_tts_url: str = "https://integrate.api.nvidia.com/v1/audio/synthesize_online"
    nvidia_nim_tts_voice: str = "Magpie-ZeroShot-Multilingual"

    # ── Content fetcher User-Agents ──────────────────────────────────
    # Both Gutendex and OpenStax require an identifying UA — the
    # default `python-httpx/x.y` gets 403'd. We default to a
    # "PagePay/<ver>" UA with the public contact URL. Override via
    # env `USER_AGENT_GUTENDEX` / `USER_AGENT_OPENSTAX` if you want to
    # identify a specific deployment (staging, fork, etc.).
    user_agent_gutendex: str = "PagePay/1.0 (+https://pagepay.app)"
    user_agent_openstax: str = "PagePay/1.0 (+https://pagepay.app) Education-Ingest"

    # ── Seed: bootstrap admin credentials ─────────────────────────────
    # Used by `app/seed.py` to create the very first admin row on an
    # empty DB. Defaults are the dev "admin@pagepay.app / admin123"
    # pair; in production both MUST be overridden via env. (Don't
    # ship a real prod seed with the dev defaults — the seed script
    # is idempotent and won't re-run if any AdminUser already exists,
    # so a misconfigured prod seed silently leaves you with no admin
    # login. Always run `python -m app.seed` interactively once with
    # the right env vars set.)
    seed_admin_email: str = "admin@pagepay.app"
    seed_admin_password: str = "admin123"

    # ── Background task processor toggle ─────────────────────────────
    # When True the FastAPI lifespan starts the Phase 7 background
    # task processor (`services.task_processor.task_processor.start`).
    # Set to True ONLY on a single instance — running on every
    # uvicorn worker makes every submission get processed N times
    # (the processor is single-flight in DB but the row-locking
    # contention is real). The standard pattern is one dedicated
    # worker container with `RUN_TASK_PROCESSOR=true` and the rest
    # of the API containers with it unset.
    run_task_processor: bool = False

    # ── Wallet deposit fee (Paystack top-ups) ─────────────────────────
    # Platform fee charged on every wallet deposit. Computed as
    # `min(ceil(deposit_kobo × fee_percent), max_fee_kobo)` so the
    # fee scales with deposit size but is capped — a 1.5% / ₦20 cap
    # means small top-ups (₦100) pay ₦1.50, large ones (₦10k+) hit
    # the ₦20 ceiling.
    #
    # Both knobs are env-overridable (WALLET_DEPOSIT_FEE_PERCENT,
    # WALLET_DEPOSIT_MAX_FEE_KOBO) so ops can A/B the fee structure.
    wallet_deposit_fee_percent: float = 0.015     # 1.5%
    wallet_deposit_max_fee_kobo: int = 2000       # ₦20

    # Default platform fee percent used when a Sponsor / Task row is
    # created without an explicit value. Stored on the row (not
    # resolved per-credit) so the value at task-creation time freezes
    # the worker reward — changing this default only affects newly
    # created tasks, never in-flight ones. 30% = platform keeps 30%
    # of the gross reward, workers split 70%.
    default_platform_fee_percent: int = 30

    # AES-256-GCM encryption key for sensitive data at rest (e.g. NUBAN).
    # Must be a 32-byte (256-bit) base64-encoded key. Generate with:
    #   openssl rand -base64 32
    encryption_key: str | None = None

    # ── Email (Resend) ───────────────────────────────────────────────
    resend_api_key: str | None = None
    email_from: str = "PagePay <noreply@earn9ja.site>"
    # Public base URL for email links (verification, password reset).
    # Must be set in production to the real public domain.
    public_base_url: str = "http://localhost:8000"

    # ── OAuth2 (Google) ──────────────────────────────────────────────
    google_client_id: str | None = None
    
    # ── Phase 3: Firebase Cloud Messaging (Push Notifications) ───────
    # Two ways to provide Firebase Admin credentials, checked in order:
    #
    #   1. `firebase_service_account_json` — the raw JSON contents as a
    #      string. Preferred for managed deploys (Render, Railway, Fly,
    #      etc.) where the credential JSON is stored as a secret env
    #      var so nothing sensitive touches the repo or filesystem.
    #
    #   2. `firebase_service_account_path` — path to a JSON file on
    #      disk. Used for local dev where the file is in
    #      `backend/firebase-service-account.json` (gitignored).
    #
    # If neither is set / the file is missing, push notifications are
    # disabled at startup and a clear error is logged once.
    firebase_service_account_path: str = "firebase-service-account.json"
    firebase_service_account_json: str | None = None
    
    # ── Phase 7: Cloudinary for task proof uploads ───────────────────
    cloudinary_cloud_name: str | None = None
    cloudinary_api_key: str | None = None
    cloudinary_api_secret: str | None = None
    cloudinary_upload_folder: str = "pagepay/tasks"

    # ── v3 image proxy cache ────────────────────────────────────────
    # Where the /api/v1/content/images/proxy endpoint stores cached
    # upstream images. Two-level directory layout (first 2 hex chars
    # of the SHA1 /  the rest) keeps any single dir under ~65k
    # entries, well under ext4's per-dir link budget. Default is
    # /tmp for Render compatibility (Render filesystem is read-only
    # except /tmp). Production with persistent disk should set
    # IMAGE_CACHE_DIR=/var/lib/pagepay/image_cache. The lifespan
    # handler in main.py creates the dir on startup if it doesn't exist.
    image_cache_dir: str = "/tmp/pagepay_image_cache"
    # Maximum bytes the proxy will fetch from upstream before
    # refusing (default 5MB). Caps the worst case for a hostile or
    # broken upstream; legitimate OpenStax figures are <500KB.
    image_proxy_max_bytes: int = 5 * 1024 * 1024
    # TTL for the cached file. We don't actually expire files on
    # disk (would need a janitor); we just control the
    # Cache-Control header so the CDN/client caches for this long.
    # 30 days matches v3 §2.3.
    image_proxy_cache_ttl_seconds: int = 30 * 24 * 60 * 60

    # ── v3 audio TTS cache ───────────────────────────────────────────
    # Where /api/v1/content/audio/{unit_id}.mp3 serves pre-rendered
    # TTS files (v3 §3.3 Listen mode). Files are organized as
    # units/{shard}/{unit_id}.mp3 where shard is unit_id % 100 (two
    # digits). Default is /tmp for Render compatibility. Production
    # with persistent disk should set AUDIO_CACHE_DIR=/var/lib/pagepay/audio_cache.
    audio_cache_dir: str = "/tmp/pagepay_audio_cache"

    # ── Cloudflare R2 object storage (narrated audio) ───────────────
    # R2 is S3-compatible, so it reuses the same Cloudflare credentials
    # already configured for Workers AI: the S3 access key / secret key
    # pair and the account's S3 API endpoint. No separate credentials.
    #
    # Audio episodes are written here rather than to /tmp: Render's
    # filesystem is ephemeral and the free plan has no persistent disk,
    # so anything on disk is lost on spin-down or redeploy — which would
    # silently break audio the user has already paid for.
    #
    # Reads are served by a short-lived presigned GET URL (works with a
    # private bucket). Set cloudflare_r2_public_url only if the bucket
    # is public and you prefer to serve files straight from the CDN.
    cloudflare_access_key: str | None = None
    cloudflare_secret_access_key: str | None = None
    cloudflare_s3_api_endpoint: str | None = None
    # Bucket name is not derivable from the credentials, but it has a
    # sensible default so nothing extra needs configuring to start.
    cloudflare_r2_bucket: str = "pagepay"
    cloudflare_r2_public_url: str | None = None    # e.g. https://cdn.example.com
    cloudflare_r2_prefix: str = "study-audio"      # object key prefix in the bucket
    cloudflare_r2_presign_expiry_seconds: int = 3600  # 1 hour, refreshed on read
    # TTL for audio files. Same 30-day pattern as image proxy.
    # expo-av caches aggressively on the client, so this is mostly
    # for CDN edge cache (if we ever add one).
    audio_cache_ttl_seconds: int = 30 * 24 * 60 * 60

    # ── Platform revenue splits ──────────────────────────────────────
    # Ads: portion of ad revenue kept by platform (rest goes to user as points).
    # 0.20 = platform keeps 20%, user gets 80%. Override via env
    # `PLATFORM_AD_REVENUE_PERCENT`.
    platform_ad_revenue_percent: float = 0.20
    # Tasks: platform fee added on top of worker reward.
    # 0.30 = platform keeps 30% of total escrow, worker gets 70%.
    platform_task_revenue_percent: float = 0.30

    # ── Points ↔ Naira conversion (single source of truth) ───────────
    # How many points a worker earns per ₦1 of reward. The mobile
    # client mirrors this via EXPO_PUBLIC_POINTS_PER_NAIRA so both
    # sides always agree on the conversion — change one number in
    # both env files (or just in the backend, if you accept that the
    # client displays stale values until its next build) and every
    # task reward / wallet credit / display label updates in lockstep.
    # Default 10 = "10 points per ₦1" (1 point = ₦0.10). Override via
    # env `POINTS_PER_NAIRA`.
    #
    # Conversion helpers (used by task credit + display logic):
    #   kobo → points = kobo / 100 * POINTS_PER_NAIRA   (i.e. naira × POINTS_PER_NAIRA)
    #   points → naira = points / POINTS_PER_NAIRA
    #   points → kobo  = (points / POINTS_PER_NAIRA) * 100
    points_per_naira: int = 10

    # ── Premium subscription pricing ──────────────────────────────────
    # Stored in kobo so we never deal with floats for money.
    # Override via env vars without a deploy. Paystack
    # charge amounts are derived from these via services.subscription.
    #
    # One paid plan (Premium) in two billing periods. The four tier keys
    # in tier_benefits.json all resolve to these same figures, so the
    # distinct names are legacy aliases rather than separate products.
    # Consolidating UserTier itself needs a data migration —
    # get_tier_config falls back to `free` for an unknown key, so a
    # rename could silently demote a paid user — and is deliberately
    # not done here.
    #
    #   study_plus_monthly_price_kobo: env STUDY_PLUS_MONTHLY_PRICE_KOBO
    #   study_plus_yearly_price_kobo:  env STUDY_PLUS_YEARLY_PRICE_KOBO
    #   complete_plus_monthly_price_kobo: env COMPLETE_PLUS_MONTHLY_PRICE_KOBO
    #   complete_plus_yearly_price_kobo:  env COMPLETE_PLUS_YEARLY_PRICE_KOBO
    #
    # Legacy aliases (PREMIUM_MONTHLY_PRICE_KOBO / PREMIUM_YEARLY_PRICE_KOBO)
    # map to the same plan so existing .env files keep working.
    study_plus_monthly_price_kobo: int = 300_000    # ₦3,000
    study_plus_yearly_price_kobo: int = 3_000_000   # ₦30,000
    complete_plus_monthly_price_kobo: int = 300_000  # ₦3,000
    complete_plus_yearly_price_kobo: int = 3_000_000 # ₦30,000
    premium_monthly_price_kobo: int = 100_000       # legacy alias → study_plus_monthly
    premium_yearly_price_kobo: int = 1_000_000      # legacy alias → study_plus_yearly

    # Points multiplier granted to active premium subscribers. Premium
    # users earn `premium_points_multiplier` × the base rate on every
    # activity that runs through `services.subscription.get_points_multiplier`
    # (reading time, ad rewards, task payouts). 2.0 = "earn double".
    # Override via env PREMIUM_POINTS_MULTIPLIER.
    premium_points_multiplier: float = 2.0

    # ── Premium activity-specific multipliers ────────────────────────
    # Individual multipliers for each activity type. Loaded from .env
    # and used as fallback if tier_benefits.json doesn't define them.
    # Reading slice bonus multiplier (default 2.0x)
    premium_reading_multiplier: float = 2.0
    # Ad reward multiplier (default 1.5x, not 2.0x like other activities)
    premium_ad_multiplier: float = 1.5
    # Task reward multiplier (default 2.0x)
    premium_task_multiplier: float = 2.0
    # Daily reward multiplier (default 2.0x)
    premium_daily_multiplier: float = 2.0
    # Bills cashback multiplier (default 2.0x)
    premium_bills_multiplier: float = 2.0

    # ── Content type detection for ad gating ─────────────────────────
    # Content sources that are always ad-free (study materials).
    # Comma-separated list. Override via env AD_FREE_CONTENT_SOURCES.
    ad_free_content_sources: str = "openstax,openstax_textbook"
    # Content sources that are ad-supported (novels, news, etc.).
    # Comma-separated list. Override via env AD_SUPPORTED_CONTENT_SOURCES.
    ad_supported_content_sources: str = "gutenberg,gnews,user_upload"
    # Default behavior for unknown sources (ad_supported or ad_free).
    # Override via env DEFAULT_CONTENT_AD_BEHAVIOR.
    default_content_ad_behavior: str = "ad_supported"

    # ── Premium ad skip permissions ──────────────────────────────────
    # Whether premium users can skip pre-read ads on novels.
    # Override via env PREMIUM_CAN_SKIP_PRE_READ_ADS.
    premium_can_skip_pre_read_ads: bool = True
    # Whether premium users can skip post-read ads on novels.
    # Override via env PREMIUM_CAN_SKIP_POST_READ_ADS.
    premium_can_skip_post_read_ads: bool = True
    # Whether premium users can skip feed ads in catalog.
    # Override via env PREMIUM_CAN_SKIP_FEED_ADS.
    premium_can_skip_feed_ads: bool = True

    # ── Premium subscription grace period ────────────────────────────
    # Number of days after subscription_expires_at before the user is
    # downgraded to FREE. During this window the user keeps premium
    # benefits. Override via env PREMIUM_GRACE_PERIOD_DAYS.
    premium_grace_period_days: int = 3

    # ── Tier benefits JSON configuration ─────────────────────────────
    # Path to tier_benefits.json file (relative to backend/app or absolute).
    # Override via env TIER_BENEFITS_JSON_PATH.
    tier_benefits_json_path: str = "tier_benefits.json"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def ad_free_sources_list(self) -> list[str]:
        """Parse AD_FREE_CONTENT_SOURCES into a list of source identifiers."""
        return [s.strip() for s in self.ad_free_content_sources.split(",") if s.strip()]

    @property
    def ad_supported_sources_list(self) -> list[str]:
        """Parse AD_SUPPORTED_CONTENT_SOURCES into a list of source identifiers."""
        return [s.strip() for s in self.ad_supported_content_sources.split(",") if s.strip()]

    @property
    def withdrawal_fee_tiers_parsed(self) -> list[tuple[int | None, int]]:
        """Parse `withdrawal_fee_tiers` into a list of (max_kobo, fee_kobo).

        The first tier whose `max_kobo >= amount_kobo` (or whose
        `max_kobo` is None) wins. The "inf" sentinel in the env value
        desugars to `None` (no upper bound).

        Format: comma-separated `max_kobo:fee_kobo` pairs, max
        ascending. Tiers MUST be sorted by `max_kobo` ascending or the
        router will apply the wrong fee. The default value is in that
        order. If the env value is malformed, the default is returned
        so dev/test never see a 500 from a typo.
        """
        default: list[tuple[int | None, int]] = [
            (500_000, 1_500),
            (5_000_000, 3_500),
            (None, 7_000),
        ]
        raw = (self.withdrawal_fee_tiers or "").strip()
        if not raw:
            return default
        parsed: list[tuple[int | None, int]] = []
        for piece in raw.split(","):
            piece = piece.strip()
            if not piece:
                continue
            try:
                max_str, fee_str = piece.split(":")
                max_str = max_str.strip()
                fee_str = fee_str.strip()
                max_kobo: int | None
                if max_str.lower() in ("inf", "none", "*"):
                    max_kobo = None
                else:
                    max_kobo = int(max_str)
                fee_kobo = int(fee_str)
            except (ValueError, AttributeError):
                # Malformed entry — fall back to the schedule we ship
                # in the default. This is a config bug, not a runtime
                # error, so don't crash the request path.
                return default
            parsed.append((max_kobo, fee_kobo))
        # Sanity: must be at least one tier.
        return parsed or default

    @model_validator(mode="after")
    def _check_default_secrets(self) -> "Settings":
        if self.environment == "production":
            if self.secret_key in ("dev-secret-change-me", "change-me-in-production-use-openssl-rand-hex-32", ""):
                raise ValueError("SECRET_KEY must be set to a strong random value in production")
            if not self.admin_token or self.admin_token in ("dev-admin-token",):
                raise ValueError("ADMIN_TOKEN must be set to a strong random value in production")
            if not self.encryption_key:
                raise ValueError("ENCRYPTION_KEY must be set in production for data-at-rest encryption")
        return self

    @model_validator(mode="after")
    def _check_ad_payout_matches_revenue_share(self) -> "Settings":
        """Keep the ad payout consistent with the platform's revenue share.

        `rewarded_ad_payout_points` is a deliberate ops override — it is
        useful to credit without a deploy, so it stays settable. But an
        env value wins over the derived default, and a stale one silently
        breaks the split: with the old `REWARDED_AD_PAYOUT_POINTS=20`
        still set alongside `PLATFORM_AD_REVENUE_PERCENT=0.20`, the
        payout equals the gross, so users get 100% and the platform keeps
        nothing while every config screen still claims 20%.

        A warning, not an error: the override is legitimate, and refusing
        to boot over a payout number would be worse than logging it.
        """
        import logging as _logging

        logger = _logging.getLogger("uvicorn.error")

        expected = int(self.rewarded_ad_gross_points * (1 - self.platform_ad_revenue_percent))
        actual = self.rewarded_ad_payout_points

        if actual != expected:
            logger.warning(
                "AD PAYOUT MISMATCH: rewarded_ad_payout_points=%s but gross=%s x "
                "(1 - platform_ad_revenue_percent=%s) = %s. The platform keeps "
                "%s pts of %s instead of the configured %.0f%%. If this is an "
                "env override, set REWARDED_AD_PAYOUT_POINTS=%s.",
                actual,
                self.rewarded_ad_gross_points,
                self.platform_ad_revenue_percent,
                expected,
                self.rewarded_ad_gross_points - actual,
                self.rewarded_ad_gross_points,
                self.platform_ad_revenue_percent * 100,
                expected,
            )
        return self


settings = Settings()  # type: ignore[call-arg]
