"""Backfill two indexes that 005/006 declared but never landed on Neon.

Both migrations wrap their DDL in `if 'table' not in existing_tables` checks
that skip when the table is already present (because Neon was bootstrapped
via out-of-band DDL, not via alembic). The result:

  - `fcm_tokens.is_active`         — no index, full-table scan on every
    "active tokens for a push" query.
  - `users.email_verified`         — no index, full-table scan on every
    "verified users" query.

Migration 005 only creates `ix_fcm_tokens_is_active` inside the `if not
existing_tables` block. Migration 006 only creates `ix_users_email_verified`
the same way. This catch-up migration creates whichever index is missing
on the live DB and is a no-op on a fresh DB that already has them.

Revision ID: 027_backfill_missing_indexes
Revises: 026_welcome_bonus
Create Date: 2026-07-30 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '027_backfill_missing_indexes'
down_revision: Union[str, None] = '026_welcome_bonus'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _index_exists(index_name: str) -> bool:
    conn = op.get_bind()
    row = conn.execute(
        sa.text(
            "SELECT 1 FROM pg_indexes "
            "WHERE schemaname='public' AND indexname=:n"
        ),
        {"n": index_name},
    ).first()
    return row is not None


def upgrade() -> None:
    # fcm_tokens.is_active — declared in 005_notification_preferences
    if not _index_exists('ix_fcm_tokens_is_active'):
        # Guard: 000 creates this index from the model only if the model
        # declares it. Confirm the table itself exists before adding.
        conn = op.get_bind()
        has_fcm = conn.execute(
            sa.text(
                "SELECT 1 FROM pg_tables "
                "WHERE schemaname='public' AND tablename='fcm_tokens'"
            )
        ).first()
        if has_fcm:
            op.create_index(
                'ix_fcm_tokens_is_active',
                'fcm_tokens',
                ['is_active'],
                unique=False,
            )

    # users.email_verified — declared in 006_move_sponsor_fields_to_user
    if not _index_exists('ix_users_email_verified'):
        conn = op.get_bind()
        has_users = conn.execute(
            sa.text(
                "SELECT 1 FROM pg_tables "
                "WHERE schemaname='public' AND tablename='users'"
            )
        ).first()
        if has_users:
            op.create_index(
                'ix_users_email_verified',
                'users',
                ['email_verified'],
                unique=False,
            )


def downgrade() -> None:
    if _index_exists('ix_users_email_verified'):
        op.drop_index('ix_users_email_verified', table_name='users')
    if _index_exists('ix_fcm_tokens_is_active'):
        op.drop_index('ix_fcm_tokens_is_active', table_name='fcm_tokens')