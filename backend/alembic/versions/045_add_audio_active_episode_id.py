"""Add active_episode_id to audio_batches for tracking current playback position.

Revision ID: 045_add_audio_active_episode_id
Revises: 044_study_figures_schema
Create Date: 2026-01-11 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '045_add_audio_active_episode_id'
down_revision: Union[str, None] = '044_study_figures_schema'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    # Add active_episode_id column to audio_batches if not already present
    if 'audio_batches' in existing_tables:
        columns = inspector.get_columns('audio_batches')
        column_names = {col['name'] for col in columns}
        
        if 'active_episode_id' not in column_names:
            op.add_column(
                'audio_batches',
                sa.Column('active_episode_id', sa.Integer(), nullable=True)
            )
            # Create foreign key constraint
            op.create_foreign_key(
                'fk_audio_batches_active_episode_id',
                'audio_batches',
                'audio_episodes',
                ['active_episode_id'],
                ['id'],
                ondelete='SET NULL'
            )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    # Remove active_episode_id column from audio_batches
    if 'audio_batches' in existing_tables:
        columns = inspector.get_columns('audio_batches')
        column_names = {col['name'] for col in columns}
        
        if 'active_episode_id' in column_names:
            op.drop_constraint('fk_audio_batches_active_episode_id', 'audio_batches', type_='foreignkey')
            op.drop_column('audio_batches', 'active_episode_id')
