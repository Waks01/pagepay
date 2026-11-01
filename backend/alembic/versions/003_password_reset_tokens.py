"""Add password reset tokens table

Revision ID: 003_password_reset_tokens
Revises: 002_referral_daily_caps
Create Date: 2026-07-03 19:30:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '003_password_reset_tokens'
down_revision: Union[str, None] = '002_referral_daily_caps'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'password_reset_tokens' not in inspector.get_table_names():
        op.create_table(
            'password_reset_tokens',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('user_id', sa.BigInteger(), nullable=False),
            sa.Column('token_hash', sa.String(length=255), nullable=False),
            sa.Column('expires_at', sa.DateTime(), nullable=False),
            sa.Column('used_at', sa.DateTime(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
            sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_password_reset_tokens_user_id'), 'password_reset_tokens', ['user_id'], unique=False)
        op.create_index(op.f('ix_password_reset_tokens_token_hash'), 'password_reset_tokens', ['token_hash'], unique=True)


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'password_reset_tokens' in inspector.get_table_names():
        op.drop_index(op.f('ix_password_reset_tokens_token_hash'), table_name='password_reset_tokens')
        op.drop_index(op.f('ix_password_reset_tokens_user_id'), table_name='password_reset_tokens')
        op.drop_table('password_reset_tokens')
