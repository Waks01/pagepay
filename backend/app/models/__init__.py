from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import (
    String, Integer, BigInteger, Boolean, Text, DateTime, Time, Enum, Float,
    SmallInteger, JSON,
)
from datetime import datetime, time
import enum


class Base(DeclarativeBase):
    pass


class UserTier(enum.Enum):
    FREE = "free"
    PREMIUM_MONTHLY = "premium_monthly"
    PREMIUM_YEARLY = "premium_yearly"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(20), unique=True, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    points_balance: Mapped[int] = mapped_column(BigInteger, default=0)
    tier: Mapped[UserTier] = mapped_column(Enum(UserTier), default=UserTier.FREE)
    referral_code: Mapped[str | None] = mapped_column(String(12), unique=True)
    referred_by: Mapped[str | None] = mapped_column(String(12), index=True)
    referrals_today_count: Mapped[int] = mapped_column(Integer, default=0)
    referrals_today_reset_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    role: Mapped[str] = mapped_column(String(20), default="user")  # user | admin
    status: Mapped[str] = mapped_column(String(20), default="active", index=True)  # active | banned | suspended
    banned_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ban_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    banned_by: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    subscription_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # ── Auth security ─────────────────────────────────────────────────
    failed_login_attempts: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    email_verification_token: Mapped[str | None] = mapped_column(String(255), nullable=True)
    email_verification_code: Mapped[str | None] = mapped_column(String(255), nullable=True)
    email_verification_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_login_ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
    last_login_user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    device_fingerprint: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    transaction_pin_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # ── Phase 7: Social Tasks (moved from BillTransaction) ────────────
    is_worker: Mapped[bool] = mapped_column(Boolean, default=True)
    is_sponsor: Mapped[bool] = mapped_column(Boolean, default=False)
    sponsor_wallet_balance: Mapped[int] = mapped_column(BigInteger, default=0)
    sponsor_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    sponsor_kyc_status: Mapped[str] = mapped_column(String(20), default="none")
    sponsor_kyc_submitted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    sponsor_kyc_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    sponsor_kyc_reviewer_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    business_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    business_registration_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    sponsor_auto_approve_ai: Mapped[bool] = mapped_column(Boolean, default=False)

    # ── User profile (moved from BillTransaction) ─────────────────────
    gender: Mapped[str | None] = mapped_column(String(20), nullable=True)
    date_of_birth: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    country: Mapped[str] = mapped_column(String(50), default="Nigeria")
    languages: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── v3 Study data blob ───────────────────────────────────────────
    # Per-user highlights + notes, keyed by reading_unit_id. Stored as a
    # single JSON blob (not a normalized table) per v3 §1.5 — per-user
    # data that's never queried across users. The client batches writes
    # and syncs every ~10s, which only makes sense if the storage is a
    # single document. See books/design-plan-v3.md §3.2 and Appendix A
    # for the shape (`{"highlights": {unit_id: [...]}, "notes":
    # {unit_id: {...}}}`) and the rationale.
    # Default is `{}` (empty object, not NULL) so client code that reads
    # the field can index into it directly without a None check. The DB
    # column is nullable for historical rows that pre-date the column.
    study_data: Mapped[dict | None] = mapped_column(
        JSON, nullable=True, default=dict, server_default="{}"
    )


class BillTransaction(Base):
    """Record of a VTU bill-payment transaction (airtime, data, elec, TV).

    Every successful purchase via the Bills & Earn feature creates one of
    these rows. Each row records the provider commission earned and how
    many points were credited back to the user.
    """
    __tablename__ = "bill_transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    service: Mapped[str] = mapped_column(String(50))          # "airtime" | "data" | "electricity" | "tv"
    provider: Mapped[str] = mapped_column(String(30))         # "peyflex"
    phone: Mapped[str | None] = mapped_column(String(20))     # recipient phone (airtime/data)
    meter_number: Mapped[str | None] = mapped_column(String(30))  # for electricity
    smartcard_number: Mapped[str | None] = mapped_column(String(30))  # for TV
    amount_naira: Mapped[int] = mapped_column(Integer)         # what the user paid (kobo)
    commission_naira: Mapped[int] = mapped_column(Integer)     # aggregator commission (kobo)
    points_earned: Mapped[int] = mapped_column(Integer)        # points credited to user
    reference: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(20))            # "success" | "failed" | "pending"
    external_ref: Mapped[str | None] = mapped_column(String(100))  # peyflex transaction id
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_active_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    
    # ── User profile (kept for historical transaction records) ────────
    # Note: is_worker, is_sponsor, sponsor_*, business_*, and profile fields
    # are now stored on the User table. These columns remain for historical
    # transaction records only and are not updated after migration.


