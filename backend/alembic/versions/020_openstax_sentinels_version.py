"""Set body_sentinels_version=1 for existing OpenStax slices that contain
v3 sentinels in their body_text.

Revision ID: 020_openstax_sentinels_version
Revises: 3f02971605b1
Create Date: 2026-07-15

Why:
  The OpenStax ingest (topic_slicer.py + openstax.py) emits v3 sentinels
  ([[IMG:...]], Caption: ..., [TABLE START]..., [[EQ:...]]) inside
  body_text, but prior to this fix the ingest did not bump
  body_sentinels_version from its default of 0. The reader checks
  body_sentinels_version before parsing sentinels, so existing OpenStax
  slices rendered as plain text and showed raw [[IMG:...]] markers
  instead of native images.

  This migration back-fills version=1 for any slice whose body_text
  already contains at least one sentinel. It is idempotent: re-running
  against an already-fixed row is a no-op.
"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "020_openstax_sentinels_version"
down_revision: Union[str, None] = "3f02971605b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        UPDATE content_catalog
        SET body_sentinels_version = 1
        WHERE source = 'openstax'
          AND body_sentinels_version = 0
          AND (
              body_text LIKE '%[[IMG:%'
              OR body_text LIKE '%Caption:%'
              OR body_text LIKE '%[TABLE START]%'
              OR body_text LIKE '%[[EQ:%'
          )
    """)


def downgrade() -> None:
    op.execute("""
        UPDATE content_catalog
        SET body_sentinels_version = 0
        WHERE source = 'openstax'
          AND body_sentinels_version = 1
    """)
