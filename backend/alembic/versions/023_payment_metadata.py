"""Add metadata column to payments table for wallet deposit tracking.

Revision ID: 023_payment_metadata
Revises: 022_admin_tasks
Create Date: 2026-07-24

Why:
  - Wallet deposits need to track the actual deposit amount (without fee)
    so the webhook can credit the correct number of points.
  - The `amount_kobo` field stores the total paid (deposit + fee), so
    we need a separate place to store the deposit amount.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "023_payment_metadata"
down_revision: Union[str, None] = "022_admin_tasks"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if not _column_exists("payments", "metadata"):
        op.add_column('payments', sa.Column('metadata', sa.JSON(), nullable=True))


def downgrade() -> None:
    if _column_exists("payments", "metadata"):
        op.drop_column('payments', 'metadata')


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
