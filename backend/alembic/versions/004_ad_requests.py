"""Ad request tokens for SSV-only credit flow

Revision ID: 004_ad_requests
Revises: 003_password_reset_tokens
Create Date: 2026-07-06 12:00:00.000000

Replaces the client-driven /api/v1/ads/credit and /api/v1/ads/reward-claim
endpoints. Each row is one client request to show a rewarded ad; the SSV
callback consumes exactly one row per credit.

See backend/app/models/__init__.py:AdRequest for the lifecycle and the
security rationale.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '004_ad_requests'
down_revision: Union[str, None] = '003_password_reset_tokens'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'ad_requests' not in inspector.get_table_names():
        op.create_table(
            'ad_requests',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('token', sa.String(length=64), nullable=False),
            sa.Column('user_id', sa.BigInteger(), nullable=False),
            sa.Column('ad_unit', sa.String(length=100), nullable=False),
            sa.Column('status', sa.String(length=20), nullable=False, server_default='issued'),
            sa.Column('points_credited', sa.BigInteger(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
            sa.Column('expires_at', sa.DateTime(), nullable=False),
            sa.Column('credited_at', sa.DateTime(), nullable=True),
            sa.Column('admob_transaction_id', sa.String(length=255), nullable=True),
            sa.Column('rejection_reason', sa.String(length=100), nullable=True),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('token'),
        )
        op.create_index(op.f('ix_ad_requests_token'), 'ad_requests', ['token'], unique=True)
        op.create_index(op.f('ix_ad_requests_user_id'), 'ad_requests', ['user_id'], unique=False)
        op.create_index(op.f('ix_ad_requests_status'), 'ad_requests', ['status'], unique=False)
        op.create_index(op.f('ix_ad_requests_expires_at'), 'ad_requests', ['expires_at'], unique=False)
        op.create_index(op.f('ix_ad_requests_admob_transaction_id'), 'ad_requests', ['admob_transaction_id'], unique=False)
        op.create_index(op.f('ix_ad_requests_created_at'), 'ad_requests', ['created_at'], unique=False)


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'ad_requests' in inspector.get_table_names():
        op.drop_index(op.f('ix_ad_requests_created_at'), table_name='ad_requests')
        op.drop_index(op.f('ix_ad_requests_admob_transaction_id'), table_name='ad_requests')
        op.drop_index(op.f('ix_ad_requests_expires_at'), table_name='ad_requests')
        op.drop_index(op.f('ix_ad_requests_status'), table_name='ad_requests')
        op.drop_index(op.f('ix_ad_requests_user_id'), table_name='ad_requests')
        op.drop_index(op.f('ix_ad_requests_token'), table_name='ad_requests')
        op.drop_table('ad_requests')
