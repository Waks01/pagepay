"""merge_study_exam_and_ai_usage_logs

Revision ID: a8ebdfe5030b
Revises: 043_study_exam_schema, 046_add_ai_usage_logs_table
Create Date: 2026-11-03 13:22:10.998758

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a8ebdfe5030b'
down_revision: Union[str, None] = ('043_study_exam_schema', '046_add_ai_usage_logs_table')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