class ReadingSession(Base):
    __tablename__ = "reading_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, index=True)
    content_id: Mapped[int] = mapped_column(BigInteger, index=True)
    start_time: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    end_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    duration_seconds: Mapped[int] = mapped_column(BigInteger, default=0)
    points_earned: Mapped[int] = mapped_column(BigInteger, default=0)
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    scroll_events: Mapped[int] = mapped_column(BigInteger, default=0)
    paused_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    total_paused_seconds: Mapped[int] = mapped_column(BigInteger, default=0)
    # Reward-gate fields. `pending_points` is what the user *would* earn if
    # they complete the post-read ad claim. `points_earned` only becomes >0
    # after a successful POST /session/claim (which also stamps `claimed_at`).
    # This keeps the no-claim case from leaking free points into the wallet.
    pending_points: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ContentCatalog(Base):
    __tablename__ = "content_catalog"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(500))
    content_type: Mapped[str] = mapped_column(String(50))
    category: Mapped[str] = mapped_column(String(100), index=True)
    source_url: Mapped[str | None] = mapped_column(String(500), unique=True)
    body_text: Mapped[str | None] = mapped_column(Text)
    author: Mapped[str | None] = mapped_column(String(255))
    cover_image_url: Mapped[str | None] = mapped_column(String(500))
    estimated_read_minutes: Mapped[int] = mapped_column(Integer, default=5)
    is_sponsored: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Short-read slicing. Each book/article is one "parent work" and many
    # slices of ~2-minute reads. parent_work_id is the id of the original
    # full-content row (when present); read_order is the 1-indexed slice
    # number within the work. A standalone slice (no parent) has both NULL.
    # word_count and char_count enable the client to size banners / track
    # scroll-distance targets without re-measuring the body.
    parent_work_id: Mapped[int | None] = mapped_column(BigInteger, index=True, nullable=True)
    read_order: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_slices: Mapped[int | None] = mapped_column(Integer, nullable=True)
    word_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    char_count: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # ── Education + attribution fields (Phase: OpenStax integration) ──
    # `source` distinguishes casual reader content (gutendex/gnews) from
    # education content (openstax). The reader uses this to skip the
    # ad-gate / 1-min timer / point-earning flow for education rows.
    source: Mapped[str] = mapped_column(String(50), default="gutendex", index=True)
    # `education_level` is the creche/primary/secondary/tertiary/research
    # bucket used by the catalog's level filter. NULL on non-education rows.
    education_level: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    # `subject` is the broad academic subject (physics, mathematics, …).
    # Multiple books can share a subject; this drives subject filter chips.
    subject: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    # `class_level` is the grade or year inside an education_level
    # bucket — 'Grade 1' .. 'Grade 12' (primary + secondary), or
    # 'Year 1' .. 'Year 4' (tertiary). NULL on creche (no grades),
    # research, and casual reader content. The catalog uses this
    # together with education_level for the secondary "By class"
    # filter. See books/design-plan-v3.md §1.2 for the full mapping
    # + future country/region scoping plan.
    class_level: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    # `license_type` is the content's license. Ingestion is the gatekeeper:
    # only CC BY 4.0 / CC BY-SA 4.0 / public_domain are allowed into the
    # catalog. Anything NC is rejected at the ingest boundary.
    license_type: Mapped[str] = mapped_column(String(50), default="public_domain")
    # `attribution_text` is the pre-formatted attribution string the
    # AttributionCard component renders verbatim. We pre-format at ingest
    # time so the UI never has to reconstruct the license string from
    # separate fields.
    attribution_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── v3 reader sentinel contract version ──────────────────────────
    # 0 = plain text (pre-v3 slices, no sentinels in body_text)
    # 1 = v3 sentinels present ([[IMG:src|alt]], Caption: …,
    #     [TABLE START]…[TABLE END], [[EQ:…]]) per v3 §2.4
    # The reader checks this field before parsing. This lets us ship
    # the sentinel renderer now and roll the ingest change separately
    # without coordinating a client release. See migration
    # 017_content_body_sentinels_version.
    body_sentinels_version: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, default=0, server_default="0"
    )


class AdEvent(Base):
    __tablename__ = "ad_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, index=True)
    session_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    ad_type: Mapped[str] = mapped_column(String(50))
    ad_unit: Mapped[str] = mapped_column(String(100))
    provider: Mapped[str] = mapped_column(String(50))
    # Legacy Phase 1 column. BigInteger micro-USD (i.e. revenue × 1_000_000).
    # Stored as int at the DB level; the Python type is `int | None` because
    # `Mapped[float]` over BigInteger silently truncates fractional values
    # (e.g. 0.000123 → 0). The to_micro() helper in services/ads.py is the
    # only writer; readers should treat the int as micro-USD and divide.
    impression_revenue_usd: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    watched_fully: Mapped[bool] = mapped_column(Boolean, default=False)
    reward_granted: Mapped[bool] = mapped_column(Boolean, default=False)
    transaction_id: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    # ── Per-impression reward math fields ───────────────────────────────
    # `revenue_usd` is what the network reported for this single impression
    # (AdMob's onAdPaid callback, AppLovin's postback, etc.). Distinct from
    # `impression_revenue_usd` (BigInteger, micro-USD) which is the legacy
    # column kept for Phase 1 reporting compatibility.
    #
    # `fx_rate_used` is the live USD→NGN rate captured at credit time.
    # We persist it so a future reconciliation pass (Phase 4, Flutterwave
    # payout) can audit: "we credited at rate X; what was the rate Y minutes
    # later when the network settled?"
    #
    # `user_points_credited` is what we added to the wallet for this
    # impression. The math: revenue_usd × fx_rate_used × 0.95 (user share)
    # × 100 (100 pts = ₦1) for the legacy /ads/credit path. The new
    # SSV-only path uses a fixed payout_points × USER_SHARE — see
    # `AdRequest` below and routers/ads.py. Persisted so the wallet
    # transaction list and any future reconciliation can show the exact
    # value the user earned.
    #
    # All three columns are BigInteger micro-units at the DB level; the
    # Python type is `int | None`. See the comment on impression_revenue_usd
    # above for the rationale.
    revenue_usd: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    fx_rate_used: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    user_points_credited: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # Lifecycle of the credit itself:
    #   "credited"          — user share > 0, wallet bumped
    #   "rejected_low_value" — user share rounded to 0 pts; no credit (we
    #                          still record the impression but don't
    #                          fabricate a "1 point" floor)
    #   "duplicate"          — transaction_id already seen; idempotent no-op
    credit_status: Mapped[str] = mapped_column(String(50), default="credited")


