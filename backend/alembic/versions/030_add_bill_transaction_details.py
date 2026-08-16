"""add_bill_transaction_details_column

Revision ID: 030_add_bill_transaction_details
Revises: 029_add_beneficiaries_table
Create Date: 2026-08-15 10:04:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '030_add_bill_transaction_details'
down_revision: Union[str, None] = '029_add_beneficiaries_table'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = {c['name'] for c in inspector.get_columns('bill_transactions')}

    if 'details' not in columns:
        op.add_column('bill_transactions', sa.Column('details', sa.JSON(), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = {c['name'] for c in inspector.get_columns('bill_transactions')}

    if 'details' in columns:
        op.drop_column('bill_transactions', 'details')
