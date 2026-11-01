"""Change payout_accounts.account_number to Text for encrypted storage

Revision ID: 008_encrypt_payout_acct
Revises: 007_add_user_audit_logs
Create Date: 2026-07-07 01:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '008_encrypt_payout_acct'
down_revision: Union[str, None] = '007_add_user_audit_logs'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cols = {c['name']: c for c in inspector.get_columns('payout_accounts')}
    if 'account_number' in cols and not isinstance(cols['account_number']['type'], sa.Text):
        op.alter_column('payout_accounts', 'account_number', existing_type=sa.String(10), type_=sa.Text())


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cols = {c['name']: c for c in inspector.get_columns('payout_accounts')}
    if 'account_number' in cols and isinstance(cols['account_number']['type'], sa.Text):
        op.alter_column('payout_accounts', 'account_number', existing_type=sa.Text(), type_=sa.String(10))