class AdSsvLog(Base):
    """Log of ALL AdMob SSV callbacks - success and failure.
    
    Used for admin monitoring of SSV callback health, debugging signature
    failures, and detecting patterns like expired tokens or user mismatches.
    Every SSV callback attempt (whether it results in a credit or rejection)
    creates one row here.
    
    Indexes: user_id for per-user investigation, token for debugging specific
    requests, status for filtering in admin dashboard, created_at for
    time-based queries.
    """
    __tablename__ = "ad_ssv_logs"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # User from custom_data (may be NULL if custom_data was malformed)
    user_id: Mapped[int | None] = mapped_column(BigInteger, index=True, nullable=True)
    # Token from custom_data (may be NULL if custom_data was malformed)
    token: Mapped[str | None] = mapped_column(String(64), index=True, nullable=True)
    # AdMob transaction_id from query params
    transaction_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # ad_unit from query params
    ad_unit: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Status: 'success' | 'signature_failed' | 'expired' | 'duplicate' | 
    #         'user_mismatch' | 'malformed_custom_data' | 'unknown_token' |
    #         'non_rewarded_unit' | 'invalid_reward_amount'
    status: Mapped[str] = mapped_column(String(50), index=True)
    # Human-readable reason for rejections
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Full query params as JSON for debugging
    raw_query_params: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Points credited (NULL for failures)
    points_credited: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class AdFillRateEvent(Base):
    """Track ad lifecycle: requested → loaded → shown → completed → failed.
    
    Used to calculate fill rates, identify SDK issues, and monitor ad
    performance. Each stage of the ad lifecycle creates one row. For a
    successful ad watch, you'll see 4 rows with the same ad_request_id:
    requested, loaded, shown, completed.
    
    Indexes: user_id for per-user analysis, ad_unit for per-unit performance,
    stage for funnel queries, created_at for time-based analysis.
    """
    __tablename__ = "ad_fill_rate_events"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, index=True)
    session_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # Client-generated UUID to track one ad through its lifecycle
    ad_request_id: Mapped[str] = mapped_column(String(64), index=True)
    ad_unit: Mapped[str] = mapped_column(String(100), index=True)
    # Stage: 'requested' | 'loaded' | 'shown' | 'completed' | 'failed'
    stage: Mapped[str] = mapped_column(String(20), index=True)
    # Error code if stage = 'failed' (AdMob error code)
    error_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class ReadingProgress(Base):
    """Where a user is within a long-form work (book, article series).

    One row per (user, work). The `work_id` is the id of the parent
    ContentCatalog row (the unsliced book). The pointer at
    `current_slice_id` is which child slice they should read next, and
    `slices_completed` counts how many child slices they've finished.

    When a user opens the app, we read this to put them back where they
    left off. When they finish a slice, we bump `current_slice_id` to
    the next slice in the work; when they finish the last slice we set
    `is_finished=True` and stop tracking.

    Indexes: (user_id, work_id) is unique — one progress row per work
    per user. work_id is indexed because the catalog queries
    "who's mid-way through work X".
    """

    __tablename__ = "reading_progress"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, index=True)
    work_id: Mapped[int] = mapped_column(BigInteger, index=True)
    current_slice_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    current_slice_order: Mapped[int] = mapped_column(Integer, default=1)
    slices_completed: Mapped[int] = mapped_column(Integer, default=0)
    total_slices: Mapped[int] = mapped_column(Integer, default=0)
    is_finished: Mapped[bool] = mapped_column(Boolean, default=False)
    last_read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # ── Education unit pointer (Phase: OpenStax integration) ────────
    # Education content is sliced by topic (one topic = one slice), then
    # each slice is further chunked into 1-2 minute ReadingUnits. Units
    # within a slice are locked: unit 2+ of a topic is gated behind either
    # completing the previous unit or having premium tier. Casual reader
    # content (gutendex/gnews) has exactly 1 unit per slice, so these
    # columns stay NULL and the existing reader flow is unchanged.
    current_unit_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    current_unit_order: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # ── v3 3-mode reader switcher (Read/Study/Listen) ────────────────
    # Persists the user's last-picked mode for this work so a student
    # who defaults to Study on Physics keeps that preference. Per
    # v3 §3.4. The mode switcher is keyed per-work (not global) so a
    # physics book can stay in Study while a novel stays in Read.
    # The CHECK constraint at the DB level is enforced by migration
    # 016_user_study_data_and_reader_mode. Allowed values:
    #   'read'   — clean prose, swipe between units
    #   'study'  — highlights + notes + share-as-image
    #   'listen' — audio narration (TTS, deferred to a following sprint)
    reader_mode: Mapped[str] = mapped_column(
        String(16), nullable=False, default="read", server_default="read"
    )


class SliceBookmark(Base):
    """Scroll offset within a single slice body.

    One row per (user, slice). When a user scrolls past the saved
    offset by >300px we update the row. On resume, the reader fetches
    this row and scrolls to the saved offset.

    Separate from ReadingProgress because a user can be mid-scroll
    within a slice without having "finished" it. ReadingProgress is
    the coarse-grained "which slice"; SliceBookmark is the
    fine-grained "where within the slice".
    """

    __tablename__ = "slice_bookmarks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, index=True)
    slice_id: Mapped[int] = mapped_column(BigInteger, index=True)
    scroll_offset_px: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class PayoutAccount(Base):
    """The user's payout bank account. One row per user.

    Paystack-validated in Phase 4 (Payments). v1 stores the input as
    the user typed it (`verified=False`) so the UI can surface the
    link without Paystack being wired yet. When Phase 4 lands, the
    payouts router will call Paystack's `/transferrecipient/create`
    to populate `recipient_code` and flip `verified` to True once the
    account number resolves against the resolved name.

    `account_number` stores the encrypted 10-digit NUBAN. We never expose it
    back over the wire after the user has saved it — see
    `account_number_last4` on the PayoutAccount Pydantic response.

    `user_id` is UNIQUE so we get idempotent inserts (the payouts
    router does an upsert-by-user pattern, not append). Indexed on
    `user_id` so the per-user lookup is O(log n).
    """

    __tablename__ = "payout_accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True)
    bank_code: Mapped[str] = mapped_column(String(10))
    bank_name: Mapped[str] = mapped_column(String(120))
    account_number: Mapped[str] = mapped_column(Text)
    # Phase 4 will populate this from Paystack's `/transferrecipient/create`
    # response. The id we pass to /transfer when withdrawing.
    recipient_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Free-text account name. Phase 4 sets this from Paystack's `/verify`
    # response. v1 stores "Pending validation" if the user didn't supply one.
    account_name: Mapped[str] = mapped_column(String(255))
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    linked_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class PayoutTransaction(Base):
    """One row per initiated Paystack transfer.

    Lifecycle:
      1. The withdraw handler creates the row BEFORE calling Paystack
         (status='pending'). The balance debit happens in the same
         transaction so we never end up with a debit and no transfer
         record.
      2. Paystack's webhook handler updates the row when settlement
         lands:
           - 'transfer.success' → status='success', settled_at=now
           - 'transfer.failed' / 'transfer.reversed' → status='failed',
             points_balance is restored by the webhook handler too
      3. The row stays around as the audit trail.

    `reference` is the UUID we passed as `reference` to Paystack's
    `/transfer` call. Paystack's webhook payload echoes the same
    `reference` back, so the join is `WHERE reference = ?`. UNIQUE
    so a retried-withdraw call can't double-charge.

    `amount_kobo` is stored in kobo (1/100 NGN) to avoid float-rounding
    in money math. The wallet's points are 1:1 with kobo.

    `fee_kobo` is the flat fee the user paid on top of `amount_kobo`
    (set from `settings.withdrawal_fee_tiers`). The user's wallet is
    debited `amount_kobo + fee_kobo`; they receive the full
    `amount_kobo` via Paystack. On `transfer.failed` the webhook
    handler reverses the gross debit (amount + fee) so the user
    ends up with their original balance.

    `balance_after_debit` snapshots `User.points_balance` at the
    moment the gross debit hit. This is the audit value: if the row
    ends up `status='failed'`, the reversal should put the balance
    back exactly to `balance_after_debit + amount_kobo + fee_kobo`.
    """

    __tablename__ = "payout_transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, index=True)
    reference: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    amount_kobo: Mapped[int] = mapped_column(BigInteger)
    fee_kobo: Mapped[int] = mapped_column(BigInteger, default=0)
    recipient_code: Mapped[str] = mapped_column(String(100))
    reason: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    paystack_transfer_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    balance_after_debit: Mapped[int] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    settled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    paystack_event_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)


