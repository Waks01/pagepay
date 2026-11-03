"""Page and figure artifacts for uploaded study materials.

Revision ID: 047_study_page_artifacts
Revises: 046_sow_job_progress
Create Date: 2026-10-20 00:00:00.000000

Schema additions:
  study_materials:
    + explanation_structure  TEXT NULL — the teaching layer: the
      material rewritten in plain language for a beginner, with the
      diagrams described in words. Separate from parsed_structure,
      which stays faithful to the source.
    + education_level  VARCHAR(20) NOT NULL DEFAULT 'primary' — the
      depth the explanation and the narration are written at.
  study_pages (new):
    One row per rendered page of an uploaded document. Holds the
    object-storage key of the full-fidelity page image so the app can
    show the student exactly what they uploaded, at any zoom.
  study_figures (new):
    One row per diagram-like region cropped out of a page, with the
    vision model's plain-language description of what it shows.

Why:
  - The OCR prompt only ever asked for text, so a diagram was reduced
    to a bag of floating labels and the picture itself was thrown away.
    A student uploading a textbook page wants their diagram.
  - `parsed_structure` is deliberately faithful to the source, so it
    can never carry the beginner-friendly explanation. That needs its
    own column, and the quiz generator, the tutor and the narration
    need to read it instead of the raw OCR.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "047_study_page_artifacts"
down_revision: Union[str, None] = "046_sow_job_progress"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE study_materials
        ADD COLUMN IF NOT EXISTS explanation_structure TEXT NULL
    """)
    op.execute("""
        ALTER TABLE study_materials
        ADD COLUMN IF NOT EXISTS education_level VARCHAR(20) NOT NULL DEFAULT 'primary'
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS study_pages (
            id SERIAL PRIMARY KEY,
            material_id INTEGER NOT NULL,
            page INTEGER NOT NULL DEFAULT 1,
            width INTEGER NOT NULL DEFAULT 0,
            height INTEGER NOT NULL DEFAULT 0,
            image_key VARCHAR(500) NULL,
            image_url VARCHAR(1000) NULL,
            is_scan BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_study_page_material_page
        ON study_pages (material_id, page)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_study_pages_material_id
        ON study_pages (material_id)
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS study_figures (
            id SERIAL PRIMARY KEY,
            material_id INTEGER NOT NULL,
            page INTEGER NOT NULL DEFAULT 1,
            figure_index INTEGER NOT NULL DEFAULT 1,
            bbox TEXT NULL,
            width INTEGER NOT NULL DEFAULT 0,
            height INTEGER NOT NULL DEFAULT 0,
            image_key VARCHAR(500) NULL,
            image_url VARCHAR(1000) NULL,
            description TEXT NULL,
            caption VARCHAR(500) NULL,
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_study_figure_material_index
        ON study_figures (material_id, figure_index)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_study_figures_material_id
        ON study_figures (material_id)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS study_figures")
    op.execute("DROP TABLE IF EXISTS study_pages")
    op.execute("""
        ALTER TABLE study_materials
        DROP COLUMN IF EXISTS education_level
    """)
    op.execute("""
        ALTER TABLE study_materials
        DROP COLUMN IF EXISTS explanation_structure
    """)
