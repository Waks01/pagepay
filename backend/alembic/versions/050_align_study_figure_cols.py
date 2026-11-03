"""Align production schema with local models: add missing study_materials and study_figures columns.

Revision ID: 050_align_study_figure_cols
Revises: 049_add_exam_audio_cols
Create Date: 2026-11-03
"""
from typing import Sequence, Union

from alembic import op


revision: str = "050_align_study_figure_cols"
down_revision: Union[str, None] = "049_add_exam_audio_cols"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE study_materials ADD COLUMN IF NOT EXISTS figure_count INTEGER NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE study_materials ADD COLUMN IF NOT EXISTS page_count INTEGER NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE study_figures ADD COLUMN IF NOT EXISTS page_number INTEGER NOT NULL DEFAULT 1")
    op.execute("ALTER TABLE study_figures ADD COLUMN IF NOT EXISTS image_data BYTEA")
    op.execute("ALTER TABLE study_figures ADD COLUMN IF NOT EXISTS image_mime_type VARCHAR(50) NOT NULL DEFAULT 'image/png'")


def downgrade() -> None:
    op.execute("ALTER TABLE study_figures DROP COLUMN IF EXISTS image_mime_type")
    op.execute("ALTER TABLE study_figures DROP COLUMN IF EXISTS image_data")
    op.execute("ALTER TABLE study_figures DROP COLUMN IF EXISTS page_number")
    op.execute("ALTER TABLE study_materials DROP COLUMN IF EXISTS page_count")
    op.execute("ALTER TABLE study_materials DROP COLUMN IF EXISTS figure_count")