# ── Phase 2: Ad infrastructure ──────────────────────────────────────
# Three new tables land here. They are deliberately small and the schema
# is permissive about nullable fields so a partial rollout (e.g. AppLovin
# still empty while AdMob ships) doesn't require a migration to land.


class AdPlacement(Base):
    """One row per (location, platform) — e.g. "in_feed + android".

    The client reads from `GET /api/v1/config/ads` to know which ad unit
    to instantiate. The server reads this table for the sponsored-content
    rotation in `GET /content/feed/:user_id` (every 4th item is the ad
    placement tied to `location='in_feed'`).

    `primary_provider` is the network we try first. `fallback_provider`
    is the network we try if the primary returns no-fill. AppLovin stays
    NULL until that integration is wired — the seed only populates AdMob
    today, and the resolution helper in `services/ads.py` short-circuits
    to the primary when the fallback is empty.

    `priority` orders placements within the same location; we only ever
    store 1 per location, but the column is there so an A/B "premium
    placement" can be added without a schema change.

    `ad_unit_id` is the AdMob-format unit id (e.g.
    `ca-app-pub-3898064484524772/6538723260`). Stored as a string so the
    AppLovin equivalent — which has a different shape — can land in the
    same column later.
    """

    __tablename__ = "ad_placements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # `location` is the user-facing slot: "in_feed" | "interstitial" |
    # "rewarded" | "banner". `platform` is the SDK platform:
    # "android" | "ios". The pair is UNIQUE so we never accidentally
    # store two rows for the same slot on the same device class.
    location: Mapped[str] = mapped_column(String(50), index=True)
    platform: Mapped[str] = mapped_column(String(20))
    ad_type: Mapped[str] = mapped_column(String(50))  # native|interstitial|rewarded|banner
    priority: Mapped[int] = mapped_column(Integer, default=1)
    primary_provider: Mapped[str] = mapped_column(String(50))
    fallback_provider: Mapped[str | None] = mapped_column(String(50), nullable=True)
    ad_unit_id: Mapped[str] = mapped_column(String(255))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AppConfig(Base):
    """Generic key/value store for OTA-tunable settings.

    The point of this table is to let ops flip a unit id or a point
    rate without shipping a new client build. Reads are sub-millisecond
    on a 100-row table, so we can call it on every request to
    `/api/v1/config/ads` without caching.

    Key conventions:
      - `admob.app_id.android`         → AdMob App ID for Android
      - `admob.app_id.ios`             → AdMob App ID for iOS
      - `admob.<location>.<platform>`   → AdMob unit ID (e.g.
                                          `admob.in_feed.android`)
      - `app.environment`              → "dev" | "prod"
        (the config router filters rows by this at read time so dev
        builds never see the production unit IDs)

    `value` is a Text column — strings, JSON, or numeric-as-text all
    fit. `description` is a free-text note shown in the future admin
    dashboard; it has no runtime effect.
    """

    __tablename__ = "app_config"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(Text)
    # `environment` lets us ship dev + prod rows side-by-side. The
    # `/api/v1/config/ads` endpoint filters on this so a dev build
    # never reads production unit IDs. Default "prod" so missing rows
    # in the seed are safe.
    environment: Mapped[str] = mapped_column(String(20), default="prod", index=True)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow,
    )


class AiProviderHealth(Base):
    """Per-provider failure tracker for the Phase 3 AI router."""

    __tablename__ = "ai_provider_health"

    provider_name: Mapped[str] = mapped_column(String(100), primary_key=True)
    consecutive_failures: Mapped[int] = mapped_column(Integer, default=0)
    last_failure_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    circuit_open_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow,
    )


# ── Phase 3: Study / AI Exam Prep ────────────────────────────────────


class StudyMaterial(Base):
    """One row per uploaded scheme-of-work or syllabus.

    `raw_input` stores whatever the user sent (image path, raw text,
    extracted OCR text). `parsed_structure` is the JSON the AI router
    returned after parsing the raw input into topics/subtopics. If the
    AI call fails, `parsed_structure` is NULL and the client surfaces
    a retry CTA.
    """

    __tablename__ = "study_materials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, index=True)
    title: Mapped[str] = mapped_column(String(500))
    exam_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    raw_input: Mapped[str] = mapped_column(Text)
    parsed_structure: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_model_used: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class QuizSession(Base):
    """One row per study quiz / flashcard / essay attempt.

    The `questions` column stores the full asset payload the AI returned
    (MCQ options, flashcard fronts/backs, essay prompts). `user_answers`
    stores what the user selected / typed so the result screen can show
    a review. `score` is 0-100 percentage; NULL means the session was
    abandoned before completion.
    """

    __tablename__ = "quiz_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, index=True)
    material_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    asset_type: Mapped[str] = mapped_column(String(50))  # mcq|flashcard|essay
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    points_earned: Mapped[int] = mapped_column(BigInteger, default=0)
    questions: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_answers: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class StudyAsset(Base):
    """One generated asset tied to a StudyMaterial.

    `content_json` is the full AI-generated payload (MCQ array, flashcard
    array, or essay prompt array). `points_to_unlock` is how many points
    the user must spend (or an ad watch must confirm) before the server
    will return `content_json` to the client. Assets default to 50 pts.

    Unlocking is tracked in `StudyTransaction` so the wallet history
    shows "Spent 50 pts to unlock MCQs".
    """

    __tablename__ = "study_assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    material_id: Mapped[int] = mapped_column(BigInteger, index=True)
    asset_type: Mapped[str] = mapped_column(String(50))  # mcq|flashcard|essay
    content_json: Mapped[str] = mapped_column(Text)
    points_to_unlock: Mapped[int] = mapped_column(Integer, default=50)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class StudyTransaction(Base):
    """One spend-or-earn event on a study asset.

    `method` is either `points` (user spent wallet points) or `ad`
    (user watched a rewarded ad). `points_spent` is non-zero only for
    the `points` method. `reward_granted` tracks whether the backend
    actually unlocked the content — if false, the client should show
    an error and retry.
    """

    __tablename__ = "study_transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, index=True)
    asset_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    method: Mapped[str] = mapped_column(String(50))  # points | ad
    points_spent: Mapped[int] = mapped_column(Integer, default=0)
    reward_granted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

