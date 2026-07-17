"""Add transaction_pin_hash column to users table.

Revision ID: 013_add_transaction_pin_hash
Revises: 012_add_email_verification_code
Create Date: 2026-07-12 10:17:00.000000

"""
from typing import Sequence, Union
from alembic import op


revision: str = '013_add_transaction_pin_hash'
down_revision: Union[str, None] = '012_add_email_verification_code'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS transaction_pin_hash VARCHAR(255) NULL
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE users
        DROP COLUMN IF EXISTS transaction_pin_hash
    """)
