"""add_avatar_url_to_users

Revision ID: 031_add_avatar_url_to_users
Revises: 030_add_bill_transaction_details
Create Date: 2026-08-19 18:38:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '031_add_avatar_url_to_users'
down_revision: Union[str, None] = '030_add_bill_transaction_details'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = {c['name'] for c in inspector.get_columns('users')}

    if 'avatar_url' not in columns:
        op.add_column('users', sa.Column('avatar_url', sa.String(512), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = {c['name'] for c in inspector.get_columns('users')}

    if 'avatar_url' in columns:
        op.drop_column('users', 'avatar_url')
