"""add_missing_user_streaks_columns

Revision ID: 035_add_missing_user_streaks_columns
Revises: 034_add_last_claim_date
Create Date: 2026-08-23 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = '035_add_user_streaks_cols'
down_revision = '034_add_last_claim_date'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing = inspector.get_table_names()
    if 'user_streaks' not in existing:
        return

    columns = inspector.get_columns('user_streaks')
    existing_cols = {c['name'] for c in columns}

    to_add = []
    if 'last_login_date' not in existing_cols:
        to_add.append(sa.Column('last_login_date', sa.String(10), nullable=True))
    if 'consecutive_login_days' not in existing_cols:
        to_add.append(sa.Column('consecutive_login_days', sa.Integer, nullable=False, server_default='0'))
    if 'longest_login_streak' not in existing_cols:
        to_add.append(sa.Column('longest_login_streak', sa.Integer, nullable=False, server_default='0'))
    if 'total_logins' not in existing_cols:
        to_add.append(sa.Column('total_logins', sa.Integer, nullable=False, server_default='0'))
    if 'reward_streak' not in existing_cols:
        to_add.append(sa.Column('reward_streak', sa.Integer, nullable=False, server_default='0'))
    if 'longest_reward_streak' not in existing_cols:
        to_add.append(sa.Column('longest_reward_streak', sa.Integer, nullable=False, server_default='0'))
    if 'last_reward_claim_date' not in existing_cols:
        to_add.append(sa.Column('last_reward_claim_date', sa.String(10), nullable=True))
    if 'reward_streak_expires_at' not in existing_cols:
        to_add.append(sa.Column('reward_streak_expires_at', sa.DateTime, nullable=True))

    if to_add:
        for col in to_add:
            op.add_column('user_streaks', col)


def downgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing = inspector.get_table_names()
    if 'user_streaks' not in existing:
        return

    columns = inspector.get_columns('user_streaks')
    existing_cols = {c['name'] for c in columns}

    drop_cols = [
        'reward_streak_expires_at',
        'last_reward_claim_date',
        'longest_reward_streak',
        'reward_streak',
        'total_logins',
        'longest_login_streak',
        'consecutive_login_days',
        'last_login_date',
    ]
    for col in drop_cols:
        if col in existing_cols:
            op.drop_column('user_streaks', col)
