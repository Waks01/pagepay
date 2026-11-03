"""Add ai_usage_logs and audio narration tables missing from production.

Revision ID: 048_add_ai_usage_and_audio_tables
Revises: 047_study_page_artifacts
Create Date: 2026-11-03
"""
from typing import Sequence, Union

from alembic import op


revision: str = "048_add_missing_tables"
down_revision: Union[str, None] = "047_study_page_artifacts"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS ai_usage_logs (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            operation VARCHAR(50) NOT NULL,
            model VARCHAR(100) NOT NULL,
            input_tokens INTEGER NOT NULL DEFAULT 0,
            cost_neurons FLOAT NOT NULL DEFAULT 0.0,
            metadata JSONB,
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_ai_usage_logs_user_id ON ai_usage_logs(user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_ai_usage_logs_operation ON ai_usage_logs(operation)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_ai_usage_logs_created_at ON ai_usage_logs(created_at)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_ai_usage_logs_user_created ON ai_usage_logs(user_id, created_at)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_ai_usage_logs_operation_created ON ai_usage_logs(operation, created_at)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS audio_topics (
            id SERIAL PRIMARY KEY,
            material_id INTEGER NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
            topic_index INTEGER NOT NULL,
            topic_name VARCHAR(500) NOT NULL,
            char_count INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            UNIQUE (material_id, topic_index)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_audio_topics_material_id ON audio_topics(material_id)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS audio_batches (
            id SERIAL PRIMARY KEY,
            material_id INTEGER NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            topic_indexes TEXT NOT NULL,
            total_episodes INTEGER NOT NULL DEFAULT 0,
            total_cost_sv INTEGER NOT NULL DEFAULT 0,
            refunded_sv INTEGER NOT NULL DEFAULT 0,
            status VARCHAR(20) NOT NULL DEFAULT 'queued',
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_audio_batches_material_id ON audio_batches(material_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_audio_batches_user_id ON audio_batches(user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_audio_batches_material_user ON audio_batches(material_id, user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_audio_batches_status ON audio_batches(status)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS audio_episodes (
            id SERIAL PRIMARY KEY,
            batch_id INTEGER NOT NULL REFERENCES audio_batches(id) ON DELETE CASCADE,
            material_id INTEGER NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
            topic_index INTEGER NOT NULL,
            episode_index INTEGER NOT NULL,
            total_episodes INTEGER NOT NULL DEFAULT 1,
            level VARCHAR(50) NOT NULL DEFAULT 'natural',
            status VARCHAR(20) NOT NULL DEFAULT 'queued',
            cost_sv INTEGER NOT NULL DEFAULT 0,
            char_count INTEGER NOT NULL DEFAULT 0,
            estimated_seconds INTEGER NOT NULL DEFAULT 0,
            actual_duration_seconds INTEGER NULL,
            audio_data BYTEA NULL,
            audio_url VARCHAR(1000) NULL,
            position_seconds FLOAT NOT NULL DEFAULT 0.0,
            completed_at TIMESTAMP NULL,
            refunded_at TIMESTAMP NULL,
            error_message TEXT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_audio_episodes_batch_id ON audio_episodes(batch_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_audio_episodes_material_id ON audio_episodes(material_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_audio_episodes_status ON audio_episodes(status)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_audio_episodes_batch_status ON audio_episodes(batch_id, status)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS audio_episodes")
    op.execute("DROP TABLE IF EXISTS audio_batches")
    op.execute("DROP TABLE IF EXISTS audio_topics")
    op.execute("DROP TABLE IF EXISTS ai_usage_logs")
