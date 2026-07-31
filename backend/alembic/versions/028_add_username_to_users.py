"""Add username column to users table.

Revision ID: 028_add_username_to_users
Revises: 027_backfill_missing_indexes
Create Date: 2026-07-31 12:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '028_add_username_to_users'
down_revision: Union[str, None] = '027_backfill_missing_indexes'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [c['name'] for c in inspector.get_columns('users')]
    if 'username' not in columns:
        op.add_column('users', sa.Column('username', sa.String(12), unique=True, index=True, nullable=True))
        op.create_index('ix_users_username', 'users', ['username'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_users_username', table_name='users')
    op.drop_column('users', 'username')
