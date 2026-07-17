"""Add ad monitoring tables for SSV logs and fill rate tracking.

Revision ID: 021_ad_monitoring
Revises: 020_openstax_sentinels_version
Create Date: 2026-07-16 00:00:00.000000

Why:
  - ad_ssv_logs: Track ALL AdMob SSV callback attempts (success + failures)
    for admin monitoring, debugging signature failures, and detecting patterns.
  - ad_fill_rate_events: Track ad lifecycle (requested → loaded → shown →
    completed → failed) to calculate fill rates and identify SDK issues.
  - Add index on ad_events.created_at for faster time-based queries in admin
    analytics (eCPM trending, daily totals).
"""

from typing import Sequence, Union
from alembic import op

revision: str = "021_ad_monitoring"
down_revision: Union[str, None] = "020_openstax_sentinels_version"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── ad_ssv_logs ───────────────────────────────────────────────────
    op.execute("""
        CREATE TABLE ad_ssv_logs (
            id SERIAL PRIMARY KEY,
            user_id BIGINT,
            token VARCHAR(64),
            transaction_id VARCHAR(255),
            ad_unit VARCHAR(100),
            status VARCHAR(50) NOT NULL,
            rejection_reason TEXT,
            raw_query_params JSON,
            points_credited INTEGER,
            created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC') NOT NULL
        )
    """)
    
    op.execute("CREATE INDEX ix_ad_ssv_logs_user_id ON ad_ssv_logs (user_id)")
    op.execute("CREATE INDEX ix_ad_ssv_logs_token ON ad_ssv_logs (token)")
    op.execute("CREATE INDEX ix_ad_ssv_logs_status ON ad_ssv_logs (status)")
    op.execute("CREATE INDEX ix_ad_ssv_logs_created_at ON ad_ssv_logs (created_at)")
    
    # ── ad_fill_rate_events ───────────────────────────────────────────
    op.execute("""
        CREATE TABLE ad_fill_rate_events (
            id SERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL,
            session_id BIGINT,
            ad_request_id VARCHAR(64) NOT NULL,
            ad_unit VARCHAR(100) NOT NULL,
            stage VARCHAR(20) NOT NULL,
            error_code VARCHAR(50),
            error_message TEXT,
            created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC') NOT NULL
        )
    """)
    
    op.execute("CREATE INDEX ix_ad_fill_rate_events_user_id ON ad_fill_rate_events (user_id)")
    op.execute("CREATE INDEX ix_ad_fill_rate_events_ad_request_id ON ad_fill_rate_events (ad_request_id)")
    op.execute("CREATE INDEX ix_ad_fill_rate_events_ad_unit ON ad_fill_rate_events (ad_unit)")
    op.execute("CREATE INDEX ix_ad_fill_rate_events_stage ON ad_fill_rate_events (stage)")
    op.execute("CREATE INDEX ix_ad_fill_rate_events_created_at ON ad_fill_rate_events (created_at)")
    
    # ── Add index on ad_events.created_at ─────────────────────────────
    op.execute("CREATE INDEX IF NOT EXISTS ix_ad_events_created_at ON ad_events (created_at)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_ad_events_created_at")
    op.execute("DROP TABLE IF EXISTS ad_fill_rate_events")
    op.execute("DROP TABLE IF EXISTS ad_ssv_logs")
