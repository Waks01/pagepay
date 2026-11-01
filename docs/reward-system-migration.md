# Reward System Migration — Backend Spec

**Status:** Spec complete. No code changes yet.
**Goal:** Split `User.points_balance` into two ledgers so ad-derived
credits can never be withdrawn as cash. Aligns with Google AdMob 2026
"no compensation programs" policy.

**Prerequisites read:**
- `docs/backend-audit-rewards.md` — every credit/debit site mapped.
- `backend/CLAUDE.md` — Alembic naming (≤32 chars), micro-unit storage.

---

## 1. The two ledgers

### 1.1 New columns on `users`

| Column | Type | Default | Source of credits | Withdrawable? |
|--------|------|---------|-------------------|---------------|
| `service_credit_balance` | `BigInteger NOT NULL` | `0` | Ad watch, welcome, referral, daily, quiz | **No** |
| `cashable_balance` | `BigInteger NOT NULL` | `0` | Paystack deposit, bills commission rebate | **Yes** |
| `device_id_hash` | `String(64) NULL` | `NULL` | Populated on first `/rewards/daily/claim` | n/a |
| `points_balance` | **KEEP, deprecate** | `0` | Stop reading. Stop writing new rows after cutover. | n/a |

### 1.2 Why two BigIntegers, not one JSONB

Two reasons:
- The existing `SELECT … WHERE points_balance < X` queries in bills.py,
  payouts.py, study.py all need to keep working. JSONB would force a
  rewrite of every read site.
- Per-ledger indexing (e.g., a future "users with high sv, low cash"
  marketing query) is straightforward with two columns.

### 1.3 `device_id_hash`

- Populated lazily on first `/rewards/daily/claim` POST. The client
  sends the raw device id; the server hashes it (SHA-256, hex) before
  storage so we never hold PII.
- 64 chars matches a hex SHA-256 digest length.
- A daily claim with a different `device_id_hash` than the one on file
  raises 403 (`device_mismatch`). A claim where `device_id_hash IS NULL`
  sets it (first-time bootstrap).
- Used for anti-abuse only. Not exposed on `/auth/me`.

### 1.4 `points_balance` is not dropped

Keep the column through at least one full release. New code stops
reading it. Old code (admin scripts, analytics queries) that still
references it keeps working. A later migration (post-cutover, ≥ 1
release later) drops it.

---

## 2. Alembic migration

**Filename:** `backend/alembic/versions/038_split_wallet_ledgers.py`
(30 chars — under the 32-char cap from `backend/CLAUDE.md`).

**Revision ID:** `038_split_wallet_ledgers`
**Down revision:** `037_add_bill_disputes` (single parent — chain is
linear from 026 onwards; the two-headed state at 025/3f02971605b1 was
already merged by 026_welcome_bonus).

```python
"""split_wallet_ledgers

Revision ID: 038_split_wallet_ledgers
Revises: 037_add_bill_disputes
Create Date: 2026-08-25

Splits User.points_balance into two non-overlapping ledgers:

  - service_credit_balance : ad-derived + engagement credits (NON-cashable)
  - cashable_balance       : deposits + legitimate commissions (cashable)

Adds device_id_hash column for streak anti-abuse. Rewrites historical
points_balance using the point_credits + ad_events audit trail so the
two new columns start in sync with the audit record.

points_balance is preserved (not dropped) for back-compat with admin
scripts and any straggler read sites. New code MUST NOT write to it.

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '038_split_wallet_ledgers'
down_revision: Union[str, None] = '037_add_bill_disputes'
branch_labels = None
depends_on = None


def _col_exists(conn, table: str, column: str) -> bool:
    r = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_schema='public' AND table_name=:t AND column_name=:c"
    ), {"t": table, "c": column}).first()
    return r is not None


def upgrade() -> None:
    conn = op.get_bind()

    # 1. Add the new columns. Idempotent: skip if already present (the
    # _ensure_critical_columns defensive backfill in main.py may have
    # run first).
    if not _col_exists(conn, "users", "service_credit_balance"):
        op.add_column("users", sa.Column(
            "service_credit_balance",
            sa.BigInteger(),
            nullable=False,
            server_default="0",
        ))
        op.create_index(
            op.f("ix_users_service_credit_balance"),
            "users", ["service_credit_balance"], unique=False,
        )

    if not _col_exists(conn, "users", "cashable_balance"):
        op.add_column("users", sa.Column(
            "cashable_balance",
            sa.BigInteger(),
            nullable=False,
            server_default="0",
        ))
        op.create_index(
            op.f("ix_users_cashable_balance"),
            "users", ["cashable_balance"], unique=False,
        )

    if not _col_exists(conn, "users", "device_id_hash"):
        op.add_column("users", sa.Column(
            "device_id_hash",
            sa.String(length=64),
            nullable=True,
        ))
        op.create_index(
            op.f("ix_users_device_id_hash"),
            "users", ["device_id_hash"], unique=False,
        )

    # 1b. Add use_case column to ad_events. This is the column that
    #     makes the global 200-ads/day cap auditable — every rewarded
    #     ad gets tagged with WHY it was watched (wallet_topup,
    #     streak_recovery, study_unlock, withdrawal_fee_offset, …).
    #     A request-token endpoint can also be called with a use_case
    #     hint; SSV callbacks fall back to 'wallet_topup' for legacy
    #     clients that don't pass one.
    if not _col_exists(conn, "ad_events", "use_case"):
        op.add_column("ad_events", sa.Column(
            "use_case",
            sa.String(length=50),
            nullable=True,
            server_default="wallet_topup",
        ))
        op.create_index(
            op.f("ix_ad_events_use_case"),
            "ad_events", ["use_case"], unique=False,
        )

    # 2. Data migration: classify historical points_balance into the
    #    two new ledgers. Uses the audit tables (point_credits, ad_events)
    #    which have been recording the source of every credit since
    #    026_welcome_bonus / the SSV refactor.
    #
    #    Sources that go to service_credit_balance:
    #      rewarded_ad, welcome_bonus, referral_referrer, referral_referee,
    #      quiz_bonus, daily_reward
    #
    #    Remaining credit (reading bonus, bills commission, wallet_deposit)
    #    goes to cashable_balance.
    op.execute("""
        WITH classified AS (
            SELECT
                u.id AS user_id,
                u.points_balance,
                COALESCE(SUM(CASE
                    WHEN pc.source IN (
                        'rewarded_ad',
                        'welcome_bonus',
                        'referral_referrer',
                        'referral_referee',
                        'quiz_bonus',
                        'daily_reward'
                    ) THEN pc.points ELSE 0
                END), 0) AS service_credits,
                COALESCE(SUM(CASE
                    WHEN pc.source IN (
                        'reading_bonus',
                        'bills_commission',
                        'wallet_deposit',
                        'study_refund'
                    ) THEN pc.points ELSE 0
                END), 0) AS cashable_credits
            FROM users u
            LEFT JOIN point_credits pc ON pc.user_id = u.id
            GROUP BY u.id, u.points_balance
        )
        UPDATE users AS u
        SET
            service_credit_balance = c.service_credits,
            cashable_balance       = GREATEST(
                0,
                c.cashable_credits
                + (u.points_balance - (c.service_credits + c.cashable_credits))
            )
        FROM classified c
        WHERE u.id = c.user_id;
    """)

    # 3. Sanity check — we should not have created negative balances.
    #    If we did, it's a sign that the audit trail missed a credit
    #    path. The migration aborts here rather than silently shipping
    #    corrupt data.
    op.execute("""
        DO $$
        DECLARE
            bad_count INT;
        BEGIN
            SELECT COUNT(*) INTO bad_count
            FROM users
            WHERE service_credit_balance < 0 OR cashable_balance < 0;
            IF bad_count > 0 THEN
                RAISE EXCEPTION
                    'Split-wallet migration produced % users with negative ledger values',
                    bad_count;
            END IF;
        END $$;
    """)

    # 4. Record a marker row in point_credits for each user so the
    #    audit trail has a permanent record of the split. Source =
    #    'legacy_balance_split'. This row IS idempotent via the
    #    UNIQUE(user_id, source) constraint, so a retry is a no-op.
    op.execute("""
        INSERT INTO point_credits (user_id, source, points, metadata_json, created_at)
        SELECT
            u.id,
            'legacy_balance_split' AS source,
            0 AS points,  -- informational only; the actual values are in users columns
            jsonb_build_object(
                'service_credit_balance', u.service_credit_balance,
                'cashable_balance', u.cashable_balance,
                'split_at', NOW()
            ) AS metadata_json,
            NOW()
        FROM users u
        ON CONFLICT (user_id, source) DO NOTHING;
    """)


def downgrade() -> None:
    conn = op.get_bind()

    # Best-effort reverse: copy service_credit_balance + cashable_balance
    # back into points_balance so old code paths resume working. We do
    # NOT remove the audit row — it's a permanent record.

    op.execute("""
        UPDATE users
        SET points_balance = COALESCE(service_credit_balance, 0)
                           + COALESCE(cashable_balance, 0)
        WHERE points_balance = 0;
        -- Only restore where points_balance was zeroed by the split. If
        -- it was nonzero because admin scripts wrote to it post-cutover,
        -- we leave it alone and surface a warning.
    """)

    if _col_exists(conn, "users", "device_id_hash"):
        op.drop_index(op.f("ix_users_device_id_hash"), table_name="users")
        op.drop_column("users", "device_id_hash")

    if _col_exists(conn, "users", "cashable_balance"):
        op.drop_index(op.f("ix_users_cashable_balance"), table_name="users")
        op.drop_column("users", "cashable_balance")

    if _col_exists(conn, "users", "service_credit_balance"):
        op.drop_index(op.f("ix_users_service_credit_balance"), table_name="users")
        op.drop_column("users", "service_credit_balance")
```

