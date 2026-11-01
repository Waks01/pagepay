"""Adjust points conversion rate from 100 pts = ₦1 to 10 pts = ₦1

Revision ID: 009_adj_points_rate
Revises: 008_encrypt_payout_acct
Create Date: 2026-07-08 14:55:00.000000

"""
from typing import Sequence, Union
from alembic import op


revision: str = '009_adj_points_rate'
down_revision: Union[str, None] = '008_encrypt_payout_acct'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE users SET points_balance = points_balance * 10")


def downgrade() -> None:
    op.execute("UPDATE users SET points_balance = points_balance / 10")
