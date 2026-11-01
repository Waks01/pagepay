"""Add audio_topics, audio_batches, audio_episodes tables for podcast narration.

Revision ID: 002
Revises: 001
Create Date: 2025-01-11 12:00:00.000000

Audio narration (Phase D) requires three new tables:
- audio_topics: Extract and cache topics from study materials
- audio_batches: Track batch orders for narration generation
- audio_episodes: Individual TTS generation tasks within a batch
"""
from alembic import op
import sqlalchemy as sa


revision = '002'
down_revision = '001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create audio_topics table
    op.create_table(
        'audio_topics',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('material_id', sa.Integer(), nullable=False),
        sa.Column('topic_index', sa.Integer(), nullable=False),
        sa.Column('topic_name', sa.String(500), nullable=False),
        sa.Column('char_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['material_id'], ['study_materials.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('material_id', 'topic_index', name='uq_audio_topics_material_index'),
    )
    op.create_index('ix_audio_topics_material_id', 'audio_topics', ['material_id'])

    # Create audio_batches table
    op.create_table(
        'audio_batches',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('material_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('topic_indexes', sa.Text(), nullable=False),  # JSON encoded list
        sa.Column('total_episodes', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('total_cost_sv', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('refunded_sv', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('status', sa.String(20), nullable=False, server_default='queued'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['material_id'], ['study_materials.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_audio_batches_material_id', 'audio_batches', ['material_id'])
    op.create_index('ix_audio_batches_user_id', 'audio_batches', ['user_id'])
    op.create_index('ix_audio_batches_material_user', 'audio_batches', ['material_id', 'user_id'])
    op.create_index('ix_audio_batches_status', 'audio_batches', ['status'])

    # Create audio_episodes table
    op.create_table(
        'audio_episodes',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('batch_id', sa.Integer(), nullable=False),
        sa.Column('material_id', sa.Integer(), nullable=False),
        sa.Column('topic_index', sa.Integer(), nullable=False),
        sa.Column('episode_index', sa.Integer(), nullable=False),
        sa.Column('total_episodes', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('level', sa.String(50), nullable=False, server_default='natural'),
        sa.Column('status', sa.String(20), nullable=False, server_default='queued'),
        sa.Column('cost_sv', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('char_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('estimated_seconds', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('actual_duration_seconds', sa.Integer(), nullable=True),
        sa.Column('audio_data', sa.LargeBinary(), nullable=True),
        sa.Column('audio_url', sa.String(1000), nullable=True),
        sa.Column('position_seconds', sa.Float(), nullable=False, server_default='0.0'),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.Column('refunded_at', sa.DateTime(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['batch_id'], ['audio_batches.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['material_id'], ['study_materials.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_audio_episodes_batch_id', 'audio_episodes', ['batch_id'])
    op.create_index('ix_audio_episodes_material_id', 'audio_episodes', ['material_id'])
    op.create_index('ix_audio_episodes_status', 'audio_episodes', ['status'])
    op.create_index('ix_audio_episodes_batch_status', 'audio_episodes', ['batch_id', 'status'])


def downgrade() -> None:
    # Drop indexes in reverse order
    op.drop_index('ix_audio_episodes_batch_status', table_name='audio_episodes')
    op.drop_index('ix_audio_episodes_status', table_name='audio_episodes')
    op.drop_index('ix_audio_episodes_material_id', table_name='audio_episodes')
    op.drop_index('ix_audio_episodes_batch_id', table_name='audio_episodes')
    op.drop_table('audio_episodes')

    op.drop_index('ix_audio_batches_status', table_name='audio_batches')
    op.drop_index('ix_audio_batches_material_user', table_name='audio_batches')
    op.drop_index('ix_audio_batches_user_id', table_name='audio_batches')
    op.drop_index('ix_audio_batches_material_id', table_name='audio_batches')
    op.drop_table('audio_batches')

    op.drop_index('ix_audio_topics_material_id', table_name='audio_topics')
    op.drop_table('audio_topics')
