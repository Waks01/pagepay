"""Add user_audit_logs table

Revision ID: 007_add_user_audit_logs
Revises: 006_move_sponsor_fields_to_user
Create Date: 2026-07-07 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = '007_add_user_audit_logs'
down_revision: Union[str, None] = '006_move_sponsor_fields_to_user'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'user_audit_logs' not in inspector.get_table_names():
        op.create_table(
            'user_audit_logs',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('action', sa.String(length=50), nullable=False),
            sa.Column('ip_address', sa.String(length=45), nullable=True),
            sa.Column('user_agent', sa.String(length=255), nullable=True),
            sa.Column('device_fingerprint', sa.String(length=255), nullable=True),
            sa.Column('extra_data', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint('id')
        )
        op.create_index('ix_user_audit_logs_user_id', 'user_audit_logs', ['user_id'])
        op.create_index('ix_user_audit_logs_action', 'user_audit_logs', ['action'])
        op.create_index('ix_user_audit_logs_created_at', 'user_audit_logs', ['created_at'])
        op.create_index('ix_user_audit_logs_device_fingerprint', 'user_audit_logs', ['device_fingerprint'])


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'user_audit_logs' in inspector.get_table_names():
        op.drop_index('ix_user_audit_logs_device_fingerprint', table_name='user_audit_logs')
        op.drop_index('ix_user_audit_logs_created_at', table_name='user_audit_logs')
        op.drop_index('ix_user_audit_logs_action', table_name='user_audit_logs')
        op.drop_index('ix_user_audit_logs_user_id', table_name='user_audit_logs')
        op.drop_table('user_audit_logs')
