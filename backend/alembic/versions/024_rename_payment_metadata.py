"""Rename payment.metadata to payment.payment_metadata to avoid SQLAlchemy reserved word conflict.

Revision ID: 024_rename_payment_metadata
Revises: 023_payment_metadata
Create Date: 2026-07-26

Why:
  - SQLAlchemy reserves the name 'metadata' for the Base.metadata registry.
  - Having a column named 'metadata' causes InvalidRequestError on model load.
  - Rename to 'payment_metadata' to avoid the conflict.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "024_rename_payment_metadata"
down_revision: Union[str, None] = "023_payment_metadata"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Idempotent in two cases:
    #   - Fresh DB: model declares `payment_metadata` directly, no rename
    #     needed.
    #   - Legacy DB: had `metadata`, never been renamed.
    if _column_exists("payments", "metadata") and not _column_exists("payments", "payment_metadata"):
        op.alter_column('payments', 'metadata', new_column_name='payment_metadata')


def downgrade() -> None:
    # Rename payment_metadata back to metadata
    if _column_exists("payments", "payment_metadata"):
        op.alter_column('payments', 'payment_metadata', new_column_name='metadata')


def _column_exists(table_name: str, column_name: str) -> bool:
    conn = op.get_bind()
    result = conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = :tname AND column_name = :cname"
        ),
        {"tname": table_name, "cname": column_name},
    )
    return result.scalar() > 0
