"""add_last_claim_date_to_user_streaks

Revision ID: 034_add_last_claim_date
Revises: 033_add_login_tracking
Create Date: 2026-08-21 12:55:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = '034_add_last_claim_date'
down_revision = '033_add_login_tracking'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('user_streaks', sa.Column('last_claim_date', sa.String(10), nullable=True))


def downgrade() -> None:
    op.drop_column('user_streaks', 'last_claim_date')
