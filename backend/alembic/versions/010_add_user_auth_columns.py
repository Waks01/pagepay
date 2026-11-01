"""Add missing user auth columns to production users table.

Revision ID: 010_add_user_auth_columns
Revises: 009_adj_points_rate
Create Date: 2026-07-08 18:01:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '010_add_user_auth_columns'
down_revision: Union[str, None] = '009_adj_points_rate'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table_name: str, column_name: str) -> bool:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    return any(c['name'] == column_name for c in inspector.get_columns(table_name))


def upgrade() -> None:
    if not _column_exists('users', 'failed_login_attempts'):
        op.execute("ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER DEFAULT 0 NOT NULL")
    if not _column_exists('users', 'locked_until'):
        op.execute("ALTER TABLE users ADD COLUMN locked_until TIMESTAMP NULL")
    if not _column_exists('users', 'email_verified'):
        op.execute("ALTER TABLE users ADD COLUMN email_verified BOOLEAN DEFAULT FALSE NOT NULL")
    if not _column_exists('users', 'email_verification_token'):
        op.execute("ALTER TABLE users ADD COLUMN email_verification_token VARCHAR(255) NULL")
    if not _column_exists('users', 'email_verification_expires_at'):
        op.execute("ALTER TABLE users ADD COLUMN email_verification_expires_at TIMESTAMP NULL")
    if not _column_exists('users', 'last_login_at'):
        op.execute("ALTER TABLE users ADD COLUMN last_login_at TIMESTAMP NULL")
    if not _column_exists('users', 'last_login_ip'):
        op.execute("ALTER TABLE users ADD COLUMN last_login_ip VARCHAR(45) NULL")
    if not _column_exists('users', 'last_login_user_agent'):
        op.execute("ALTER TABLE users ADD COLUMN last_login_user_agent VARCHAR(255) NULL")
    if not _column_exists('users', 'device_fingerprint'):
        op.execute("ALTER TABLE users ADD COLUMN device_fingerprint VARCHAR(255) NULL")
    if not _column_exists('users', 'sponsor_kyc_status'):
        op.execute("ALTER TABLE users ADD COLUMN sponsor_kyc_status VARCHAR(20) DEFAULT 'none' NOT NULL")
    if not _column_exists('users', 'sponsor_kyc_submitted_at'):
        op.execute("ALTER TABLE users ADD COLUMN sponsor_kyc_submitted_at TIMESTAMP NULL")
    if not _column_exists('users', 'sponsor_kyc_reviewed_at'):
        op.execute("ALTER TABLE users ADD COLUMN sponsor_kyc_reviewed_at TIMESTAMP NULL")
    if not _column_exists('users', 'sponsor_kyc_reviewer_id'):
        op.execute("ALTER TABLE users ADD COLUMN sponsor_kyc_reviewer_id BIGINT NULL")
    if not _column_exists('users', 'business_name'):
        op.execute("ALTER TABLE users ADD COLUMN business_name VARCHAR(255) NULL")
    if not _column_exists('users', 'business_registration_number'):
        op.execute("ALTER TABLE users ADD COLUMN business_registration_number VARCHAR(100) NULL")
    if not _column_exists('users', 'sponsor_auto_approve_ai'):
        op.execute("ALTER TABLE users ADD COLUMN sponsor_auto_approve_ai BOOLEAN DEFAULT FALSE NOT NULL")
    if not _column_exists('users', 'gender'):
        op.execute("ALTER TABLE users ADD COLUMN gender VARCHAR(20) NULL")
    if not _column_exists('users', 'date_of_birth'):
        op.execute("ALTER TABLE users ADD COLUMN date_of_birth TIMESTAMP NULL")
    if not _column_exists('users', 'city'):
        op.execute("ALTER TABLE users ADD COLUMN city VARCHAR(100) NULL")
    if not _column_exists('users', 'country'):
        op.execute("ALTER TABLE users ADD COLUMN country VARCHAR(50) DEFAULT 'Nigeria' NOT NULL")
    if not _column_exists('users', 'languages'):
        op.execute("ALTER TABLE users ADD COLUMN languages TEXT NULL")


def downgrade() -> None:
    cols = [
        'failed_login_attempts', 'locked_until', 'email_verified',
        'email_verification_token', 'email_verification_expires_at',
        'last_login_at', 'last_login_ip', 'last_login_user_agent',
        'device_fingerprint', 'sponsor_kyc_status', 'sponsor_kyc_submitted_at',
        'sponsor_kyc_reviewed_at', 'sponsor_kyc_reviewer_id', 'business_name',
        'business_registration_number', 'sponsor_auto_approve_ai', 'gender',
        'date_of_birth', 'city', 'country', 'languages',
    ]
    for col in cols:
        if _column_exists('users', col):
            op.execute(f"ALTER TABLE users DROP COLUMN IF EXISTS {col}")