# ── Phase 4: Payments (Premium Subscription) ─────────────────────────────


class Payment(Base):
    """Premium subscription payment transaction.
    
    Records incoming payments for tier upgrades. Linked to user + tier type.
    Status progresses: pending → success | failed.
    On success, user.tier + subscription_expires_at are updated via webhook.
    """
    
    __tablename__ = "payments"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, index=True)
    tier: Mapped[str] = mapped_column(String(50))  # premium_monthly | premium_yearly
    amount_kobo: Mapped[int] = mapped_column(BigInteger)  # ₦500 = 50000 kobo
    provider: Mapped[str] = mapped_column(String(50))  # paystack | flutterwave
    provider_tx_ref: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(50), default="pending")  # pending | success | failed
    webhook_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


# ── Phase 5: Referrals & Community ─────────────────────────────────────


class Referral(Base):
    """One row per successful referral link usage.

    `referrer_id` is the user who shared the code. `referee_id` is the
    new user who signed up. `code` is the 6-char alphanumeric string
    they used. `referee_completed_first_session` flips to True once the
    referee has a verified reading session ≥ 2 minutes. `reward_granted`
    tracks whether the points were actually credited — set by the
    validate endpoint.
    """

    __tablename__ = "referrals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    referrer_id: Mapped[int] = mapped_column(BigInteger, index=True)
    referee_id: Mapped[int] = mapped_column(BigInteger, index=True)
    code: Mapped[str] = mapped_column(String(12), index=True)
    referee_completed_first_session: Mapped[bool] = mapped_column(Boolean, default=False)
    reward_granted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class CommunityNote(Base):
    """A study note posted by a user to the community feed.

    `status` is `pending` by default for moderation. The feed endpoint
    only returns `approved` rows. `course_code` and `university` are
    optional filters.
    """

    __tablename__ = "community_notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, index=True)
    title: Mapped[str] = mapped_column(String(500))
    content: Mapped[str] = mapped_column(Text)
    course_code: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    university: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending | approved | rejected
    likes_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class CommunityLike(Base):
    """One row per (user, note) like. UNIQUE constraint prevents double-likes."""

    __tablename__ = "community_likes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, index=True)
    note_id: Mapped[int] = mapped_column(BigInteger, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class UserStreak(Base):
    """Consecutive-day reading streak for a user.

    `current_streak` is the active consecutive-day count. `longest_streak`
    is the all-time best. `last_activity_date` is the ISO date string
    (YYYY-MM-DD) of the most recent verified reading session. The streak
    logic compares `last_activity_date` to today's date to determine if
    the streak continues, resets, or is lost.
    """

    __tablename__ = "user_streaks"

    user_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    current_streak: Mapped[int] = mapped_column(Integer, default=0)
    longest_streak: Mapped[int] = mapped_column(Integer, default=0)
    last_activity_date: Mapped[str | None] = mapped_column(String(10), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ══════════════════════════════════════════════════════════════════════
# PHASE 7: SOCIAL TASKS MARKETPLACE
# ══════════════════════════════════════════════════════════════════════


class Task(Base):
    """Main task table - one row per task posted by sponsor."""
    __tablename__ = "tasks"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    sponsor_id: Mapped[int] = mapped_column(BigInteger, index=True)
    
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text)
    instructions: Mapped[str] = mapped_column(Text)
    
    task_type: Mapped[str] = mapped_column(String(50), index=True)
    platform: Mapped[str] = mapped_column(String(50), index=True)
    category: Mapped[str] = mapped_column(String(50), default="social_media", index=True)
    
    target_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    
    proof_type: Mapped[str] = mapped_column(String(50))
    proof_instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    
    reward_amount: Mapped[int] = mapped_column(BigInteger)
    reward_multiplier: Mapped[float] = mapped_column(Float, default=1.0)
    max_completions: Mapped[int] = mapped_column(Integer)
    completed_count: Mapped[int] = mapped_column(Integer, default=0, index=True)
    approved_count: Mapped[int] = mapped_column(Integer, default=0)
    rejected_count: Mapped[int] = mapped_column(Integer, default=0)
    pending_count: Mapped[int] = mapped_column(Integer, default=0)
    
    total_escrowed: Mapped[int] = mapped_column(BigInteger)
    platform_fee_percent: Mapped[int] = mapped_column(Integer, default=30)
    platform_fee_amount: Mapped[int] = mapped_column(BigInteger)
    
    target_countries: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_cities: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_gender: Mapped[str | None] = mapped_column(String(20), nullable=True)
    target_age_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    target_age_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    target_languages: Mapped[str | None] = mapped_column(Text, nullable=True)
    min_worker_level: Mapped[int] = mapped_column(Integer, default=1)
    min_approval_rate: Mapped[float] = mapped_column(BigInteger, default=0.0)
    require_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    require_premium: Mapped[bool] = mapped_column(Boolean, default=False)
    
    status: Mapped[str] = mapped_column(String(20), default="active", index=True)
    visibility: Mapped[str] = mapped_column(String(20), default="public")
    priority: Mapped[int] = mapped_column(Integer, default=0)
    featured: Mapped[bool] = mapped_column(Boolean, default=False)
    
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    time_limit_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    
    ai_verification_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    ai_auto_approve_threshold: Mapped[float] = mapped_column(BigInteger, default=0.9)
    manual_review_required: Mapped[bool] = mapped_column(Boolean, default=False)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


# ── Admin System ──────────────────────────────────────────────────────


class AdminUser(Base):
    """Admin user with role-based access control."""

    __tablename__ = "admin_users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(50), default="support")  # super_admin | finance | moderator | support
    permissions: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON array
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_login_ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    created_by: Mapped[int | None] = mapped_column(BigInteger, nullable=True)


class AdminAuditLog(Base):
    """Immutable audit trail for admin actions."""

    __tablename__ = "admin_audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    admin_id: Mapped[int | None] = mapped_column(BigInteger, index=True, nullable=True)
    admin_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    action: Mapped[str] = mapped_column(String(100), index=True)
    target_type: Mapped[str] = mapped_column(String(50))
    target_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    changes: Mapped[str | None] = mapped_column(Text, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)
    result: Mapped[str] = mapped_column(String(20), default="success")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class FraudFlag(Base):
    """Fraud detection flags for users or sessions."""

    __tablename__ = "fraud_flags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int | None] = mapped_column(BigInteger, index=True, nullable=True)
    session_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    flag_type: Mapped[str] = mapped_column(String(50), index=True)
    severity: Mapped[str] = mapped_column(String(20))  # low | medium | high
    details: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    reviewed_by: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    review_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ContentImportLog(Base):
    """Log of content imports for audit and debugging."""

    __tablename__ = "content_import_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String(50))
    admin_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    count_imported: Mapped[int] = mapped_column(Integer, default=0)
    start_page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(20))
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)



