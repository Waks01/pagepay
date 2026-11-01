"""fix_pending_points_nulls

Revision ID: 3f02971605b1
Revises: 019_add_sess_id_ads
Create Date: 2026-07-15 10:42:16.641036

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '3f02971605b1'
down_revision: Union[str, None] = '019_add_sess_id_ads'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Fill existing NULLs with 0 so we can set NOT NULL
    op.execute("UPDATE reading_sessions SET pending_points = 0 WHERE pending_points IS NULL")
    # 2. Set NOT NULL and add server default
    op.alter_column('reading_sessions', 'pending_points',
                    nullable=False,
                    server_default='0')


def downgrade() -> None:
    # Revert to nullable with no server default
    op.alter_column('reading_sessions', 'pending_points',
                    nullable=True,
                    server_default=None)
