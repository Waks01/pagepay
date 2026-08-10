"""Create beneficiaries table for saved airtime/data contacts.

Revision ID: 029_add_beneficiaries_table
Revises: 028_add_username_to_users
Create Date: 2026-08-10 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '029_add_beneficiaries_table'
down_revision: Union[str, None] = '028_add_username_to_users'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = {t['name'] for t in inspector.get_tables()}

    if 'beneficiaries' not in tables:
        op.create_table(
            'beneficiaries',
            sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
            sa.Column('user_id', sa.BigInteger, nullable=False, index=True),
            sa.Column('name', sa.String(100), nullable=False),
            sa.Column('phone', sa.String(20), nullable=False),
            sa.Column('network', sa.String(20), nullable=False, server_default='mtn'),
            sa.Column('created_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint('user_id', 'phone', name='uq_beneficiary_user_phone'),
        )
        op.create_index('ix_beneficiaries_created_at', 'beneficiaries', ['created_at'])
        op.create_index('ix_beneficiaries_user_id', 'beneficiaries', ['user_id'])


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = {t['name'] for t in inspector.get_tables()}

    if 'beneficiaries' in tables:
        existing_indexes = {ix['name'] for ix in inspector.get_indexes('beneficiaries')}
        for idx in ('ix_beneficiaries_user_id', 'ix_beneficiaries_created_at', 'uq_beneficiary_user_phone'):
            if idx in existing_indexes:
                op.drop_index(idx, table_name='beneficiaries')
        op.drop_table('beneficiaries')