---

## 3. Code changes — per-router

Every file change below is keyed to the **decision column** in
`docs/backend-audit-rewards.md` §1.1.

### 3.1 `app/routers/ads.py` (AdMob SSV) → `service_credit_balance` + 200-ads/day global cap

The cap is on **ad impressions watched**, not on points earned. Every
rewarded ad the user watches — for any reason — counts as 1 against
their daily 200 budget. The user chooses how to spend each impression:

| Use case | What the ad does | sv effect |
|----------|------------------|-----------|
| `wallet_topup` | Watch ad → earn 16 sv (24 sv premium) to `service_credit_balance` | +16/24 sv |
| `study_unlock` | Watch ad → unlock study asset without spending sv | 0 sv |
| `streak_recovery` | Watch ad → restore missed streak day | 0 sv |
| `withdrawal_fee_offset` | Watch ad → reduce/waive ₦15/35/70 withdrawal fee | 0 sv |
| `quiz_extra_life` | Watch ad → continue a failed quiz attempt | 0 sv |
| `daily_bonus_boost` | Watch ad → 2× multiplier on daily claim that day | bonus sv |

This design defeats the "compensation program" framing because the user
isn't watching ads *for cash-equivalent sv*. They're watching ads for
**in-app actions** (recover streak, unlock study, save on withdrawal
fee, etc.). The sv is the by-product, not the goal. And it's all
locked inside PagePay's economy.

**Cap check happens at the SSV callback, before any credit/unlock.**

```python
# /app/routers/ads.py — inside the SSV callback handler, before credit

DAILY_AD_IMPRESSION_CAP = settings.daily_ad_impression_cap  # 200 (locked)

today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
result = await db.execute(
    select(func.count(AdEvent.id))
    .where(AdEvent.user_id == user_id)
    .where(AdEvent.ad_type == 'rewarded')
    .where(AdEvent.credit_status == 'credited')
    .where(AdEvent.created_at >= today_start)
)
ads_watched_today = result.scalar() or 0

if ads_watched_today >= DAILY_AD_IMPRESSION_CAP:
    # Cap hit. Reject the SSV, don't credit, don't grant use_case benefit.
    # Return 200 so AdMob doesn't retry.
    await ads_service.mark_ad_request_rejected(
        db, req, reason="daily_ad_impression_cap_hit",
        extra_metadata={
            "today_count": ads_watched_today,
            "cap": DAILY_AD_IMPRESSION_CAP,
            "use_case": req.use_case,  # what they tried to spend it on
        },
    )
    await log_ssv_attempt(
        user_id=user_id, token=token,
        status="rejected_daily_ad_impression_cap",
        rejection_reason=(
            f"daily ad impression cap {DAILY_AD_IMPRESSION_CAP} hit "
            f"(today={ads_watched_today})"
        ),
        points_credited=0,
    )
    await db.commit()
    logger.info(
        "AdMob SSV: daily ad cap hit user=%s today=%d cap=%d use_case=%s",
        user_id, ads_watched_today, DAILY_AD_IMPRESSION_CAP, req.use_case,
    )
    return {"status": "ignored", "reason": "daily_ad_impression_cap"}

# Cap OK → credit as normal, tag with use_case
await db.execute(
    update(User).where(User.id == user_id)
    .values(service_credit_balance=User.service_credit_balance + points)
)

# Tag the AdEvent row with use_case for analytics + future per-use-case caps
event = AdEvent(
    user_id=user_id,
    session_id=req.session_id,
    ad_unit=req.ad_unit,
    ad_type="rewarded",
    provider="admob",
    watched_fully=True,
    reward_granted=True,
    transaction_id=transaction_id or None,
    revenue_usd=None,
    fx_rate_used=None,
    user_points_credited=points,
    credit_status="credited",
    use_case=req.use_case or "wallet_topup",  # default for legacy clients
)
db.add(event)
```

**The `PointCredit(source='rewarded_ad', ...)` audit row is unchanged** —
it's the idempotency anchor and it already records the source, so the
historical split can correctly classify it.

**The `req.use_case` field** is set when the client calls
`POST /ads/request-token` with a new optional body field:

```python
# /app/schemas/__init__.py — extend AdRequestTokenRequest
class AdRequestTokenRequest(BaseModel):
    ad_unit: str
    session_id: int | None = None
    use_case: Literal[
        "wallet_topup",
        "study_unlock",
        "streak_recovery",
        "withdrawal_fee_offset",
        "quiz_extra_life",
        "daily_bonus_boost",
    ] = "wallet_topup"  # legacy clients default to this
```

