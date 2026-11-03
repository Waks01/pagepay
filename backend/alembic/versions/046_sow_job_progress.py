"""Real progress reporting for SOW upload jobs.

Revision ID: 046_sow_job_progress
Revises: 045_study_progress_topics
Create Date: 2026-10-20 00:00:00.000000

Schema additions:
  sow_upload_jobs:
    + progress  SMALLINT  NULL — 0-100, written by the worker as each
      step completes.
    + stage  VARCHAR(40)  NULL — machine-readable stage code
      (queued | reading_pages | parsing_ai | saving | completed) that
      the client turns into a label.

Why:
  - The upload worker used to flip the job row between `queued`,
    `processing`, and `completed` with nothing in between, so the
    client had to fake progress with a 1%-per-poll tick. The bar
    crept along and told the user nothing about what was happening.
  - OCR + AI parsing on a multi-page PDF takes 30-120 seconds. That is
    long enough that a bar with no stage information reads as a hang.
  - The stage code also makes the failure diagnosable: a job stuck in
    `reading_pages` is a PDF/OCR problem, one stuck in `parsing_ai` is
    an AI-provider problem.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "046_sow_job_progress"
down_revision: Union[str, None] = "045_study_progress_topics"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE sow_upload_jobs
        ADD COLUMN IF NOT EXISTS progress SMALLINT NULL
    """)
    op.execute("""
        ALTER TABLE sow_upload_jobs
        ADD COLUMN IF NOT EXISTS stage VARCHAR(40) NULL
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE sow_upload_jobs
        DROP COLUMN IF EXISTS stage
    """)
    op.execute("""
        ALTER TABLE sow_upload_jobs
        DROP COLUMN IF EXISTS progress
    """)
