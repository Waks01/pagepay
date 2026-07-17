"""Add email_verification_code column to users table.

Revision ID: 012_add_email_verification_code
Revises: 011_fix_points_conversion_rate
Create Date: 2026-07-11 17:50:00.000000

"""
from typing import Sequence, Union
from alembic import op


revision: str = '012_add_email_verification_code'
down_revision: Union[str, None] = '011_fix_points_conversion_rate'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS email_verification_code VARCHAR(255) NULL
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE users
        DROP COLUMN IF EXISTS email_verification_code
    """)