The token's `custom_data` is unchanged — AdMob only cares about
`user_id:token`, not the use case. The use case is stored on the
`AdRequest` row when the token is minted, then read at SSV time.

### Why 200 ads/day, both tiers, with 5+ networks planned

- **200 ads is a heavy budget.** A free user watching 200 ads earns
  200 × 16 = 3,200 sv/day (~₦320). A premium user earns 200 × 24 =
  4,800 sv/day (~₦480).
- **None of it is cashable.** It all lands in `service_credit_balance`.
  The user can't withdraw any of it.
- **The user has reasons to spend ads beyond pure income** — study
  unlocks, streak recovery, withdrawal fee offset. This dilutes the
  "watching ads for sv" pattern.
- **5+ networks share the cap.** AdMob, AppLovin, Unity, BidMachine,
  Mintegral all draw from the same 200-ad budget per user per day.
  Networks compete on fill rate and eCPM, not on cap manipulation.
- **Server-side enforcement.** The cap is a `SELECT COUNT(*)` against
  the audit table — provable to Google's reviewers as
  "PagePay caps total rewarded impressions per user per day at 200,
   across all networks and all use cases."

### 3.2 `app/routers/sessions.py` (reading bonus) → `cashable_balance`

**Lines 145-146:**

```python
# BEFORE
current_user.points_balance += bonus_credited
# AFTER
current_user.cashable_balance += bonus_credited
```

The reading bonus is verified work. Cashable.

Also: **line 185** (`new_balance=current_user.points_balance`) — change
to `new_balance=current_user.cashable_balance`. The `SessionEndResponse`
schema needs a new `new_cashable_balance: int` field (kept distinct
from any legacy `new_balance`).

### 3.3 `app/routers/daily_rewards.py` (streak claim) → `service_credit_balance`

**Line 238:**

```python
# BEFORE
.values(points_balance=User.points_balance + points_to_award)
# AFTER
.values(service_credit_balance=User.service_credit_balance + points_to_award)
```

Also adds **device_id_hash check** (NEW code, not a swap):

```python
# NEW: device_id_hash guard at top of claim endpoint
if not current_user.device_id_hash:
    current_user.device_id_hash = hash_device_id(payload.device_id)
elif not constant_time_compare(
    current_user.device_id_hash, hash_device_id(payload.device_id)
):
    raise HTTPException(
        status_code=403,
        detail="Streak is bound to a different device.",
    )
```

The `/rewards/daily/claim` request body gains a new optional field
`device_id: str`. The client computes a stable id
(`Application.getAndroidId()` on Android, `identifierForVendor` on iOS)
and sends it on each claim.

### 3.4 `app/routers/referral.py` (signup reward) → `service_credit_balance`

**Lines 179-180:**

```python
# BEFORE
referrer.points_balance = (referrer.points_balance or 0) + REFERRER_REWARD
referee.points_balance  = (referee.points_balance  or 0) + REFEREE_REWARD

# AFTER
referrer.service_credit_balance = (referrer.service_credit_balance or 0) + REFERRER_REWARD
referee.service_credit_balance  = (referee.service_credit_balance  or 0) + REFEREE_REWARD
```

### 3.5 `app/services/welcome_bonus.py` → `service_credit_balance`

**Lines 100-176 (the `update(User).values(points_balance=…)` call):**

```python
# BEFORE
.values(points_balance=User.points_balance + bonus_points)
# AFTER
.values(service_credit_balance=User.service_credit_balance + bonus_points)
```

### 3.6 `app/routers/study.py` (quiz bonus + unlock debit)

**Quiz bonus credit (around line 1100):**

```python
# BEFORE
.values(points_balance=User.points_balance + BONUS_POINTS)
# AFTER
.values(service_credit_balance=User.service_credit_balance + BONUS_POINTS)
```

**Unlock debit (around line 1100-1103):**

```python
# BEFORE
.values(points_balance=User.points_balance - asset.points_to_unlock)
# AFTER
.values(service_credit_balance=User.service_credit_balance - asset.points_to_unlock)
```

Premium path (`method='premium'`) is unchanged — no debit.

### 3.7 `app/routers/bills.py` (8 endpoints) → `cashable_balance`

Every bill endpoint follows the same template. Example from airtime
(lines 193-253):

```python
# BEFORE
if user_row.points_balance < kobo_to_points(amount_kobo):
    raise HTTPException(status_code=402, detail="Insufficient balance")

await db.execute(
    update(User).where(User.id == current_user.id)
    .values(points_balance=User.points_balance - kobo_to_points(amount_kobo))
)
# ... provider call ...
await db.execute(
    update(User).where(User.id == current_user.id)
    .values(points_balance=User.points_balance + points)
)

# AFTER
if user_row.cashable_balance < kobo_to_points(amount_kobo):
    raise HTTPException(status_code=402, detail="Insufficient balance")

await db.execute(
    update(User).where(User.id == current_user.id)
    .values(cashable_balance=User.cashable_balance - kobo_to_points(amount_kobo))
)
# ... provider call ...
await db.execute(
    update(User).where(User.id == current_user.id)
    .values(cashable_balance=User.cashable_balance + points)
)
```

Also line 248 (`new_balance = user_row.points_balance - ... + points`)
becomes `new_balance = user_row.cashable_balance - ... + points`.

**Same change applies to:** line 322 (data), 535 (cable), 654
(electricity), 803 (education), 1102 (next service), 1236, 1378, 1490,
1610, 1731 — all eight bill endpoints. The block is identical; copy
the diff once and apply per endpoint.

### 3.8 `app/routers/payments.py` (Paystack webhook) → `cashable_balance`

**`charge.success` handler:**

```python
# BEFORE
await db.execute(
    update(User).where(User.id == user_id)
    .values(points_balance=User.points_balance + kobo_to_points(amount_kobo))
)

# AFTER
await db.execute(
    update(User).where(User.id == user_id)
    .values(cashable_balance=User.cashable_balance + kobo_to_points(amount_kobo))
)
```

`wallet_deposit` tier is the only one this affects. `premium_monthly`/
`premium_yearly` set `User.tier` and `User.subscription_expires_at`,
not points.

### 3.9 `app/routers/payouts.py` (withdrawal) → `cashable_balance` + the compliance guard

**This is the policy-critical change.** Lines 798 and 829:

```python
# BEFORE (line 798)
if user_row.points_balance < total_debit_points:
    raise HTTPException(status_code=402, detail="Insufficient balance")

# AFTER
if user_row.cashable_balance < total_debit_points:
    raise HTTPException(
        status_code=402,
        detail="Insufficient withdrawable balance. Service credits are not cashable.",
    )
```

```python
# BEFORE (line 829)
user_row.points_balance -= total_debit_points

# AFTER
user_row.cashable_balance -= total_debit_points
```

`PayoutTransaction.balance_after_debit` snapshot (around line 850)
changes from `user_row.points_balance` to `user_row.cashable_balance`.

