"""add_ad_requests_use_case

Adds the ``use_case`` column to ``ad_requests`` so the SSV token flow
can tag each request with its purpose (wallet_topup, study_unlock, etc.).

Revision ID: 040_add_ad_requests_use_case
Revises: 039_add_audio_unlocks
"""
from __future__ import annotations

from typing import Any

from alembic import op
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision: str = "040_add_ad_requests_use_case"
down_revision: str = "039_add_audio_unlocks"
branch_labels: Any = None
depends_on: Any = None


def upgrade() -> None:
    conn = op.get_bind()

    if not _col_exists(conn, "ad_requests", "use_case"):
        op.execute(
            text(
                "ALTER TABLE ad_requests "
                "ADD COLUMN use_case VARCHAR(50) NULL "
                "CONSTRAINT use_case_default DEFAULT 'wallet_topup'"
            )
        )


def downgrade() -> None:
    conn = op.get_bind()

    if _col_exists(conn, "ad_requests", "use_case"):
        op.execute(text("ALTER TABLE ad_requests DROP COLUMN use_case"))


def _col_exists(conn, table: str, col: str) -> bool:
    try:
        return bool(
            conn.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    f"WHERE table_name = '{table}' AND column_name = '{col}'"
                )
            ).fetchone()
        )
    except Exception:
        return False
