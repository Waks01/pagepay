"""Add exam session tracking tables for Phase 3 exam mode.

Revision ID: 043_study_exam_schema
Revises: 042_study_material_original_file
Create Date: 2026-01-11 00:00:00.000000

Why:
  - Exam mode (Phase 3) requires tracking exam sessions, questions, and answers.
  - Three tables: study_exam_sessions, study_exam_questions, study_exam_answers
  - Sessions track start/end/score; questions store question text and options;
    answers track user responses and correctness after grading.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "043_study_exam_schema"
down_revision: Union[str, None] = "042_study_material_original_file"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── study_exam_sessions ──────────────────────────────────────────────
    op.create_table(
        "study_exam_sessions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("material_id", sa.BigInteger(), nullable=False),
        sa.Column("exam_type", sa.String(100), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="in_progress"),
        sa.Column("total_questions", sa.Integer(), nullable=False),
        sa.Column("duration_seconds", sa.Integer(), nullable=False),
        sa.Column("score", sa.Integer(), nullable=True),
        sa.Column("correct_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("wrong_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("passed", sa.Boolean(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("submitted_at", sa.DateTime(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.Index("ix_exam_session_user_material", "user_id", "material_id"),
        sa.Index("ix_exam_session_status_expires", "status", "expires_at"),
        sa.Index("ix_study_exam_sessions_user_id", "user_id"),
    )

    # ── study_exam_questions ─────────────────────────────────────────────
    op.create_table(
        "study_exam_questions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("question_index", sa.Integer(), nullable=False),
        sa.Column("question_text", sa.Text(), nullable=False),
        sa.Column("options", sa.Text(), nullable=False),  # JSON array
        sa.Column("correct_answer", sa.String(500), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["study_exam_sessions.id"],
            name="fk_exam_question_session",
            ondelete="CASCADE",
        ),
        sa.Index("ix_exam_question_session_index", "session_id", "question_index"),
        sa.Index("ix_study_exam_questions_session_id", "session_id"),
    )

    # ── study_exam_answers ───────────────────────────────────────────────
    op.create_table(
        "study_exam_answers",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("question_id", sa.Integer(), nullable=False),
        sa.Column("selected_answer", sa.String(500), nullable=True),
        sa.Column("is_correct", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["study_exam_sessions.id"],
            name="fk_exam_answer_session",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["question_id"],
            ["study_exam_questions.id"],
            name="fk_exam_answer_question",
            ondelete="CASCADE",
        ),
        sa.Index("ix_exam_answer_session_question", "session_id", "question_id"),
        sa.Index("ix_study_exam_answers_session_id", "session_id"),
    )


def downgrade() -> None:
    op.drop_table("study_exam_answers")
    op.drop_table("study_exam_questions")
    op.drop_table("study_exam_sessions")
