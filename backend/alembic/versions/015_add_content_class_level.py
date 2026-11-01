"""Add content_catalog.class_level for the Grade 1-12 + Year 1-4 filter.

Revision ID: 015_add_content_class_level
Revises: 014_openstax_social
Create Date: 2026-07-13 08:25:00.000000

Schema additions:
  content_catalog:
    + class_level  VARCHAR(32)  NULL  (Grade 1 .. Grade 12 | Year 1 .. Year 4)

Why this migration is one column + one index, not more:
  - The class-level vocabulary (Grade 1-12 / Year 1-4) is the
    *primary* filter inside an education_level bucket. It's the
    answer to "I need a Grade 10 Physics book" — `education_level`
    narrows to "secondary", `class_level` narrows further to
    "Grade 10", and `subject` lands on "physics".
  - Nullable on every existing row (gutendex novels have no
    grade, gnews articles have no grade). No backfill needed.
  - The index is on the column itself, not on a composite — the
    catalog filter is always paired with `source`/`subject` in
    the WHERE clause, but PostgreSQL's planner can bitmap-AND
    the single-column indexes cheaply, and the simpler index
    name keeps the catalog migration self-contained.
  - Future country/region scoping (JSS1-SS3 in Nigeria, Key Stage
    3 in the UK) goes on the same column — see
    books/design-plan-v3.md §1.2 / §8 Q1. We intentionally did
    NOT add a `country_code` or `region_code` column; the value
    space on class_level is what changes, not the schema.
  - Idempotent: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT
    EXISTS, matching the style of migration 014 so a partial
    re-run is harmless.
"""

from typing import Sequence, Union
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "015_add_content_class_level"
down_revision: Union[str, None] = "014_openstax_social"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── content_catalog.class_level ──────────────────────────────────
    op.execute("""
        ALTER TABLE content_catalog
        ADD COLUMN IF NOT EXISTS class_level VARCHAR(32) NULL
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_content_catalog_class_level
        ON content_catalog (class_level)
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_content_catalog_class_level")
    op.execute("ALTER TABLE content_catalog DROP COLUMN IF EXISTS class_level")