**Audit log:** add a structured log line on every withdrawal:

```python
logger.info(
    "withdraw.user=%d amount_pts=%d service_credit_before=%d cashable_before=%d",
    user_id, total_debit_points,
    user_row.service_credit_balance, user_row.cashable_balance,
)
```

This makes it trivially provable to Google's reviewers that **no
service credits have ever been debited by a withdrawal**.

### 3.10 `app/routers/auth.py` `UserMe` → surface split fields

**Line 205:**

```python
# BEFORE
return UserMe(
    id=current_user.id,
    ...
    points_balance=current_user.points_balance,
    ...
)

# AFTER
return UserMe(
    id=current_user.id,
    ...
    service_credit_balance=current_user.service_credit_balance,
    cashable_balance=current_user.cashable_balance,
    points_balance=current_user.points_balance,  # deprecated, kept for compat
    ...
)
```

### 3.11 `app/schemas/__init__.py` `UserMe` schema

**Lines 73-86:**

```python
class UserMe(BaseModel):
    id: int
    email: str | None
    phone: str | None
    username: str | None
    service_credit_balance: int        # NEW
    cashable_balance: int              # NEW
    points_balance: int                # DEPRECATED — keep for one version
    tier: str
    created_at: datetime
    is_worker: bool = True
    is_sponsor: bool = False
    email_verified: bool = False
    avatar_url: str | None = None

    model_config = ConfigDict(from_attributes=True)
```

### 3.12 `app/routers/wallet.py` (history & transactions) → surface both ledgers

**`GET /wallet/transactions` and `GET /wallet/history`:**

Add a `ledger: Literal["service_credit", "cashable", "sponsor", "n/a"]`
field to every response item. For mixed-ledger events (bills: cashable
debit + cashable credit) the field is `"cashable"`. For ad-derived
credits it is `"service_credit"`. For sponsor flows it is `"sponsor"`.

The mobile team uses this to bucket the row into the correct side of
the wallet UI.

### 3.13 `app/routers/daily_rewards.py` — streak recovery endpoints

Two NEW endpoints (not migrations of existing ones):

```
POST /rewards/daily/freeze-by-ad
  Body: { device_id: str }
  Returns: { recovered: bool, next_claim_available_at: datetime }
  Effect: 1/day cap. Increments a StreakFreezeLog(user_id,
          method='ad', ad_event_id=...) row. Does NOT credit service
          points.

POST /rewards/daily/freeze-by-points
  Body: { device_id: str }
  Returns: { recovered: bool, sv_spent: int, new_balance: int }
  Effect: Debits service_credit_balance according to the streak-tier
          table (5/10/15/20/30 sv). Increments StreakFreezeLog.
```

`StreakFreezeLog(user_id, method, sv_spent, created_at)` is a NEW
table — see §4.

### 3.14 `app/routers/streak.py` — milestone data source

**No code changes.** The existing `UserStreak` model and `UserRewardClaim`
audit table are the source of truth. Mobile reads
`GET /rewards/daily/history` (already exists, returns list of past
claims) and infers which milestones have been hit by matching
`streak_day` against the milestone ladder.

We document the ladder in the API response:

```python
# In GET /rewards/daily/state response
{
    "current_streak": 12,
    "next_milestone": {"day": 14, "reward_sv": 350, "celebration_component": "milestone_day14"},
    "next_milestone_in_days": 2,
    "milestones_claimed": [7],  # from UserRewardClaim history
    "ladder": [
        {"day": 7,   "reward_sv": 200},
        {"day": 14,  "reward_sv": 350},
        {"day": 21,  "reward_sv": 500},
        {"day": 30,  "reward_sv": 800},
        {"day": 60,  "reward_sv": 1500},
        {"day": 100, "reward_sv": 3000},
        {"day": 365, "reward_sv": 15000},
    ],
}
```

`milestones_claimed` is derived from `UserRewardClaim` rows where
`streak_day IN (7, 14, 21, 30, 60, 100, 365)`. `celebration_component`
is just `"milestone_day" + str(day)` — the client picks the right
reusable component.

---

## 4. New tables

### 4.1 `streak_freeze_log`

Added in the same migration (`038_split_wallet_ledgers.py`):

```python
op.create_table(
    "streak_freeze_log",
    sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
    sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id"),
              nullable=False, index=True),
    sa.Column("method", sa.String(20), nullable=False),  # 'ad' | 'points' | 'premium'
    sa.Column("sv_spent", sa.BigInteger(), nullable=False, server_default="0"),
    sa.Column("streak_length_at_freeze", sa.Integer(), nullable=False),
    sa.Column("ad_event_id", sa.BigInteger(), nullable=True),
    sa.Column("device_id_hash", sa.String(64), nullable=True),
    sa.Column("created_at", sa.DateTime(), server_default=sa.text("NOW()"),
              nullable=False, index=True),
)
```

`UNIQUE(user_id, created_at::date, method='ad')` partial unique
constraint enforces the "1 ad-recovery per day" cap at the DB level.
Use a partial index:

```python
op.create_index(
    "uq_streak_freeze_one_ad_per_day",
    "streak_freeze_log",
    ["user_id", sa.text("(created_at::date)")],
    unique=True,
    postgresql_where=sa.text("method = 'ad'"),
)
```

---

## 5. Daily reward ladder — concrete numbers

Per the product decisions locked in §1 of `backend-audit-rewards.md`:

### 5.1 Daily drip (small)

| Day | Free user | Premium user |
|-----|-----------|--------------|
| 1 | 10 sv | 20 sv |
| 2 | 10 sv | 20 sv |
| 3 | 10 sv | 20 sv |
| 4 | 10 sv | 20 sv |
| 5 | 10 sv | 20 sv |
| 6 | 10 sv | 20 sv |

Multiplier applied via `get_points_multiplier(user, "daily")` (2.0×).

### 5.2 Milestones (no premium multiplier)

| Lifetime streak day reached | Bonus sv |
|------------------------------|----------|
| 7 | 200 |
| 14 | 350 |
| 21 | 500 |
| 30 | 800 |
| 60 | 1500 |
| 100 | 3000 |
| 365 | 15000 |

Awarded ONCE per user per day-number (so a user who lapses to day 12
can re-earn Day 7, but cannot re-earn Day 7 after they've already
passed it once). Tracked via `UserRewardClaim(user_id, streak_day)`
existing table — the UNIQUE constraint on `(user_id, streak_day)`
already exists or is added in this migration.

### 5.3 Streak Freeze cost

| Current streak length | Freeze cost (sv) |
|-----------------------|------------------|
| 1-6 | 5 |
| 7-13 | 10 |
| 14-20 | 15 |
| 21-29 | 20 |
| 30+ | 30 |

Premium users: freeze always free via `method='premium'` in
`streak_freeze_log`.

---

## 6. Defensive backfill (parallel to migration)

`backend/app/main.py::_ensure_critical_columns` (currently lines 86-137)
gains a parallel helper:

