"""Add notification preferences and FCM tokens

Revision ID: 005_notification_preferences
Revises: 004_ad_requests
Create Date: 2026-07-06 20:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '005_notification_preferences'
down_revision: Union[str, None] = '004_ad_requests'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    if 'user_notification_preferences' not in existing_tables:
        op.create_table(
            'user_notification_preferences',
            sa.Column('user_id', sa.BigInteger(), nullable=False),
            sa.Column('push_enabled', sa.Boolean(), nullable=False, server_default=sa.text('TRUE')),
            sa.Column('study_reminders', sa.Boolean(), nullable=False, server_default=sa.text('TRUE')),
            sa.Column('task_alerts', sa.Boolean(), nullable=False, server_default=sa.text('TRUE')),
            sa.Column('referral_bonuses', sa.Boolean(), nullable=False, server_default=sa.text('TRUE')),
            sa.Column('wallet_updates', sa.Boolean(), nullable=False, server_default=sa.text('TRUE')),
            sa.Column('ad_rewards', sa.Boolean(), nullable=False, server_default=sa.text('TRUE')),
            sa.Column('quiet_hours_start', sa.Time(), nullable=True),
            sa.Column('quiet_hours_end', sa.Time(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
            sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
            sa.PrimaryKeyConstraint('user_id'),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE')
        )
        op.create_index(op.f('ix_notif_prefs_user_id'), 'user_notification_preferences', ['user_id'], unique=False)

    if 'fcm_tokens' not in existing_tables:
        op.create_table(
            'fcm_tokens',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('user_id', sa.BigInteger(), nullable=False),
            sa.Column('token', sa.String(length=255), nullable=False),
            sa.Column('platform', sa.String(length=20), nullable=False),
            sa.Column('device_id', sa.String(length=255), nullable=True),
            sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('TRUE')),
            sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
            sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
            sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_fcm_tokens_user_id'), 'fcm_tokens', ['user_id'], unique=False)
        op.create_index(op.f('ix_fcm_tokens_token'), 'fcm_tokens', ['token'], unique=True)
        op.create_index(op.f('ix_fcm_tokens_is_active'), 'fcm_tokens', ['is_active'], unique=False)
        op.create_foreign_key('fk_fcm_tokens_user_id', 'fcm_tokens', 'users', ['user_id'], ['id'], ondelete='CASCADE')


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    if 'fcm_tokens' in existing_tables:
        op.drop_constraint('fk_fcm_tokens_user_id', 'fcm_tokens', type_='foreignkey')
        op.drop_index(op.f('ix_fcm_tokens_is_active'), table_name='fcm_tokens')
        op.drop_index(op.f('ix_fcm_tokens_token'), table_name='fcm_tokens')
        op.drop_index(op.f('ix_fcm_tokens_user_id'), table_name='fcm_tokens')
        op.drop_table('fcm_tokens')

    if 'user_notification_preferences' in existing_tables:
        op.drop_index(op.f('ix_notif_prefs_user_id'), table_name='user_notification_preferences')
        op.drop_table('user_notification_preferences')
