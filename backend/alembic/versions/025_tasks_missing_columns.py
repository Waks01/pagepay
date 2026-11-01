"""Add missing tasks columns to match the model

The `tasks` table on production is missing four columns that the SQLAlchemy
model declares and that admin_tasks.py (and other routers) select:

    task_source      String(20)  default 'sponsored'
    category         String(50)  default 'social_media'
    reward_type      String(20)  default 'cash'
    reward_multiplier Float       default 1.0

Migration 022_admin_tasks added the first three — but it never ran on the
production DB (likely because migration 021's chain wasn't completed at
the time). `reward_multiplier` wasn't in any migration at all. This
revision adds all four so the admin/list and submissions/flagged queries
stop 500-ing with "column does not exist".

Revision ID: 025_tasks_missing_columns
Revises: 024_rename_payment_metadata
Create Date: 2026-07-28 22:55:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision: str = '025_tasks_missing_columns'
down_revision: Union[str, None] = '024_rename_payment_metadata'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table_name: str, column_name: str) -> bool:
    """Check if a column exists in a table."""
    conn = op.get_bind()
    result = conn.execute(text(
        "SELECT COUNT(*) FROM information_schema.columns "
        "WHERE table_schema = 'public' AND table_name = :tname AND column_name = :cname"
    ), {"tname": table_name, "cname": column_name})
    return result.scalar() > 0


def upgrade() -> None:
    # Add the three columns that 022_admin_tasks was supposed to add.
    # Idempotent: skip if any column already exists (in case 022 did run
    # on a different replica / dev DB).
    if not _column_exists("tasks", "task_source"):
        op.add_column(
            'tasks',
            sa.Column(
                'task_source',
                sa.String(length=20),
                nullable=False,
                server_default='sponsored',
            ),
        )
        op.create_index(
            op.f('ix_tasks_task_source'), 'tasks', ['task_source'], unique=False,
        )

    if not _column_exists("tasks", "category"):
        op.add_column(
            'tasks',
            sa.Column(
                'category',
                sa.String(length=50),
                nullable=False,
                server_default='social_media',
            ),
        )
        op.create_index(
            op.f('ix_tasks_category'), 'tasks', ['category'], unique=False,
        )

    if not _column_exists("tasks", "reward_type"):
        op.add_column(
            'tasks',
            sa.Column(
                'reward_type',
                sa.String(length=20),
                nullable=False,
                server_default='cash',
            ),
        )
        op.create_index(
            op.f('ix_tasks_reward_type'), 'tasks', ['reward_type'], unique=False,
        )

    # reward_multiplier was never in any migration. Float column with
    # default 1.0 to match the model. No index — it's only read in the
    # admin/approve path, not used for filtering.
    if not _column_exists("tasks", "reward_multiplier"):
        op.add_column(
            'tasks',
            sa.Column(
                'reward_multiplier',
                sa.Float(),
                nullable=False,
                server_default='1.0',
            ),
        )


def downgrade() -> None:
    if _column_exists("tasks", "reward_multiplier"):
        op.drop_column('tasks', 'reward_multiplier')
    if _column_exists("tasks", "reward_type"):
        op.drop_index(op.f('ix_tasks_reward_type'), table_name='tasks')
        op.drop_column('tasks', 'reward_type')
    if _column_exists("tasks", "category"):
        op.drop_index(op.f('ix_tasks_category'), table_name='tasks')
        op.drop_column('tasks', 'category')
    if _column_exists("tasks", "task_source"):
        op.drop_index(op.f('ix_tasks_task_source'), table_name='tasks')
        op.drop_column('tasks', 'task_source')
