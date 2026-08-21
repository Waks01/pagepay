"""add_login_tracking_to_streaks

Revision ID: 033_add_login_tracking
Revises: 032_add_user_streaks_table
Create Date: 2026-08-21 10:45:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '033_add_login_tracking'
down_revision = '032_add_user_streaks_table'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add new columns to user_streaks table
    op.add_column('user_streaks', sa.Column('last_login_date', sa.String(10), nullable=True))
    op.add_column('user_streaks', sa.Column('consecutive_login_days', sa.Integer(), server_default='0', nullable=False))


def downgrade() -> None:
    # Remove the columns
    op.drop_column('user_streaks', 'consecutive_login_days')
    op.drop_column('user_streaks', 'last_login_date')