"""add_bill_disputes_scheduled_bills_and_delivery_verification

Revision ID: 037_add_bill_disputes_scheduled_bills
Revises: 036_content_source
Create Date: 2026-08-24 13:04:00.000000

Adds:
- bill_disputes table for VTU delivery dispute tracking
- scheduled_bills table for recurring bill purchases
- delivery verification columns to bill_transactions
- updated_at column to bill_transactions

"""
from alembic import op
import sqlalchemy as sa
from datetime import datetime


# revision identifiers, used by Alembic.
revision = '037_add_bill_disputes'
down_revision = '036_content_source'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add delivery verification columns to bill_transactions
    op.add_column('bill_transactions',
        sa.Column('delivery_status', sa.String(20), nullable=True)
    )
    op.add_column('bill_transactions',
        sa.Column('delivery_verified_at', sa.DateTime(), nullable=True)
    )
    op.add_column('bill_transactions',
        sa.Column('delivery_message', sa.Text(), nullable=True)
    )
    op.add_column('bill_transactions',
        sa.Column('updated_at', sa.DateTime(), nullable=True)
    )
    op.execute(
        "UPDATE bill_transactions SET updated_at = created_at WHERE updated_at IS NULL"
    )

    # Create bill_disputes table
    op.create_table(
        'bill_disputes',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.BigInteger(), nullable=False, index=True),
        sa.Column('transaction_id', sa.BigInteger(), nullable=False, index=True),
        sa.Column('transaction_reference', sa.String(100), nullable=False),
        sa.Column('reason', sa.Text(), nullable=False),
        sa.Column('status', sa.String(20), server_default='open', nullable=False, index=True),
        sa.Column('amount_refunded', sa.BigInteger(), nullable=True),
        sa.Column('auto_refund_at', sa.DateTime(), nullable=True, index=True),
        sa.Column('refunded_at', sa.DateTime(), nullable=True),
        sa.Column('resolved_by', sa.BigInteger(), nullable=True),
        sa.Column('resolution_note', sa.Text(), nullable=True),
        sa.Column('resolved_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )

    # Create scheduled_bills table
    op.create_table(
        'scheduled_bills',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.BigInteger(), nullable=False, index=True),
        sa.Column('service', sa.String(50), nullable=False),
        sa.Column('phone', sa.String(20), nullable=False),
        sa.Column('network', sa.String(20), nullable=False),
        sa.Column('amount_naira', sa.Integer(), nullable=False),
        sa.Column('plan_code', sa.String(100), nullable=True),
        sa.Column('schedule_type', sa.String(20), nullable=False),
        sa.Column('next_run_at', sa.DateTime(), nullable=False, index=True),
        sa.Column('last_run_at', sa.DateTime(), nullable=True),
        sa.Column('status', sa.String(20), server_default='active', nullable=False, index=True),
        sa.Column('execution_count', sa.Integer(), server_default='0', nullable=False),
        sa.Column('last_error', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    op.drop_table('scheduled_bills')
    op.drop_table('bill_disputes')

    op.drop_column('bill_transactions', 'updated_at')
    op.drop_column('bill_transactions', 'delivery_message')
    op.drop_column('bill_transactions', 'delivery_verified_at')
    op.drop_column('bill_transactions', 'delivery_status')