```python
async def _ensure_wallet_split_columns():
    """Defensive backfill for the split-wallet columns.

    The 038_split_wallet_ledgers migration is the canonical fix, but
    the prod DB has been observed stuck at alembic rev 021 (see
    _ensure_critical_columns for context). This helper runs the same
    `ADD COLUMN IF NOT EXISTS` pattern as a belt-and-suspenders so the
    new code paths don't 500 if the migration never lands.
    """
    from sqlalchemy import text
    additions = (
        ("users", "service_credit_balance", "BIGINT NOT NULL DEFAULT 0"),
        ("users", "cashable_balance",       "BIGINT NOT NULL DEFAULT 0"),
        ("users", "device_id_hash",         "VARCHAR(64) NULL"),
    )
    try:
        async with engine.begin() as conn:
            for table, column, ddl in additions:
                await conn.execute(text(
                    f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS "
                    f"{column} {ddl}"
                ))
        logger.info("Wallet-split backfill: ensured %d columns exist",
                    len(additions))
    except Exception as exc:
        logger.error("Wallet-split backfill failed: %s", exc)
```

Schedule it in `lifespan` alongside `_ensure_critical_columns`.

**Note:** the backfill does NOT migrate data. The migration is the
only place where historical `points_balance` is split into the two
ledgers. If the migration never lands, the backfill still gives us
two zero columns, which is safe (everything defaults to 0) but does
NOT solve the policy problem. The migration MUST run before cutover.

---

## 6.5 Ad-network roadmap (post-migration)

The migration ships **AdMob only** for the wallet-split launch. After
the app is live with the split ledger, the following networks are
added in priority order. Each landing is its own PR (separate from
the wallet split) so rollback and incident response stay clean.

### Shortlist

| Network | Priority | Why | Effort |
|---------|----------|-----|--------|
| **AppLovin MAX** | P0 — next PR | Already stubbed in `ads.py:887`. Best MEA eCPM. Contract in place via shared `ads_service`. | Low |
| **Unity LevelPlay** (ironSource) | P1 | Dominant Nigerian mediation stack. Works as both network and mediator over AdMob+AppLovin. | Medium |
| **BidMachine** | P2 | Solid Nigerian presence. Bidding-based. | Medium |
| **Mintegral** | P3 | Growing MEA. Strong APAC fallback. | Medium-High |
| Meta Audience Network | **Skip** | Sunset June 2025/2026 — declining value. Don't invest engineering. |
| Pangle (TikTok) | Defer | Requires separate TikTok Business account + compliance review. |
| Others | Defer | Vungle, Tapjoy, Chartboost — declining MEA presence. |

### 200-ads/day global cap (across all networks AND all use cases)

**One cap, shared across everything:** 200 rewarded ad impressions
per user per day, summed across all ad networks (AdMob, AppLovin,
Unity, BidMachine, Mintegral, …) AND across all use cases (wallet
top-up, study unlock, streak recovery, withdrawal fee offset, quiz
extra life, daily bonus boost).

The user has 200 ad "credits" to spend however they want that day.
Whatever they don't spend doesn't roll over.

```
       ┌─────────────────────────────────────────────┐
       │  USER'S DAILY AD BUDGET: 200 impressions    │
       │  (resets at 00:00 UTC)                      │
       └─────────────────────────────────────────────┘
                       │
       ┌───────────────┼───────────────┬───────────────┐
       ▼               ▼               ▼               ▼
  [AdMob]         [AppLovin]        [Unity]      [BidMachine]   (etc.)
       │               │               │               │
       └───────────────┴───────────────┴───────────────┘
                       │
                       ▼
       ┌───────────────────────────────────────────────┐
       │  Per-use-case effect (decided by use_case    │
       │  string on AdRequest):                       │
       │   - wallet_topup:        +16/24 sv           │
       │   - study_unlock:        free asset unlock   │
       │   - streak_recovery:     restore missed day  │
       │   - withdrawal_fee_offset: waive ₦15/35/70   │
       │   - quiz_extra_life:     continue quiz       │
       │   - daily_bonus_boost:  2× daily claim       │
       └───────────────────────────────────────────────┘
```

**Enforcement:** single `SELECT COUNT(*) FROM ad_events WHERE
user_id=X AND ad_type='rewarded' AND credit_status='credited'
AND created_at >= today_start` runs in the SSV callback before any
credit/unlock. If `>= 200`, reject with `daily_ad_impression_cap_hit`.

**Why a global cap (not per-network, not per-use-case):**
- User can only redeem sv inside the app, so the cap is a UX/perception
  knob, not a cash-flow lever.
- Per-network caps would artificially throttle a profitable channel
  when network eCPMs diverge.