class TaskSubmission(Base):
    """Worker's submission for a task - one row per user per task."""
    __tablename__ = "task_submissions"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(BigInteger, index=True)
    worker_id: Mapped[int] = mapped_column(BigInteger, index=True)
    
    proof_type: Mapped[str] = mapped_column(String(50))
    proof_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    proof_image_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    proof_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    proof_metadata: Mapped[str | None] = mapped_column(Text, nullable=True)
    proof_image_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    
    ai_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    ai_confidence: Mapped[float | None] = mapped_column(BigInteger, nullable=True)
    ai_verification_details: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    
    reviewed_by: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    auto_approved: Mapped[bool] = mapped_column(Boolean, default=False)
    
    reward_paid: Mapped[int] = mapped_column(BigInteger, default=0)
    payment_status: Mapped[str] = mapped_column(String(20), default="pending")
    paid_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    
    fraud_score: Mapped[float] = mapped_column(BigInteger, default=0.0)
    flagged_for_review: Mapped[bool] = mapped_column(Boolean, default=False)
    duplicate_screenshot_detected: Mapped[bool] = mapped_column(Boolean, default=False)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    completion_time_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    device_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)


class UserReputation(Base):
    """Tracks worker/sponsor reputation scores and gamification stats."""
    __tablename__ = "user_reputations"
    
    user_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    
    worker_level: Mapped[int] = mapped_column(Integer, default=1, index=True)
    worker_xp: Mapped[int] = mapped_column(Integer, default=0)
    worker_xp_to_next_level: Mapped[int] = mapped_column(Integer, default=100)
    
    tasks_viewed: Mapped[int] = mapped_column(Integer, default=0)
    tasks_started: Mapped[int] = mapped_column(Integer, default=0)
    tasks_completed: Mapped[int] = mapped_column(Integer, default=0)
    tasks_approved: Mapped[int] = mapped_column(Integer, default=0)
    tasks_rejected: Mapped[int] = mapped_column(Integer, default=0)
    tasks_disputed: Mapped[int] = mapped_column(Integer, default=0)
    
    approval_rate: Mapped[float] = mapped_column(BigInteger, default=0.0)
    completion_rate: Mapped[float] = mapped_column(BigInteger, default=0.0)
    
    avg_completion_time_seconds: Mapped[int] = mapped_column(Integer, default=0)
    fastest_completion_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_earnings: Mapped[int] = mapped_column(BigInteger, default=0)
    
    quality_score: Mapped[float] = mapped_column(BigInteger, default=5.0)
    badges: Mapped[str | None] = mapped_column(Text, nullable=True)
    
    current_streak_days: Mapped[int] = mapped_column(Integer, default=0)
    longest_streak_days: Mapped[int] = mapped_column(Integer, default=0)
    last_task_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    
    sponsor_rating: Mapped[float] = mapped_column(BigInteger, default=5.0)
    sponsor_rating_count: Mapped[int] = mapped_column(Integer, default=0)
    
    tasks_posted: Mapped[int] = mapped_column(Integer, default=0)
    tasks_completed_as_sponsor: Mapped[int] = mapped_column(Integer, default=0)
    total_spent: Mapped[int] = mapped_column(BigInteger, default=0)
    
    submissions_reviewed: Mapped[int] = mapped_column(Integer, default=0)
    submissions_approved: Mapped[int] = mapped_column(Integer, default=0)
    submissions_rejected: Mapped[int] = mapped_column(Integer, default=0)
    sponsor_approval_rate: Mapped[float] = mapped_column(BigInteger, default=100.0)
    
    avg_review_time_seconds: Mapped[int] = mapped_column(Integer, default=0)
    trusted_sponsor: Mapped[bool] = mapped_column(Boolean, default=False)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SponsorWalletTransaction(Base):
    """Transaction log for sponsor wallet - separate from worker points_balance."""
    __tablename__ = "sponsor_wallet_transactions"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sponsor_id: Mapped[int] = mapped_column(BigInteger, index=True)
    
    type: Mapped[str] = mapped_column(String(50), index=True)
    amount: Mapped[int] = mapped_column(BigInteger)
    balance_before: Mapped[int] = mapped_column(BigInteger)
    balance_after: Mapped[int] = mapped_column(BigInteger)
    
    task_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    submission_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    payment_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    meta_data: Mapped[str | None] = mapped_column(Text, nullable=True)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class SponsorKYC(Base):
    """Sponsor KYC document storage - one row per sponsor."""
    __tablename__ = "sponsor_kyc"
    
    sponsor_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    
    business_name: Mapped[str] = mapped_column(String(255))
    business_registration_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    business_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    business_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    business_website: Mapped[str | None] = mapped_column(String(500), nullable=True)
    business_social_media: Mapped[str | None] = mapped_column(Text, nullable=True)
    
    id_document_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    id_document_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    id_document_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    business_document_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    
    contact_person_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    contact_person_phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    contact_person_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    
    status: Mapped[str] = mapped_column(String(20), default="pending")
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    admin_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    
    submitted_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reviewed_by: Mapped[int | None] = mapped_column(BigInteger, nullable=True)


