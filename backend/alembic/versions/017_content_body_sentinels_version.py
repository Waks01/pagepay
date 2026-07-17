"""Add content_catalog.body_sentinels_version to gate the v3 reader sentinel
renderer.

Revision ID: 017_body_sentinels
Revises: 016_study_reader_mode
Create Date: 2026-07-13 22:35:00.000000

Schema additions:
  content_catalog:
    + body_sentinels_version  SMALLINT  NOT NULL  DEFAULT 0

Why this column exists at all:
  - v3 §2.4 defines a server→client element contract: the slicer
    rewrites preserved HTML into stable text sentinels
    ([[IMG:src|alt]], Caption: …, [TABLE START]…[TABLE END],
    [[EQ:…]]) inside the slice body. The reader detects them with a
    regex and swaps in a native component.
  - The existing catalog (slices already in the DB) was ingested
    before the sentinel contract shipped. Those slices are plain
    text. We can ship the reader sentinel renderer today; it just
    needs to know "does this slice have sentinels or is it raw
    text?" — that's the version field.
  - The reader checks `body_sentinels_version === 1` before parsing.
    If 0 (or missing), it falls back to a single <Text> with the
    raw body. This means we can ship the renderer, then update
    the OpenStax ingest in a separate change to emit sentinels +
    bump the version, with zero client-side coordination.

Why a SMALLINT not a string:
  - We will never have more than a handful of sentinel contract
    versions in the lifetime of this product (maybe v2 if the
    client-side renderer wants different sentinels for a future
    feature). SMALLINT is 2 bytes; VARCHAR(16) would be 17.

Why NOT NULL with default 0:
  - All existing slices are pre-sentinel, so 0 is the correct
    value for every existing row. A nullable column with
    implicit NULL would force every reader query to COALESCE.

No index: the catalog query that fetches a slice already filters
by primary key. An index here would be dead weight.
"""

from typing import Sequence, Union
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "017_body_sentinels"
down_revision: Union[str, None] = "016_study_reader_mode"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE content_catalog
        ADD COLUMN IF NOT EXISTS body_sentinels_version SMALLINT NOT NULL DEFAULT 0
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE content_catalog
        DROP COLUMN IF EXISTS body_sentinels_version
    """)
