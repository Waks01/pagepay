"""add_audio_unlocks

Adds the ``audio_unlocks`` table for per-user, per-material audio unlocks.

Revision ID: 039_add_audio_unlocks
Revises: 038_split_wallet_ledgers
"""
from __future__ import annotations

from typing import Any

from alembic import op
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision: str = "039_add_audio_unlocks"
down_revision: str = "038_split_wallet_ledgers"
branch_labels: Any = None
depends_on: Any = None


def upgrade() -> None:
    conn = op.get_bind()

    if not _col_exists(conn, "audio_unlocks", "id"):
        op.create_table(
            "audio_unlocks",
            sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column("user_id", sa.BigInteger(), nullable=False, index=True),
            sa.Column("material_id", sa.BigInteger(), nullable=False, index=True),
            sa.Column("method", sa.String(20), nullable=False),
            sa.Column("cost_sv", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("ad_event_id", sa.BigInteger(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.text("NOW()"), nullable=False),
        )
        op.create_index(
            "uq_audio_unlock_user_material",
            "audio_unlocks",
            ["user_id", "material_id"],
            unique=True,
        )


def downgrade() -> None:
    conn = op.get_bind()

    if _col_exists(conn, "audio_unlocks", "id"):
        op.drop_index("uq_audio_unlock_user_material", table_name="audio_unlocks")
        op.drop_table("audio_unlocks")


def _col_exists(conn, table: str, col: str) -> bool:
    try:
        return bool(conn.execute(text(f"SELECT column_name FROM information_schema.columns WHERE table_name = '{table}' AND column_name = '{col}'")).fetchone())
    except Exception:
        return False
