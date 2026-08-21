"""Add user_streaks table for daily login tracking

Revision ID: 032_add_user_streaks_table
Revises: 031_add_avatar_url_to_users
Create Date: 2026-08-21 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql

# revision identifiers, used by Alembic.
revision = '032_add_user_streaks_table'
down_revision = '031_add_avatar_url_to_users'
branch_labels = None
depends_on = None


def upgrade():
    # Create user_streaks table
    op.create_table('user_streaks',
        sa.Column('user_id', sa.BigInteger(), nullable=False),
        sa.Column('current_streak', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('longest_streak', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('last_activity_date', sa.String(10), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('user_id'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    )
    
    # Create index on user_id for faster lookups
    op.create_index(op.f('ix_user_streaks_user_id'), 'user_streaks', ['user_id'], unique=False)


def downgrade():
    op.drop_index(op.f('ix_user_streaks_user_id'), table_name='user_streaks')
    op.drop_table('user_streaks')