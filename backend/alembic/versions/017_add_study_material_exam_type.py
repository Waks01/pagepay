"""Add study_materials.exam_type for exam-prep categorization.

Revision ID: 017_add_study_material_exam_type
Revises: 017_content_body_sentinels_version
Create Date: 2026-07-14 17:59:00.000000

Schema additions:
  study_materials:
    + exam_type  VARCHAR(32)  NULL  (jamb|waec|neco|nabteb|custom)

Why:
  - Lets users tag materials by exam type so the study tab can filter
    by JAMB/WAEC/NECO/NABTEB and the Exam Mode screen can surface
    only relevant materials for a selected exam.
  - Nullable so existing rows are unaffected.
  - No CHECK constraint yet — the frontend allowlist is the source of
    truth for now. If we need server-side enforcement later, add a
    CHECK in a follow-up migration.
"""

from typing import Sequence, Union
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "017_add_study_material_exam_type"
down_revision: Union[str, None] = "017_body_sentinels"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE study_materials
        ADD COLUMN IF NOT EXISTS exam_type VARCHAR(32) NULL
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE study_materials
        DROP COLUMN IF EXISTS exam_type
    """)
