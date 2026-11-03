"""Add exam_sessions and exam_answers tables for Phase 3 exam mode.

Revision ID: 043_add_exam_tables
Revises: 042_study_material_original_file
Create Date: 2026-10-02 00:00:00.000000

Why:
  - Enable backend-authoritative exam mode with server-side timer,
    auto-submit via APScheduler, and persistent attempt history.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "043_add_exam_tables"
down_revision: Union[str, None] = "042_study_material_original_file"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "exam_sessions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("material_id", sa.BigInteger(), nullable=False),
        sa.Column("exam_type", sa.String(32), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="setup"),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("submitted_at", sa.DateTime(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("score", sa.Integer(), nullable=True),
        sa.Column("correct_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("wrong_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_questions", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("questions_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_exam_sessions_user_id", "exam_sessions", ["user_id"], unique=False)
    op.create_index("ix_exam_sessions_material_id", "exam_sessions", ["material_id"], unique=False)
    op.create_index("ix_exam_sessions_status", "exam_sessions", ["status"], unique=False)
    op.create_index("ix_exam_sessions_expires_at", "exam_sessions", ["expires_at"], unique=False)

    op.create_table(
        "exam_answers",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("session_id", sa.BigInteger(), nullable=False),
        sa.Column("question_id", sa.Integer(), nullable=False),
        sa.Column("selected_answer", sa.String(500), nullable=False),
        sa.Column("is_correct", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("answered_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id", "question_id", name="uq_exam_answer_session_question"),
    )
    op.create_index("ix_exam_answers_session_id", "exam_answers", ["session_id"], unique=False)
    op.create_index("ix_exam_answers_question_id", "exam_answers", ["question_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_exam_answers_question_id", table_name="exam_answers")
    op.drop_index("ix_exam_answers_session_id", table_name="exam_answers")
    op.drop_table("exam_answers")
    op.drop_index("ix_exam_sessions_expires_at", table_name="exam_sessions")
    op.drop_index("ix_exam_sessions_status", table_name="exam_sessions")
    op.drop_index("ix_exam_sessions_material_id", table_name="exam_sessions")
    op.drop_index("ix_exam_sessions_user_id", table_name="exam_sessions")
    op.drop_table("exam_sessions")
