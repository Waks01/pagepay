"""Attributable study progress: study_assets.topic + one progress row per topic.

Revision ID: 045_study_progress_topics
Revises: 044_study_audio_batches
Create Date: 2026-10-11 00:00:00.000000

NOTE: `alembic_version.version_num` is VARCHAR(32), so revision ids must
stay within 32 characters. A longer id runs the migration's DDL and
then fails the version-bookkeeping UPDATE, which rolls the whole
migration back — schema unchanged, alembic_version unchanged.

Schema additions:
  study_assets:
    + topic  VARCHAR(200)  NULL  — the parsed-structure topic name the
      asset was generated from (single-topic mode only). Quiz results
      roll up into `study_progress` through it; all-topics assets leave
      it NULL and don't move per-topic progress.
  study_progress:
    + ix_study_progress_material_topic  UNIQUE (material_id, user_id,
      topic_name) — one row per topic. Before the constraint lands,
      existing duplicate rows are collapsed to the strongest
      (status rank, best mastery_score, most recent review) so no
      history is silently lost.
  models: StudyProgress also created this index via `__table_args__`,
  so fresh installs (create_all) and migrated databases agree.

Why:
  - The progress dashboard read path has existed since Phase 3 but had
    no writer: `POST /study/progress` is insert-only and no client ever
    called it, so the section always showed 0% mastered.
  - Upserting on (user, material, topic) makes repeated quiz attempts
    update a single row instead of stacking duplicates that inflate
    the mastered/reviewing counts.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "045_study_progress_topics"
down_revision: Union[str, None] = "044_study_audio_batches"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE study_assets
        ADD COLUMN IF NOT EXISTS topic VARCHAR(200) NULL
    """)

    # Collapse pre-existing duplicate rows: keep the strongest status
    # (mastered > reviewing > not_started), then the best score, then
    # the most recent review, then the newest row as the final tiebreak.
    op.execute("""
        DELETE FROM study_progress
        WHERE id NOT IN (
            SELECT DISTINCT ON (user_id, material_id, topic_name) id
            FROM study_progress
            ORDER BY user_id, material_id, topic_name,
                CASE status
                    WHEN 'mastered' THEN 2
                    WHEN 'reviewing' THEN 1
                    ELSE 0
                END DESC,
                COALESCE(mastery_score, -1) DESC,
                COALESCE(last_reviewed_at, created_at) DESC,
                id DESC
        )
    """)

    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS ix_study_progress_material_topic
        ON study_progress (material_id, user_id, topic_name)
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_study_progress_material_topic")
    op.execute("""
        ALTER TABLE study_assets
        DROP COLUMN IF EXISTS topic
    """)