class TaskMessage(Base):
    """In-app chat between worker and sponsor about a specific task/submission."""
    __tablename__ = "task_messages"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(BigInteger, index=True)
    submission_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    
    sender_id: Mapped[int] = mapped_column(BigInteger, index=True)
    receiver_id: Mapped[int] = mapped_column(BigInteger, index=True)
    
    message: Mapped[str] = mapped_column(Text)
    attachment_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    attachment_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    
    read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class Achievement(Base):
    """Predefined achievements workers can unlock."""
    __tablename__ = "achievements"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    slug: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(String(1000))
    icon_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    icon_emoji: Mapped[str | None] = mapped_column(String(10), nullable=True)
    
    xp_reward: Mapped[int] = mapped_column(Integer, default=0)
    points_reward: Mapped[int] = mapped_column(Integer, default=0)
    
    condition_type: Mapped[str] = mapped_column(String(50))
    condition_value: Mapped[int] = mapped_column(Integer)
    
    rarity: Mapped[str] = mapped_column(String(20), default="common")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class UserAchievement(Base):
    """Tracks which achievements each user has unlocked."""
    __tablename__ = "user_achievements"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, index=True)
    achievement_id: Mapped[int] = mapped_column(Integer, index=True)
    
    unlocked_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    notified: Mapped[bool] = mapped_column(Boolean, default=False)


class Leaderboard(Base):
    """Cached leaderboard rankings - updated hourly by cron job."""
    __tablename__ = "leaderboards"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, index=True)
    
    leaderboard_type: Mapped[str] = mapped_column(String(50), index=True)
    period: Mapped[str] = mapped_column(String(50), index=True)
    rank: Mapped[int] = mapped_column(Integer, index=True)
    score: Mapped[float] = mapped_column(Float)
    
    username: Mapped[str] = mapped_column(String(255))
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    level: Mapped[int] = mapped_column(Integer)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class TaskAnalytics(Base):
    """Aggregated analytics per task for sponsor dashboard."""
    __tablename__ = "task_analytics"
    
    task_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    
    views: Mapped[int] = mapped_column(Integer, default=0)
    unique_viewers: Mapped[int] = mapped_column(Integer, default=0)
    started: Mapped[int] = mapped_column(Integer, default=0)
    submitted: Mapped[int] = mapped_column(Integer, default=0)
    approved: Mapped[int] = mapped_column(Integer, default=0)
    rejected: Mapped[int] = mapped_column(Integer, default=0)
    
    view_to_start_rate: Mapped[float] = mapped_column(Float, default=0.0)
    start_to_submit_rate: Mapped[float] = mapped_column(Float, default=0.0)
    submit_to_approve_rate: Mapped[float] = mapped_column(Float, default=0.0)
    
    avg_completion_time: Mapped[int] = mapped_column(Integer, default=0)
    median_completion_time: Mapped[int] = mapped_column(Integer, default=0)
    
    gender_breakdown: Mapped[str | None] = mapped_column(Text, nullable=True)
    age_breakdown: Mapped[str | None] = mapped_column(Text, nullable=True)
    city_breakdown: Mapped[str | None] = mapped_column(Text, nullable=True)
    hourly_submissions: Mapped[str | None] = mapped_column(Text, nullable=True)
    
    avg_ai_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    ai_auto_approve_count: Mapped[int] = mapped_column(Integer, default=0)
    manual_review_count: Mapped[int] = mapped_column(Integer, default=0)
    
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class PasswordResetToken(Base):
    """Single-use tokens for forgot-password flow."""
    __tablename__ = "password_reset_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, index=True)
    token_hash: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


# ══════════════════════════════════════════════════════════════════════
# AD REQUEST TOKENS (SSV-only credit flow)
# ══════════════════════════════════════════════════════════════════════


class AdRequest(Base):
    """Server-issued ad-request token. One row per client request to show an ad.

    Lifecycle: issued → credited | expired | rejected.
    - `issued`: client just received the token, hasn't shown the ad yet
    - `credited`: SSV callback arrived and the user was credited; token is dead
    - `expired`: > ad_request_token_ttl_seconds old without a matching SSV
      callback; swept by the cron
    - `rejected`: SSV callback arrived but the request was malformed,
      expired, already-credited, or the user_id in custom_data didn't match

    The token is the only thing the client knows. The server binds the token
    to a user_id and ad_unit at issuance time, so a forged SSV callback that
    guesses a valid token still needs to match the user_id encoded in
    `custom_data` (which AdMob signs as part of the SSV payload).

    This table replaces the client-driven /api/v1/ads/credit and
    /api/v1/ads/reward-claim endpoints. Those endpoints are attack surfaces:
    they let an authenticated client mint arbitrary NGN-equivalent points by
    fabricating a transaction_id and a revenue_usd. With this table, the
    server is the only authority on points — it credits only on receipt of
    an AdMob-signed SSV callback that references a real, unexpired,
    uncredited AdRequest row.
    """
    __tablename__ = "ad_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # The 32-byte URL-safe token the client passes to AdMob as part of
    # `custom_data = f"{user_id}:{token}"`. UNIQUE — collisions must
    # be impossible; the issuance path retries on the (vanishingly rare)
    # unlikely event of a duplicate.
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    # Bound at issuance. The SSV handler cross-checks this against the
    # user_id encoded in `custom_data` so a forged callback that guesses
    # a valid token still fails the user-mismatch check.
    user_id: Mapped[int] = mapped_column(BigInteger, index=True)
    # `session_id` links the ad request to a specific reading session for
    # bundled rewards (Reading Time + Ad 1 + Ad 2).
    session_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    # Which ad slot the client requested (e.g. "rewarded_android"). The
    # SSV handler validates this is a rewarded slot before crediting.
    ad_unit: Mapped[str] = mapped_column(String(100))
    # See class docstring for the lifecycle.
    status: Mapped[str] = mapped_column(String(20), default="issued", index=True)
    # Filled when status=credited. NULL while issued/expired/rejected.
    points_credited: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    credited_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # AdMob's transaction_id from the SSV callback, stored on credit so
    # the same transaction can never be replayed against a different
    # AdRequest row.
    admob_transaction_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    # Set when status=rejected. Surfaces why a legitimate-looking SSV
    # callback didn't result in a credit.
    rejection_reason: Mapped[str | None] = mapped_column(String(100), nullable=True)


