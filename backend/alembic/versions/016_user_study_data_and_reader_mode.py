"""Add users.study_data JSON blob and reading_progress.reader_mode for the v3
Study + 3-mode reader.

Revision ID: 016_study_reader_mode
Revises: 015_add_content_class_level
Create Date: 2026-07-13 22:30:00.000000

Schema additions:
  users:
    + study_data   JSON          NULL  DEFAULT '{}'

  reading_progress:
    + reader_mode  VARCHAR(16)   NOT NULL DEFAULT 'read'
       CHECK (reader_mode IN ('read','study','listen'))

Why these two ship together:
  - `study_data` is the v3 §3.2 highlights + notes blob. The 3-mode reader
    switcher (v3 §3.4) needs to remember which mode the user picked per
    work; that's the `reader_mode` column on `reading_progress`. They
    share the migration because they ship in the same product slice
    (Study mode).
  - The blob is intentionally a JSON column, not a normalized
    highlights + notes table. Per v3 §1.5 the "fetch directly" rule
    applies to per-user data that is never queried across users. A
    single JSON blob saves a JOIN on every reader load and lets the
    client batch syncs every ~10s. If we ever need cross-user analytics
    (e.g. "most-highlighted paragraph in this book") we add a
    materialized view later — at one write per highlight the raw
    table is the wrong shape.
  - `study_data` is nullable with a server-side default of `{}` so old
    rows read as the empty blob. Existing code that doesn't know
    about the column keeps working because the default is harmless.
  - `reader_mode` is NOT NULL with a server-side default of `'read'`
    so every existing row reads as the default mode. The CHECK
    constraint is a server-side guard against typos; the client and
    Pydantic schemas also enforce it.
  - No index on `study_data` (it's per-user, queried by PK lookup) or
    on `reader_mode` (same — per-user, queried as part of the
    reading_progress lookup). Adding indexes here would be cargo
    culting; the catalog/feed queries that need them are filtered
    by user_id first, which already hits the existing index.
  - Idempotent: ADD COLUMN IF NOT EXISTS / ALTER TABLE … ADD
    CONSTRAINT IF NOT EXISTS, matching the style of migrations 014
    and 015 so a partial re-run is harmless. PostgreSQL 9.6+ supports
    `ADD COLUMN IF NOT EXISTS` natively; for the CHECK constraint we
    wrap in a DO block so re-runs don't error on duplicate.
"""

from typing import Sequence, Union
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "016_study_reader_mode"
down_revision: Union[str, None] = "015_add_content_class_level"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── users.study_data ─────────────────────────────────────────────
    # JSON (not JSONB) on purpose: v3 §1.5 stores opaque per-user
    # state that is never queried, only fetched whole. JSONB's
    # extra GIN indexing and binary storage would be wasted here.
    op.execute("""
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS study_data JSON NULL
    """)
    op.execute("""
        ALTER TABLE users
        ALTER COLUMN study_data SET DEFAULT '{}'::json
    """)

    # ── reading_progress.reader_mode ─────────────────────────────────
    op.execute("""
        ALTER TABLE reading_progress
        ADD COLUMN IF NOT EXISTS reader_mode VARCHAR(16) NOT NULL DEFAULT 'read'
    """)
    # CHECK constraint. Wrap in DO block so a re-run doesn't trip on
    # "constraint already exists". DO blocks ignore DDL errors at
    # parse time, so we can't use IF NOT EXISTS directly on the
    # constraint; we silence the duplicate-object error instead.
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'reading_progress_reader_mode_check'
            ) THEN
                ALTER TABLE reading_progress
                ADD CONSTRAINT reading_progress_reader_mode_check
                CHECK (reader_mode IN ('read','study','listen'));
            END IF;
        END $$;
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE reading_progress
        DROP CONSTRAINT IF EXISTS reading_progress_reader_mode_check
    """)
    op.execute("""
        ALTER TABLE reading_progress
        DROP COLUMN IF EXISTS reader_mode
    """)
    op.execute("""
        ALTER TABLE users
        DROP COLUMN IF EXISTS study_data
    """)
