"""Move sponsor and profile fields from BillTransaction to User

Revision ID: 006_move_sponsor_fields_to_user
Revises: 005_notification_preferences
Create Date: 2026-07-06 23:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


revision: str = '006_move_sponsor_fields_to_user'
down_revision: Union[str, None] = '005_notification_preferences'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


USERS_COLUMNS = [
    ('failed_login_attempts', sa.Integer(), False, '0'),
    ('locked_until', sa.DateTime(), True, None),
    ('email_verified', sa.Boolean(), False, 'FALSE'),
    ('email_verification_token', sa.String(255), True, None),
    ('email_verification_expires_at', sa.DateTime(), True, None),
    ('last_login_at', sa.DateTime(), True, None),
    ('last_login_ip', sa.String(45), True, None),
    ('last_login_user_agent', sa.String(255), True, None),
    ('device_fingerprint', sa.String(255), True, None),
    ('is_worker', sa.Boolean(), False, 'TRUE'),
    ('is_sponsor', sa.Boolean(), False, 'FALSE'),
    ('sponsor_wallet_balance', sa.BigInteger(), False, '0'),
    ('sponsor_verified', sa.Boolean(), False, 'FALSE'),
    ('sponsor_kyc_status', sa.String(20), False, 'none'),
    ('sponsor_kyc_submitted_at', sa.DateTime(), True, None),
    ('sponsor_kyc_reviewed_at', sa.DateTime(), True, None),
    ('sponsor_kyc_reviewer_id', sa.BigInteger(), True, None),
    ('business_name', sa.String(255), True, None),
    ('business_registration_number', sa.String(100), True, None),
    ('sponsor_auto_approve_ai', sa.Boolean(), False, 'FALSE'),
    ('gender', sa.String(20), True, None),
    ('date_of_birth', sa.DateTime(), True, None),
    ('city', sa.String(100), True, None),
    ('country', sa.String(50), False, 'Nigeria'),
    ('languages', sa.Text(), True, None),
]

BILL_COLUMNS = [
    'is_worker', 'is_sponsor', 'sponsor_wallet_balance', 'sponsor_verified',
    'sponsor_kyc_status', 'sponsor_kyc_submitted_at', 'sponsor_kyc_reviewed_at',
    'sponsor_kyc_reviewer_id', 'business_name', 'business_registration_number',
    'sponsor_auto_approve_ai', 'gender', 'date_of_birth', 'city', 'country', 'languages',
]


def _column_exists(table_name: str, column_name: str) -> bool:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    return any(c['name'] == column_name for c in inspector.get_columns(table_name))


def upgrade() -> None:
    conn = op.get_bind()

    with op.batch_alter_table('users') as batch_op:
        for name, coltype, nullable, default in USERS_COLUMNS:
            if not _column_exists('users', name):
                if nullable:
                    batch_op.add_column(sa.Column(name, coltype, nullable=True))
                else:
                    batch_op.add_column(sa.Column(name, coltype, nullable=False, server_default=sa.text(default)))

    # Migrate data from bill_transactions to users (only if source columns still exist)
    existing_bill_cols = []
    if _column_exists('bill_transactions', 'is_worker'):
        inspector = sa.inspect(conn)
        existing_bill_cols = [c['name'] for c in inspector.get_columns('bill_transactions')]

    if 'is_worker' in existing_bill_cols:
        conn.execute(text("""
            UPDATE users u
            JOIN (
                SELECT user_id, MAX(created_at) as max_created
                FROM bill_transactions
                GROUP BY user_id
            ) latest ON u.id = latest.user_id
            JOIN bill_transactions bt ON bt.user_id = latest.user_id AND bt.created_at = latest.max_created
            SET
                u.is_worker = COALESCE(bt.is_worker, TRUE),
                u.is_sponsor = COALESCE(bt.is_sponsor, FALSE),
                u.sponsor_wallet_balance = COALESCE(bt.sponsor_wallet_balance, 0),
                u.sponsor_verified = COALESCE(bt.sponsor_verified, FALSE),
                u.sponsor_kyc_status = COALESCE(bt.sponsor_kyc_status, 'none'),
                u.sponsor_kyc_submitted_at = bt.sponsor_kyc_submitted_at,
                u.sponsor_kyc_reviewed_at = bt.sponsor_kyc_reviewed_at,
                u.sponsor_kyc_reviewer_id = bt.sponsor_kyc_reviewer_id,
                u.business_name = bt.business_name,
                u.business_registration_number = bt.business_registration_number,
                u.sponsor_auto_approve_ai = COALESCE(bt.sponsor_auto_approve_ai, FALSE),
                u.gender = bt.gender,
                u.date_of_birth = bt.date_of_birth,
                u.city = bt.city,
                u.country = COALESCE(bt.country, 'Nigeria'),
                u.languages = bt.languages
        """))

    # Drop columns from bill_transactions if they still exist
    with op.batch_alter_table('bill_transactions') as batch_op:
        for col in BILL_COLUMNS:
            if _column_exists('bill_transactions', col):
                batch_op.drop_column(col)

    # Create indexes for new columns (idempotent)
    if not _column_exists('users', 'device_fingerprint'):
        op.create_index('ix_users_device_fingerprint', 'users', ['device_fingerprint'])
    if not _column_exists('users', 'email_verified'):
        op.create_index('ix_users_email_verified', 'users', ['email_verified'])


def downgrade() -> None:
    # Add columns back to bill_transactions
    defaults = {
        'is_worker': (sa.Boolean(), False, sa.text('TRUE')),
        'is_sponsor': (sa.Boolean(), False, sa.text('FALSE')),
        'sponsor_wallet_balance': (sa.BigInteger(), False, '0'),
        'sponsor_verified': (sa.Boolean(), False, sa.text('FALSE')),
        'sponsor_kyc_status': (sa.String(20), False, 'none'),
        'sponsor_kyc_submitted_at': (sa.DateTime(), True, None),
        'sponsor_kyc_reviewed_at': (sa.DateTime(), True, None),
        'sponsor_kyc_reviewer_id': (sa.BigInteger(), True, None),
        'business_name': (sa.String(255), True, None),
        'business_registration_number': (sa.String(100), True, None),
        'sponsor_auto_approve_ai': (sa.Boolean(), False, sa.text('FALSE')),
        'gender': (sa.String(20), True, None),
        'date_of_birth': (sa.DateTime(), True, None),
        'city': (sa.String(100), True, None),
        'country': (sa.String(50), False, 'Nigeria'),
        'languages': (sa.Text(), True, None),
    }

    with op.batch_alter_table('bill_transactions') as batch_op:
        for name, (coltype, nullable, default) in defaults.items():
            if not _column_exists('bill_transactions', name):
                if nullable:
                    batch_op.add_column(sa.Column(name, coltype, nullable=True))
                else:
                    batch_op.add_column(sa.Column(name, coltype, nullable=False, server_default=default))

    # Drop new columns from users
    users_cols = [
        'failed_login_attempts', 'locked_until', 'email_verified',
        'email_verification_token', 'email_verification_expires_at',
        'last_login_at', 'last_login_ip', 'last_login_user_agent',
        'device_fingerprint', 'is_worker', 'is_sponsor',
        'sponsor_wallet_balance', 'sponsor_verified', 'sponsor_kyc_status',
        'sponsor_kyc_submitted_at', 'sponsor_kyc_reviewed_at',
        'sponsor_kyc_reviewer_id', 'business_name',
        'business_registration_number', 'sponsor_auto_approve_ai',
        'gender', 'date_of_birth', 'city', 'country', 'languages',
    ]
    with op.batch_alter_table('users') as batch_op:
        for col in users_cols:
            if _column_exists('users', col):
                batch_op.drop_column(col)

    if _column_exists('users', 'device_fingerprint'):
        op.drop_index('ix_users_device_fingerprint', table_name='users')
    if _column_exists('users', 'email_verified'):
        op.drop_index('ix_users_email_verified', table_name='users')
