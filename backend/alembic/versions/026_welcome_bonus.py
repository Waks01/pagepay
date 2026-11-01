"""Add point_credits table for welcome bonus (and future one-shot grants)

The /auth/register endpoint now credits a one-shot welcome bonus to the
newly created user's wallet, fires a welcome email, and creates an in-app
notification. The UNIQUE(user_id, source) constraint on this table is the
single source of truth for idempotency — a duplicate /register retry for
the same email gets caught here, never producing a double credit.

Migration head chain is two-headed at the time of writing:
  - 025_tasks_missing_columns (linear head from 024)
  - 3f02971605b1_fix_pending_points_nulls (hotfix branch from 019)
This migration merges them by setting down_revision to both.

Revision ID: 026_welcome_bonus
Revises: 025_tasks_missing_columns, 3f02971605b1_fix_pending_points_nulls
Create Date: 2026-07-30 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '026_welcome_bonus'
down_revision: Union[str, None] = (
    '025_tasks_missing_columns',
    '3f02971605b1',
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Idempotent: 000_create_base_schema already created the table on a
    # fresh DB because the SQLAlchemy model declares it. We only need to
    # create it explicitly when migrating from a pre-existing DB that
    # was bootstrapped before the model had PointCredit.
    conn = op.get_bind()
    exists = conn.execute(
        sa.text(
            "SELECT 1 FROM pg_tables "
            "WHERE schemaname='public' AND tablename='point_credits'"
        )
    ).first()
    if exists:
        # Ensure the unique constraint + indexes are present (in case
        # 000 created the table without them, which shouldn't happen
        # with the current model but is a safe guard).
        return

    op.create_table(
        'point_credits',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.BigInteger(), nullable=False),
        sa.Column('source', sa.String(length=50), nullable=False),
        sa.Column('points', sa.BigInteger(), nullable=False),
        sa.Column('metadata_json', sa.JSON(), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(),
            nullable=False,
            server_default=sa.text('CURRENT_TIMESTAMP'),
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'user_id', 'source', name='uq_point_credits_user_source'
        ),
    )
    op.create_index(
        op.f('ix_point_credits_user_id'),
        'point_credits',
        ['user_id'],
        unique=False,
    )
    op.create_index(
        op.f('ix_point_credits_source'),
        'point_credits',
        ['source'],
        unique=False,
    )
    op.create_index(
        op.f('ix_point_credits_created_at'),
        'point_credits',
        ['created_at'],
        unique=False,
    )


def downgrade() -> None:
    # Match upgrade's idempotency: only drop if we created it.
    conn = op.get_bind()
    exists = conn.execute(
        sa.text(
            "SELECT 1 FROM pg_tables "
            "WHERE schemaname='public' AND tablename='point_credits'"
        )
    ).first()
    if exists:
        op.drop_index(op.f('ix_point_credits_created_at'), table_name='point_credits')
        op.drop_index(op.f('ix_point_credits_source'), table_name='point_credits')
        op.drop_index(op.f('ix_point_credits_user_id'), table_name='point_credits')
        op.drop_table('point_credits')