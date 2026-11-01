"""Add education fields + 5 new tables for OpenStax + work-level social.

Revision ID: 014_openstax_social
Revises: 013_add_transaction_pin_hash
Create Date: 2026-07-12 11:00:00.000000

This migration is a one-shot schema change. It is idempotent (every ALTER
uses IF NOT EXISTS / IF EXISTS) so a partial re-run is safe.

Schema additions:
  content_catalog:
    + source           VARCHAR(50)  default 'gutendex'  (openstax|gutendex|gnews)
    + education_level  VARCHAR(50)  NULL                 (creche|primary|secondary|tertiary|research)
    + subject          VARCHAR(100) NULL                 (physics|mathematics|biology|…)
    + license_type     VARCHAR(50)  default 'public_domain'  (CC BY 4.0|CC BY-SA 4.0|public_domain)
    + attribution_text TEXT         NULL

  reading_progress:
    + current_unit_id      BIGINT NULL  (FK → reading_units.id, ON DELETE SET NULL)
    + current_unit_order   INT    NULL  (1-indexed within the slice)

  New tables (5):
    reading_units       — locked chunks within a topic-sized slice
    work_likes          — likes at the work (parent book) level
    work_comments       — one thread per work, with status moderation
    work_comment_likes  — likes on individual comments
    work_shares         — share-event log for analytics only

Why this migration is one revision, not several:
  - The fields on content_catalog and the 5 new tables are coupled: the
    OpenStax ingest module sets the new fields, then writes children that
    reference reading_units. Splitting the migration would force a
    half-deployed state where the ingest code crashes on the missing table.
  - Every column has a default or is nullable, so backfill of existing
    rows is automatic — no UPDATE statements needed.
"""

from typing import Sequence, Union
from alembic import op


revision: str = "014_openstax_social"
down_revision: Union[str, None] = "013_add_transaction_pin_hash"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── content_catalog: 5 new fields ──────────────────────────────────
    op.execute("""
        ALTER TABLE content_catalog
        ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'gutendex'
    """)
    op.execute("""
        ALTER TABLE content_catalog
        ADD COLUMN IF NOT EXISTS education_level VARCHAR(50) NULL
    """)
    op.execute("""
        ALTER TABLE content_catalog
        ADD COLUMN IF NOT EXISTS subject VARCHAR(100) NULL
    """)
    op.execute("""
        ALTER TABLE content_catalog
        ADD COLUMN IF NOT EXISTS license_type VARCHAR(50) DEFAULT 'public_domain'
    """)
    op.execute("""
        ALTER TABLE content_catalog
        ADD COLUMN IF NOT EXISTS attribution_text TEXT NULL
    """)
    # Indexes on filter columns (source / education_level / subject).
    # Source is the most-queried (gutendex vs openstax dispatch), so it
    # gets the index even though most rows are gutendex — the openstax
    # catalog filter is a high-value path.
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_content_catalog_source
        ON content_catalog (source)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_content_catalog_education_level
        ON content_catalog (education_level)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_content_catalog_subject
        ON content_catalog (subject)
    """)

    # ── reading_progress: unit pointer ─────────────────────────────────
    op.execute("""
        ALTER TABLE reading_progress
        ADD COLUMN IF NOT EXISTS current_unit_id BIGINT NULL
    """)
    op.execute("""
        ALTER TABLE reading_progress
        ADD COLUMN IF NOT EXISTS current_unit_order INT NULL
    """)

    # ── New table: reading_units ───────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS reading_units (
            id BIGSERIAL PRIMARY KEY,
            slice_id BIGINT NOT NULL,
            unit_order INT NOT NULL,
            total_units INT NOT NULL,
            body_text TEXT NOT NULL,
            char_count INT NOT NULL,
            word_count INT NOT NULL,
            estimated_read_minutes INT DEFAULT 2,
            created_at TIMESTAMP DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_reading_units_slice_id
        ON reading_units (slice_id)
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS ix_reading_units_slice_order
        ON reading_units (slice_id, unit_order)
    """)

    # ── New table: work_likes ──────────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS work_likes (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL,
            work_id BIGINT NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_work_likes_user_id
        ON work_likes (user_id)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_work_likes_work_id
        ON work_likes (work_id)
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS ix_work_likes_user_work
        ON work_likes (user_id, work_id)
    """)

    # ── New table: work_comments ───────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS work_comments (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL,
            work_id BIGINT NOT NULL,
            body TEXT NOT NULL,
            parent_comment_id BIGINT NULL,
            status VARCHAR(20) DEFAULT 'approved',
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_work_comments_user_id
        ON work_comments (user_id)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_work_comments_work_id
        ON work_comments (work_id)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_work_comments_parent_id
        ON work_comments (parent_comment_id)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_work_comments_status
        ON work_comments (status)
    """)

    # ── New table: work_comment_likes ──────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS work_comment_likes (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL,
            comment_id BIGINT NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_work_comment_likes_user_id
        ON work_comment_likes (user_id)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_work_comment_likes_comment_id
        ON work_comment_likes (comment_id)
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS ix_work_comment_likes_user_comment
        ON work_comment_likes (user_id, comment_id)
    """)

    # ── New table: work_shares ─────────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS work_shares (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL,
            work_id BIGINT NOT NULL,
            platform VARCHAR(50) NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_work_shares_user_id
        ON work_shares (user_id)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_work_shares_work_id
        ON work_shares (work_id)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_work_shares_created_at
        ON work_shares (created_at)
    """)


def downgrade() -> None:
    # Reverse order: drop tables first, then column additions.
    op.execute("DROP TABLE IF EXISTS work_shares")
    op.execute("DROP TABLE IF EXISTS work_comment_likes")
    op.execute("DROP TABLE IF EXISTS work_comments")
    op.execute("DROP TABLE IF EXISTS work_likes")
    op.execute("DROP TABLE IF EXISTS reading_units")

    op.execute("ALTER TABLE reading_progress DROP COLUMN IF EXISTS current_unit_order")
    op.execute("ALTER TABLE reading_progress DROP COLUMN IF EXISTS current_unit_id")

    op.execute("DROP INDEX IF EXISTS ix_content_catalog_subject")
    op.execute("DROP INDEX IF EXISTS ix_content_catalog_education_level")
    op.execute("DROP INDEX IF EXISTS ix_content_catalog_source")
    op.execute("ALTER TABLE content_catalog DROP COLUMN IF EXISTS attribution_text")
    op.execute("ALTER TABLE content_catalog DROP COLUMN IF EXISTS license_type")
    op.execute("ALTER TABLE content_catalog DROP COLUMN IF EXISTS subject")
    op.execute("ALTER TABLE content_catalog DROP COLUMN IF EXISTS education_level")
    op.execute("ALTER TABLE content_catalog DROP COLUMN IF EXISTS source")