- Per-use-case caps add bookkeeping without user benefit (a user
  doesn't care which network served the ad).
- One number to explain to Google's reviewers: **"PagePay caps total
  rewarded impressions per user per day at 200, across all networks
  and all use cases."**

**Each new use case (follow-up PRs):**

| PR | Use case | Endpoint | Effect on sv |
|----|----------|----------|--------------|
| This migration | `wallet_topup` | existing SSV credit | +16/24 sv |
| 039 (post-launch) | `streak_recovery` | `POST /rewards/daily/freeze-by-ad` | 0 sv |
| 040 | `study_unlock` | `POST /study/unlock` with `method='ad'` | 0 sv |
| 041 | `withdrawal_fee_offset` | `POST /payouts/withdraw` with `fee_offset_ads=N` | 0 sv |
| 042 | `quiz_extra_life` | `POST /study/quiz/continue` | 0 sv |
| 043 | `daily_bonus_boost` | `POST /rewards/daily/boost` | bonus sv |

All of these share the **same 200/day global cap** enforced once at
the SSV layer.

---

## 7. Cutover flag

Add `settings.wallet_split_enabled: bool = False` (env
`WALLET_SPLIT_ENABLED`). When False, all credit sites still write to
`points_balance` (legacy behavior). When True, they write to the new
columns per the §3 mapping.

**Default False on initial deploy.** Flip to True after mobile clients
ship the v2 wallet UI. This gives a clean staged rollout:

1. Deploy migration 038 → columns exist, data split, code unchanged
2. Deploy code with `WALLET_SPLIT_ENABLED=False` → no behavior change
3. Ship mobile v2 → client renders the new balance fields
4. Flip env to `WALLET_SPLIT_ENABLED=True` → server starts writing
   to new columns

**This is optional** — we can also just ship the migration + code
together since the migration is idempotent and the mobile team can
ship in parallel. Recommend staged rollout anyway for rollback safety.

---

## 8. Rollback plan

### 8.1 If caught before data migration runs

```bash
alembic downgrade -1
```

Drops the new columns and zeros them. `points_balance` is untouched,
app continues working as before.

### 8.2 If caught after the migration runs

The downgrade SQL in §2 restores `points_balance =
service_credit_balance + cashable_balance` so the existing single-
field code paths work again. BUT:

- All `device_id_hash` data is lost (dropped by the downgrade).
- New `StreakFreezeLog` rows are lost.
- Future `point_credits.source = 'legacy_balance_split'` rows remain
  (informational only, won't break anything).

### 8.3 If caught weeks later with both ledgers active

Do NOT downgrade the migration. Instead:
1. Set `WALLET_SPLIT_ENABLED=False` to stop writing to new columns.
2. Fix the bug.
3. Manually backfill from `point_credits` if data drift is suspected.

---

## 9. Smoke test (post-deploy)

A simple verification script that runs against staging after the
migration applies:

```python
# scripts/verify_wallet_split.py
import asyncio
from sqlalchemy import text
from app.database import engine


async def main():
    async with engine.begin() as conn:
        # 1. Every user has both columns
        r = await conn.execute(text("""
            SELECT COUNT(*) FROM users
            WHERE service_credit_balance IS NULL
               OR cashable_balance IS NULL
        """))
        assert r.scalar() == 0, "Some users have NULL ledger values"

        # 2. No negative balances
        r = await conn.execute(text("""
            SELECT COUNT(*) FROM users
            WHERE service_credit_balance < 0
               OR cashable_balance < 0
        """))
        assert r.scalar() == 0, "Negative balances detected"

        # 3. Sum of (service + cashable) ≈ sum of historical
        #    point_credits for each user (within rounding)
        r = await conn.execute(text("""
            SELECT
                COUNT(*) FROM users u
            WHERE ABS(
                (u.service_credit_balance + u.cashable_balance)
                - COALESCE((
                    SELECT SUM(pc.points) FROM point_credits pc
                    WHERE pc.user_id = u.id
                      AND pc.source != 'legacy_balance_split'
                  ), 0)
            ) > 10  -- allow 10 pts rounding from kobo->points
        """))
        # NOTE: a non-zero result here is expected if point_credits
        # was added AFTER some historical credits. Investigate manually.

        # 4. Every user has a 'legacy_balance_split' marker row
        r = await conn.execute(text("""
            SELECT COUNT(*) FROM users u
            WHERE NOT EXISTS (
                SELECT 1 FROM point_credits pc
                WHERE pc.user_id = u.id
                  AND pc.source = 'legacy_balance_split'
            )
        """))
        assert r.scalar() == 0, "Some users missing legacy split marker"


asyncio.run(main())
print("✅ Wallet split verification passed")
```

---

## 10. Open questions for product (not blocking this doc)

These are intentional follow-ups. The migration can ship without them:

1. **Product discount mechanic** — letting users spend sv to discount
   airtime/data purchases. New endpoint family
   (`POST /bills/airtime/with-discount`?). Will need its own design doc.
2. **Streak Freeze UX** — modal placement, copy, what happens if the
   user dismisses the ad halfway. Mobile team owns.
3. **Premium milestone celebration visuals** — the client team picks
   the reusable component designs.
4. **Hard device cap vs soft device cap** — currently I spec "1 streak
   per device, hard cap". If product wants "1 streak per user, multiple
   devices OK, just IP-flag suspicious patterns", that's a different
   design. Lock this in before mobile ships.
5. **Cashable_balance withdrawal minimums** — does the migration affect
   the existing 100 pts (₦10) min withdrawal? Today the user can
   withdraw if they have 100 pts in `points_balance` (mixed). After
   the split, they need 100 pts in `cashable_balance`. A pure
   engagement-only user will have 0 cashable and hit the floor.
6. **AppLovin / Unity / BidMachine / Mintegral** — separate PR after
   app goes live. See §6.5.
7. **Daily ad cap tuning** — 200 ads/day (global, all networks and all
   use cases) is the starting number. After 2-4 weeks of post-launch
   data, review actual fill rates and engagement and adjust.

---

## 11. Out of scope (handled separately)

- **Sponsor wallet** (`User.sponsor_wallet_balance`) — already isolated.
  No migration needed.
- **Task payouts** (`UserReputation.total_earnings`) — already isolated.
- **Premium subscription** — does not credit `points_balance`. No
  migration needed beyond making sure the new columns are read where
  appropriate (it isn't).
- **The sv economy / discount layer** — covered in §12 below.

---

## 12. sv Economy — Sinks, Discounts, and the DLS Pattern

### 12.1 What sv is for (Dream League analogy)

The single most important framing for the entire migration: **sv is
the in-app coin currency, not cash.** The closest mental model is
Dream League Soccer:

| DLS | PagePay sv |
|-----|------------|
| Watch ad → earn coins | Watch ad → earn 16 sv (24 sv premium) |
| Buy a player (₦150 equivalent) | Spend 150 sv to unlock a study asset |
| Train a player (₦50 equivalent) | Spend 50 sv on streak recovery / quiz boost |
| Expand stadium (₦1000 equivalent) | Spend 1000 sv on a premium trial |
| Spin the wheel (₦10 equivalent) | Spend 10 sv for a chance at quiz bonus |
| Cash | **No equivalent. Cannot convert sv to cash. Period.** |

**Critical design property:** sv has *many* in-app sinks, not one or
two. If users only had "spend sv on study unlocks" they'd accumulate
sv forever and the value would inflate. Multiple sinks make sv feel
like a real circulating currency.

### 12.2 The 25% cap — where it applies (and where it doesn't)

Google AdMob's policy caps the value a user can derive from a
rewarded ad at **25% of the underlying product's price**. This cap
applies to **one specific path only**:

```
ad → sv credited → sv used as cash-equivalent discount on a bill
```

It does **NOT** limit:
- Ad-impression spend on `study_unlock`, `streak_recovery`,
  `withdrawal_fee_offset`, `quiz_extra_life` — these are
  **in-app actions**, no cash equivalent.
- Ad-impression spend on `daily_bonus_boost` — the boost is sv
  credited as a multiplier, not a cash discount.
- Ad-impression spend on `withdrawal_fee_offset` — the ad waives a
  service fee, not a product price.

The cap formula is computed at redemption time:

```python
# services/discount.py
DISCOUNT_CAP_PERCENT = settings.admob_discount_cap_percent  # 0.25

def max_discount_sv(price_kobo: int) -> int:
    """Max sv discount for a product priced in price_kobo kobo.
    25% of full price, converted via POINTS_PER_NAIRA, rounded UP."""
    full_price_sv = kobo_to_points(price_kobo)
    return math.ceil(full_price_sv * DISCOUNT_CAP_PERCENT)
```

Example: ₦100 airtime = 1,000 sv full price. Max sv discount = 250 sv.

### 12.3 sv sinks — Tier A / B / C

**Tier A — Ship in migration 039 (post-launch, separate PR):**

| Sink | Cost (sv) | What user gets | Cap |
|------|-----------|----------------|-----|
| Study asset unlock (text) | 50 | Unlock one text study asset | Per-asset, unlimited |
| Study asset unlock (video) | 200 | Unlock one video study asset | Per-asset, unlimited |
| Streak recovery (by sv, not ad) | 5 / 10 / 15 / 20 / 30 (by streak tier) | Restore one missed day | Per missed day |
| Withdrawal fee waiver (by ad, not sv) | 0 sv — uses ad impressions | Reduce/waive ₦15/35/70 fee | Per withdrawal |

**Tier B — Ship in migration 039 (with Tier A):**

| Sink | Cost (sv) | What user gets |
|------|-----------|----------------|
| Quiz extra life | 30 | Continue a failed quiz attempt once |
| Daily bonus boost | 50 | 2× multiplier on next daily claim |
| Bill purchase discount (25% cap) | variable, capped | Cash-equivalent discount on airtime/data/etc. |

**Tier B — Ship in migration 040:**

| Sink | Cost (sv) | What user gets |
|------|-----------|----------------|
| Reading streak shield | 100 | One missed-day grace on reading streak (separate from login streak) |

**Tier C — Spec'd here, ship in 041+:**

| Sink | Cost (sv) | What user gets | AdMob risk |
|------|-----------|----------------|------------|
| Avatar pack / profile badge | 200-500 | Cosmetic | None — pure sink |
| 7-day premium trial | 1,500 | All premium features for 7 days | Low — premium itself is cash-funded; this is a *trial* not a purchase |
| Ad-free reading session (1 hour) | 80 | No pre/post-read ads for the hour | None — affects UX, no cash flow |
| Reading session multiplier (1 hour) | 30 | 2× reading bonus for the hour | None |
| Sponsored task priority queue | 50 | Skip the line on sponsor tasks | Low |
| Featured content unlock | 100 | Skip ads on premium content | None |
| Gift to a friend | **DISABLED** | n/a | High — would violate non-transferability |

**The premium-trial sink is the only Tier C item with any AdMob
risk.** If Google pushes back on it, drop just that one and ship the
others. The rest are zero-risk because they have no cash equivalent.

### 12.4 Discount flow — shortfall routes to ads, never a dead end

**Never return a hard 402 to the user.** When `apply_sv_discount`
exceeds `service_credit_balance`:

1. Server computes the shortfall and ads needed.
2. Server returns HTTP 402 with `code: service_credit_shortfall` and
   the `earn_route` block.
3. Client shows "Watch N ads to get this discount?" modal.
4. User confirms, ad flow starts.
5. After N ads, server credits sv via `wallet_topup` use_case.
6. Client re-submits the bill purchase — succeeds.

Response shape:

```json
{
  "error": {
    "code": "service_credit_shortfall",
    "message": "You have 8 sv but requested 50 sv discount. Watch 3 ads to earn the remaining 42 sv.",
    "details": {
      "service_credit_balance": 8,
      "requested_sv": 50,
      "shortfall_sv": 42,
      "ads_needed": 3,
      "ads_remaining_today": 153,
      "earn_route": {
        "use_case": "wallet_topup",
        "expected_sv_per_ad": 16,
        "expected_total_sv": 48,
        "deep_link": "pagepay://ad-wallet-topup?target=42"
      }
    }
  }
}
```

Server-side helper:

```python
# services/discount.py
class SvShortfall(Exception):
    def __init__(self, shortfall_sv: int, ads_needed: int,
                 ads_remaining: int, ads_remaining_after: int):
        self.shortfall_sv = shortfall_sv
        self.ads_needed = ads_needed
        self.ads_remaining = ads_remaining
        self.ads_remaining_after = ads_remaining_after


def check_discount_apply(user: User, product_type: str,
                         price_kobo: int, sv_requested: int) -> int:
    """Returns the actual sv to apply. Raises SvShortfall if user doesn't
    have enough and can't top up via ads (200/day cap reached)."""
    cap = max_discount_sv(price_kobo)
    requested = min(sv_requested, cap)

    if user.service_credit_balance >= requested:
        return requested  # enough sv, proceed normally

    shortfall = requested - user.service_credit_balance
    ads_needed = math.ceil(shortfall / 16)  # 16 sv/free ad

    # Check the user has ad-budget remaining to earn the shortfall
    today_count = get_ad_impression_count_today(user.id)
    ads_remaining = settings.daily_ad_impression_cap - today_count
    if ads_needed > ads_remaining:
        # Cap on ads reached; can't bridge the gap. Apply what they have.
        return user.service_credit_balance  # partial discount, no shortfall

    raise SvShortfall(
        shortfall_sv=shortfall,
        ads_needed=ads_needed,
        ads_remaining=ads_remaining,
        ads_remaining_after=ads_remaining - ads_needed,
    )
```

**Bills router pattern (airtime example):**

```python
# routers/bills.py — buy_airtime
try:
    sv_to_use = check_discount_apply(
        user_row, "airtime", amount_kobo, payload.apply_sv_discount
    )
except SvShortfall as sf:
    raise HTTPException(
        status_code=402,
        detail={
            "code": "service_credit_shortfall",
            "message": (
                f"You have {user_row.service_credit_balance} sv but requested "
                f"{payload.apply_sv_discount} sv discount. Watch {sf.ads_needed} "
                f"ads to earn the remaining {sf.shortfall_sv} sv."
            ),
            "details": {
                "service_credit_balance": user_row.service_credit_balance,
                "requested_sv": payload.apply_sv_discount,
                "shortfall_sv": sf.shortfall_sv,
                "ads_needed": sf.ads_needed,
                "ads_remaining_today": sf.ads_remaining,
                "earn_route": {
                    "use_case": "wallet_topup",
                    "expected_sv_per_ad": 16,
                    "expected_total_sv": sf.ads_needed * 16,
                    "deep_link": f"pagepay://ad-wallet-topup?target={sf.shortfall_sv}",
                },
            },
        },
    )

# Proceed with discount applied
cashable_debit_pts = kobo_to_points(amount_kobo) - sv_to_use
sv_debit_pts = sv_to_use

if user_row.cashable_balance < cashable_debit_pts:
    raise HTTPException(402, "Insufficient cashable balance")
if user_row.service_credit_balance < sv_debit_pts:
    raise HTTPException(402, "Insufficient service credit balance")

await db.execute(
    update(User).where(User.id == user.id)
    .values(
        cashable_balance=User.cashable_balance - cashable_debit_pts,
        service_credit_balance=User.service_credit_balance - sv_debit_pts,
    )
)

# Audit row for AdMob reviewers
db.add(DiscountRedemption(
    user_id=user.id,
    product_type="airtime",
    product_price_sv=kobo_to_points(amount_kobo),
    sv_redeemed=sv_to_use,
    cash_paid_kobo=amount_kobo,
    max_allowed_sv=max_discount_sv(amount_kobo),
))
```

### 12.5 Withdrawal fee waiver — `use_case: 'withdrawal_fee_offset'`

The withdrawal fee is **not** sv-discountable (the value ratio doesn't
work — 17 sv to save ₦1.70 is net zero). Instead, users spend
**ad impressions** to reduce the fee.

| Fee tier | Ads to fully waive | Per-ad reduction |
|----------|--------------------|-------------------|
| ₦15 | 1 ad | ₦15/ad |
| ₦35 | 2 ads | ₦17.50/ad |
| ₦70 | 4 ads | ₦17.50/ad |

**Partial waivers allowed:** any number of ads 1 ≤ n ≤ full_waive_ads.

**New request field:**

```python
class WithdrawRequest(BaseModel):
    amount_naira: int
    bank_account_id: int
    pin: str
    fee_offset_ads: int = Field(
        default=0, ge=0,
        description="Number of ads to watch to reduce/waive the fee. "
                    "Each ad reduces the fee by (fee / ads_required_for_full_waive)."
    )
```

But ads are watched **before** the withdrawal submits. Flow:

1. User taps "Withdraw ₦5,000" → client shows "Fee: ₦70. Watch 4 ads
   to waive it, 2 ads to cut to ₦35, or pay full."
2. User picks option → client triggers ad-watching flow with
   `use_case='withdrawal_fee_offset'`.
3. After N ads watched, the SSV handler stamps a `PendingFeeWaiver`
   row (does NOT credit sv).
4. Client re-submits withdraw with `fee_offset_ads=N` and a
   server-issued `fee_offset_proof` token.
5. Server validates the proof token, applies the waiver, debits the
   (possibly reduced) fee.

**`PendingFeeWaiver` table (added in migration 039):**

```python
op.create_table(
    "pending_fee_waivers",
    sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
    sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id"),
              nullable=False, index=True),
    sa.Column("withdrawal_amount_naira", sa.Integer(), nullable=False),
    sa.Column("original_fee_naira", sa.Integer(), nullable=False),
    sa.Column("ads_watched", sa.Integer(), nullable=False),
    sa.Column("discounted_fee_naira", sa.Integer(), nullable=False),
    sa.Column("proof_token", sa.String(64), nullable=False, unique=True, index=True),
    sa.Column("expires_at", sa.DateTime(), nullable=False, index=True),
    sa.Column("consumed_at", sa.DateTime(), nullable=True),
    sa.Column("created_at", sa.DateTime(), server_default=sa.text("NOW()"),
              nullable=False),
)
```

`proof_token` is opaque, 32-byte URL-safe, expires after 5 minutes.
Once consumed, the waiver is bound to the resulting `PayoutTransaction`.

### 12.6 Anti-hoarding — sink capacity vs earning rate

For sv to be a healthy currency, total daily sv inflow ≤ total daily
sv sink capacity. Otherwise users accumulate indefinitely and the
value inflates.

**Per-user daily sv inflow (free tier, upper bound):**

| Source | Daily max |
|--------|-----------|
| Ads (200 cap × 16 sv) | 3,200 sv |
| Daily drip (10/day) | 10 sv |
| Milestone (Day 7/14/21/30/60/100/365) | 200/350/500/800/1,500/3,000/15,000 sv (one-time) |
| Welcome bonus | 100 sv (one-time) |
| Referral (referee) | 200 sv (one-time) |
| Referral (referrer) | 500 sv (one-time, max 10/day = 5,000 sv) |
| Quiz bonus | unlimited, but bounded by # of quizzes taken |

**The 200-ad/day cap is the dominant inflow.** Everything else is
small change or one-time. The Tier A + B sinks can absorb:

| Sink | Daily capacity (per user) |
|------|---------------------------|
| Study unlock (text) | 50 sv × ~20 = 1,000 sv (if user takes 20 study assets/day) |
| Study unlock (video) | 200 sv × ~5 = 1,000 sv |
| Streak recovery (sv path) | ~15 sv/day average |
| Quiz extra life | 30 sv × 10 = 300 sv |
| Daily bonus boost | 50 sv × 1 = 50 sv |
| Bill purchase discount | up to 25% of bills, ~500 sv/day |

**Total sink capacity:** ~2,800 sv/day. **Total inflow:** ~3,200 sv/day
from ads alone. **Slight imbalance.** The fix:

1. **Sub-cap on ad-driven wallet_topup use_case.** Of the 200/day ad
   cap, reserve at least 50/day for non-wallet_topup use cases
   (study_unlock, streak_recovery, etc). Means `wallet_topup` is
   capped at 150/day, not 200.
2. **Aggressive Tier C sink rollout.** Cosmetic packs and premium
   trials give users somewhere to put surplus sv.

```python
# Config (migration 039+)
ad_use_case_daily_caps = {
    "wallet_topup": 150,            # leave room for other use cases
    "study_unlock": 50,             # explicit per-use-case caps
    "streak_recovery": 5,           # ~weekly usage
    "withdrawal_fee_offset": 8,     # 2 withdrawals/day max
    "quiz_extra_life": 10,
    "daily_bonus_boost": 1,
}
# Global cap remains 200; per-use-case caps are sub-floors.
```

### 12.7 Non-transferability — P2P blocks

**AdMob requires ad-derived credits to be non-transferable.** PagePay
has a beneficiary/P2P transfer feature (Phase 7+); sv **must not** be
a transferable asset.

**Enforcement:**

```python
# routers/beneficiaries.py or wherever P2P transfers live
# In the transfer endpoint, BEFORE any debit:
if transfer.from_balance == "service_credit":
    raise HTTPException(
        status_code=403,
        detail={
            "code": "non_transferable",
            "message": (
                "Service credits cannot be transferred to other users. "
                "Transfer cashable_balance or sponsor_wallet_balance only."
            ),
        },
    )
```

The transfer schema already requires `from_balance: Literal['cashable',
'sponsor']` (or similar). Add `"service_credit"` to the *disallowed*
list, with a clear error message.

**Audit:** every transfer endpoint logs `from_balance` and `to_user`.
A monthly report flags any attempt to transfer from service_credit —
even rejected attempts — for review. This proves to Google's
reviewers that we actively enforce non-transferability.

### 12.8 Premium trial as Tier C sink (with AdMob risk note)

Premium trial at 1,500 sv → 7-day premium features.

**Why this is potentially risky:** A user could watch ~94 ads (free
tier) to "buy" a premium trial. AdMob might read this as "premium
features in exchange for ad interaction."

**Why this is probably fine:**
- The trial is **time-limited** (7 days), not permanent premium.
- Premium features themselves don't generate ad-derived cash (the
  user can SKIP ads during the trial, which means they watch fewer
  ads, not more).
- The 1,500 sv cost is substantial — not a casual exchange.
- This is functionally identical to "spend sv on a 7-day Xbox Game
  Pass" in a gaming rewards program. Common pattern.

**Recommended rollout:** ship Tier C sinks **except premium trial**
in 041. Ship premium trial in 042 with **A/B test** — 50% of users
see it, 50% don't. Monitor AdMob account health metrics for 90 days.
If no flags, roll out to 100%.

If AdMob pushes back, drop premium trial from the sink list. The
other Tier C sinks are zero-risk and unaffected.

---

## 13. Open questions for product (replaces §10 list — full update)

The §10 list still applies. New additions from §12:

11. **Bill purchase discount UX** — confirm Pattern A (client-side
    modal: "Watch N ads?") vs Pattern B (server-side auto-trigger).
    My recommendation: A.
12. **Withdrawal fee waiver pricing** — 1/2/4 ads for ₦15/35/70.
    Confirm or adjust ratios.
13. **ad_use_case_daily_caps** — the sub-floor values (150/50/5/8/10/1)
    need tuning after 2-4 weeks of post-launch data.
14. **Premium trial A/B test scope** — 50% rollout for 90 days,
    starting in 042. Confirm or change ratio.
15. **P2P transfer from_balance audit log** — monthly review of
    rejected transfer attempts. Confirm ops owns this report.
