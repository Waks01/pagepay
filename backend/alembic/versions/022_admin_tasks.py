"""Add admin task system columns

Revision ID: 022_admin_tasks
Revises: 021_ad_monitoring_tables
Create Date: 2026-07-18 03:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision: str = '022_admin_tasks'
down_revision: Union[str, None] = '021_ad_monitoring_tables'
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
    # Add task_source column to tasks table
    if not _column_exists("tasks", "task_source"):
        op.add_column('tasks', sa.Column('task_source', sa.String(length=20), nullable=False, server_default='sponsored'))
    
    # Add reward_type column to tasks table
    if not _column_exists("tasks", "reward_type"):
        op.add_column('tasks', sa.Column('reward_type', sa.String(length=20), nullable=False, server_default='cash'))
    
    # Add category column to tasks table
    if not _column_exists("tasks", "category"):
        op.add_column('tasks', sa.Column('category', sa.String(length=50), nullable=False, server_default='social_media'))


def downgrade() -> None:
    # Remove columns added in upgrade
    if _column_exists("tasks", "category"):
        op.drop_column('tasks', 'category')
    if _column_exists("tasks", "reward_type"):
        op.drop_column('tasks', 'reward_type')
    if _column_exists("tasks", "task_source"):
        op.drop_column('tasks', 'task_source')
