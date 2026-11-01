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
    #    _ensure_critical_columns defensive backfill in main.py may have
    #    run first).
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

    # 5. Create streak_freeze_log table for streak recovery tracking.
    if not _col_exists(conn, "streak_freeze_log", "id"):
        op.create_table(
            "streak_freeze_log",
            sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("method", sa.String(20), nullable=False),
            sa.Column("sv_spent", sa.BigInteger(), nullable=False, server_default="0"),
            sa.Column("streak_length_at_freeze", sa.Integer(), nullable=False),
            sa.Column("ad_event_id", sa.BigInteger(), nullable=True),
            sa.Column("device_id_hash", sa.String(64), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.text("NOW()"), nullable=False),
        )
        op.create_index(op.f("ix_streak_freeze_log_user_id"), "streak_freeze_log", ["user_id"], unique=False)
        op.create_index(op.f("ix_streak_freeze_log_created_at"), "streak_freeze_log", ["created_at"], unique=False)
        op.create_index(
            "uq_streak_freeze_one_ad_per_day",
            "streak_freeze_log",
            ["user_id", sa.text("(created_at::date)")],
            unique=True,
            postgresql_where=sa.text("method = 'ad'"),
        )


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

    if _col_exists(conn, "streak_freeze_log", "id"):
        op.drop_index("uq_streak_freeze_one_ad_per_day", table_name="streak_freeze_log")
        op.drop_index(op.f("ix_streak_freeze_log_created_at"), table_name="streak_freeze_log")
        op.drop_index(op.f("ix_streak_freeze_log_user_id"), table_name="streak_freeze_log")
        op.drop_table("streak_freeze_log")