class RevokedJWT(Base):
    __tablename__ = "revoked_jwts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    jti: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    reason: Mapped[str | None] = mapped_column(String(100), nullable=True)  # logout | password_change | admin_ban
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    token_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    device_fingerprint: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class UserAuditLog(Base):
    __tablename__ = "user_audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    action: Mapped[str] = mapped_column(String(50), index=True, nullable=False)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    device_fingerprint: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    extra_data: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class UserNotificationPreference(Base):
    __tablename__ = "user_notification_preferences"

    user_id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    push_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    study_reminders: Mapped[bool] = mapped_column(Boolean, default=True)
    task_alerts: Mapped[bool] = mapped_column(Boolean, default=True)
    referral_bonuses: Mapped[bool] = mapped_column(Boolean, default=True)
    wallet_updates: Mapped[bool] = mapped_column(Boolean, default=True)
    ad_rewards: Mapped[bool] = mapped_column(Boolean, default=True)
    quiet_hours_start: Mapped[time | None] = mapped_column(Time, nullable=True)
    quiet_hours_end: Mapped[time | None] = mapped_column(Time, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class FCMToken(Base):
    __tablename__ = "fcm_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, index=True, nullable=False)
    token: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    platform: Mapped[str] = mapped_column(String(20), nullable=False)
    device_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ════════════════════════════════════════════════════════════════════════
# Phase: OpenStax integration + work-level social features
# ════════════════════════════════════════════════════════════════════════
#
# These five tables were added to support education content from OpenStax
# and the social features (likes / comments / share) at the work level.
# Reuses the same UNIQUE(user_id, target_id) pattern as CommunityLike and
# CommunityNote for consistency with existing code.
#


class ReadingUnit(Base):
    """A 1-2 minute reading chunk within a topic-sized slice.

    Education content (OpenStax) is sliced by topic first (one topic = one
    child row in content_catalog), then each topic is further chunked into
    ReadingUnits. Units within a slice are locked: unit 1 of every topic is
    free, units 2+ unlock when the user reads the previous unit OR has
    premium tier. Casual reader content (gutendex / gnews) has exactly 1
    unit per slice — generated automatically on first read so the existing
    1-min timer / heart-beat / SSV flow continues to work unchanged.

    `unit_order` is 1-indexed within the slice. `total_units` is denormalized
    from the count of units for the same slice for fast list rendering.
    `body_text` is the actual prose for this unit; it MUST end on a
    sentence boundary (`.` / `!` / `?` followed by whitespace or EOF) — see
    topic_slicer.py for the full-stop rule.

    Indexes:
      - (slice_id, unit_order) is unique so duplicates can't be inserted.
      - slice_id is indexed because the unit list is fetched per slice.
    """

    __tablename__ = "reading_units"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    slice_id: Mapped[int] = mapped_column(BigInteger, index=True, nullable=False)
    unit_order: Mapped[int] = mapped_column(Integer, nullable=False)
    total_units: Mapped[int] = mapped_column(Integer, nullable=False)
    body_text: Mapped[str] = mapped_column(Text, nullable=False)
    char_count: Mapped[int] = mapped_column(Integer, nullable=False)
    word_count: Mapped[int] = mapped_column(Integer, nullable=False)
    estimated_read_minutes: Mapped[int] = mapped_column(Integer, default=2)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class WorkLike(Base):
    """A user's like on a work (the parent book, NOT a child slice).

    Likes are scoped to the work because:
      1. Casual readers think in books, not slices — "I liked Pride &
         Prejudice" is a meaningful statement; "I liked Part 3 of Pride &
         Prejudice" is not.
      2. Reuses the existing CommunityLike UNIQUE pattern.
      3. Avoids slice-noise: a book has 100+ slices, so per-slice likes
         would be a 100x data explosion with negligible UX benefit.

    work_id is the parent content_catalog.id (the unsliced book). For
    standalone slices (parent_work_id IS NULL), like the slice directly
    by setting work_id = slice.id — the catalog UI handles both cases.

    UNIQUE(user_id, work_id) is the idempotency guarantee. Toggling a
    like is "delete if exists, insert if not" — never accumulates.
    """

    __tablename__ = "work_likes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, index=True, nullable=False)
    work_id: Mapped[int] = mapped_column(BigInteger, index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class WorkComment(Base):
    """A comment on a work (parent book), forming one discussion thread.

    One thread per work — slices do NOT get their own threads. The
    conversation is about the book as a whole, not any specific 1-min
    read of it. This matches the user mental model: "comments on this
    book" not "comments on this 2-minute window."

    `parent_comment_id` enables 1-level reply threading (a comment can
    reply to another comment, but not to a reply). Phase 1 ships flat
    threading only — the column exists for a future 1.1 release if
    threading demand is real.

    `status` mirrors CommunityNote.status for moderation:
      - 'approved' — visible by default
      - 'pending' — flagged for moderator review (cheating-help filter)
      - 'rejected' — hidden by moderator

    `body` is TEXT with a 1-2000 char check at the application layer.
    The DB-level CHECK is enforced at the application layer for
    portability across database backends.
    """

    __tablename__ = "work_comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, index=True, nullable=False)
    work_id: Mapped[int] = mapped_column(BigInteger, index=True, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    parent_comment_id: Mapped[int | None] = mapped_column(
        BigInteger, nullable=True, index=True
    )
    status: Mapped[str] = mapped_column(String(20), default="approved", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class WorkCommentLike(Base):
    """A user's like on a comment.

    UNIQUE(user_id, comment_id) so double-taps don't accumulate. Separate
    from WorkLike because the like is on a different entity (a comment,
    not a work) and the count surfaces differently in the UI (small
    number next to each comment, not a big number on a book card).
    """

    __tablename__ = "work_comment_likes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, index=True, nullable=False)
    comment_id: Mapped[int] = mapped_column(BigInteger, index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class WorkShare(Base):
    """A share event — logged for analytics only.

    No UNIQUE constraint: every share event is a new row so we can
    measure viral coefficient (shares per user per book per platform).
    `platform` is one of 'whatsapp' | 'twitter' | 'facebook' | 'instagram'
    | 'copy' | 'email' | 'other' (extracted client-side from the share
    sheet choice). We do NOT store the recipient — only that a share
    happened, by whom, on what, where.
    """

    __tablename__ = "work_shares"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, index=True, nullable=False)
    work_id: Mapped[int] = mapped_column(BigInteger, index=True, nullable=False)
    platform: Mapped[str] = mapped_column(String(50), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
