"""Add missing study exam tables and audio batch active_episode_id.

Revision ID: 049_add_exam_audio_cols
Revises: 048_add_missing_tables
Create Date: 2026-11-03
"""
from typing import Sequence, Union

from alembic import op


revision: str = "049_add_exam_audio_cols"
down_revision: Union[str, None] = "048_add_missing_tables"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS study_exam_sessions (
            id SERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL,
            material_id BIGINT NOT NULL,
            exam_type VARCHAR(100) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'in_progress',
            total_questions INTEGER NOT NULL,
            duration_seconds INTEGER NOT NULL,
            score INTEGER NULL,
            correct_count INTEGER NOT NULL DEFAULT 0,
            wrong_count INTEGER NOT NULL DEFAULT 0,
            passed BOOLEAN NULL,
            started_at TIMESTAMP NOT NULL DEFAULT now(),
            submitted_at TIMESTAMP NULL,
            expires_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_exam_session_user_material ON study_exam_sessions(user_id, material_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_exam_session_status_expires ON study_exam_sessions(status, expires_at)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_study_exam_sessions_user_id ON study_exam_sessions(user_id)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS study_exam_questions (
            id SERIAL PRIMARY KEY,
            session_id INTEGER NOT NULL REFERENCES study_exam_sessions(id) ON DELETE CASCADE,
            question_index INTEGER NOT NULL,
            question_text TEXT NOT NULL,
            options TEXT NOT NULL,
            correct_answer VARCHAR(500) NOT NULL,
            explanation TEXT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_exam_question_session_index ON study_exam_questions(session_id, question_index)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_study_exam_questions_session_id ON study_exam_questions(session_id)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS study_exam_answers (
            id SERIAL PRIMARY KEY,
            session_id INTEGER NOT NULL REFERENCES study_exam_sessions(id) ON DELETE CASCADE,
            question_id INTEGER NOT NULL REFERENCES study_exam_questions(id) ON DELETE CASCADE,
            selected_answer VARCHAR(500) NULL,
            is_correct BOOLEAN NULL,
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            updated_at TIMESTAMP NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_exam_answer_session_question ON study_exam_answers(session_id, question_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_study_exam_answers_session_id ON study_exam_answers(session_id)")

    op.execute("ALTER TABLE audio_batches ADD COLUMN IF NOT EXISTS active_episode_id INTEGER NULL")


def downgrade() -> None:
    op.execute("ALTER TABLE audio_batches DROP COLUMN IF EXISTS active_episode_id")
    op.execute("DROP TABLE IF EXISTS study_exam_answers")
    op.execute("DROP TABLE IF EXISTS study_exam_questions")
    op.execute("DROP TABLE IF EXISTS study_exam_sessions")
