"""Add session_id to ad_requests for bundled rewards.

Revision ID: 019_add_sess_id_ads
Revises: 018_progress_resume_idx
Create Date: 2026-07-15 00:00:00.000000

Why:
  - The bundled reward system requires linking individual ad requests to
    a reading session. This allows the SSV callback to credit points to
    the ReadingSession.pending_points pool instead of the global wallet.
"""

from typing import Sequence, Union
from alembic import op

revision: str = "019_add_sess_id_ads"
down_revision: Union[str, None] = "018_progress_resume_idx"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add session_id column
    op.execute("ALTER TABLE ad_requests ADD COLUMN session_id BIGINT")
    # Add index for fast lookup during SSV callbacks
    op.execute("CREATE INDEX ix_ad_requests_session_id ON ad_requests (session_id)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_ad_requests_session_id")
    op.execute("ALTER TABLE ad_requests DROP COLUMN session_id")
