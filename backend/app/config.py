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
    cors_origins: str = "http://localhost:3000,http://localhost:8081,http://localhost:19006,https://pagepay-2e6i.onrender.com"

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
    # Base URL we expose to Paystack's dashboard (return URLs after a
    # checkout session; the webhook URL). Defaults to localhost so
    # `paystack-cli listen-forward` works out of the box. In production
    # this must be set to the real public domain (e.g.
    # `https://api.pagepay.ng`).
    # NOTE: Paystack uses your SECRET KEY to sign webhooks (no separate webhook secret).
    public_base_url: str = "http://localhost:8000"
    # Frontend URL for redirects after payment (wallet funding, subscriptions)
    frontend_url: str = "exp://localhost:8081"  # Expo dev default

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
    # How many points one rewarded ad is worth, before the user-share
    # discount. 10 × USER_SHARE (0.95) = 9 points credited per ad.
    # 9 points = ₦0.09. Adjust this single number to change the
    # per-ad payout; the value is read from settings (env-overridable)
    # and lives in exactly one place. Only rewarded_* ad units earn;
    # in-feed and interstitial credits are blocked at the SSV handler.
    rewarded_ad_payout_points: int = 10
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

    # ── Phase 3: AI providers ────────────────────────────────────────
    # Free-tier keys for the multi-provider router. All three are
    # optional: if a key is missing the router simply skips that
    # provider and falls through to the next one in the priority list.
    # Never commit real keys — use env vars or a secrets manager.
    gemini_api_key: str | None = None
    groq_api_key: str | None = None
    openrouter_api_key: str | None = None

    # ── Phase 8: Bills & Earn (VTU aggregator) ────────────────────────
    # Peyflex is the primary VTU provider (airtime, data, electricity, TV).
    # API key from peyflex.com.ng dashboard — never commit the real value.
    peyflex_api_key: str | None = None
    peyflex_base_url: str = "https://portal.peyflex.com.ng/api/v1"

    # Commission split: portion of the aggregator's commission that goes
    # back to the user as points (the rest funds the platform).
    # 0.67 = user gets 67% of the commission, platform keeps 33%.
    bills_user_share: float = 0.67
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
    # Path to Firebase service account JSON file downloaded from console
    firebase_service_account_path: str = "firebase-service-account.json"
    
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
    # TTL for audio files. Same 30-day pattern as image proxy.
    # expo-av caches aggressively on the client, so this is mostly
    # for CDN edge cache (if we ever add one).
    audio_cache_ttl_seconds: int = 30 * 24 * 60 * 60

    # ── Platform revenue splits ──────────────────────────────────────
    # Ads: portion of ad revenue kept by platform (rest goes to user as points).
    # 0.15 = platform keeps 15%, user gets 85%.
    platform_ad_revenue_percent: float = 0.15
    # Tasks: platform fee added on top of worker reward.
    # 0.30 = platform keeps 30% of total escrow, worker gets 70%.
    platform_task_revenue_percent: float = 0.30

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

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


settings = Settings()  # type: ignore[call-arg]
