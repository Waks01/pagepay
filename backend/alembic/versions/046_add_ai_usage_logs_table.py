"""Add ai_usage_logs table for AI operation auditing and cost tracking.

Revision ID: 046_add_ai_usage_logs_table
Revises: 045_add_audio_active_episode_id

This migration creates the AiUsageLog table to track all AI service usage
(vision OCR, TTS synthesis, chat) for auditing, cost monitoring, per-user billing,
and quota enforcement. Used by Phase D audio narration and chat tutor.
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '046_add_ai_usage_logs_table'
down_revision = '045_add_audio_active_episode_id'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create ai_usage_logs table
    op.create_table(
        'ai_usage_logs',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('operation', sa.String(50), nullable=False),  # e.g., "audio_batch_create", "vision_extract", "chat_tutor"
        sa.Column('model', sa.String(100), nullable=False),  # e.g., "@cf/myshell-ai/melotts", "@cf/meta/llama-3.2-11b-vision-instruct"
        sa.Column('input_tokens', sa.Integer(), nullable=False, server_default='0'),  # character count or token count
        sa.Column('cost_neurons', sa.Float(), nullable=False, server_default='0.0'),  # cost in Neurons; 1000 Neurons ≈ $0.011
        sa.Column('metadata', sa.JSON(), nullable=True),  # additional context (batch_id, episode_id, education_level, etc.)
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    
    # Create indexes for common queries
    op.create_index('ix_ai_usage_logs_user_id', 'ai_usage_logs', ['user_id'])
    op.create_index('ix_ai_usage_logs_operation', 'ai_usage_logs', ['operation'])
    op.create_index('ix_ai_usage_logs_created_at', 'ai_usage_logs', ['created_at'])
    op.create_index('ix_ai_usage_logs_user_created', 'ai_usage_logs', ['user_id', 'created_at'])
    op.create_index('ix_ai_usage_logs_operation_created', 'ai_usage_logs', ['operation', 'created_at'])


def downgrade() -> None:
    # Drop indexes in reverse order
    op.drop_index('ix_ai_usage_logs_operation_created', table_name='ai_usage_logs')
    op.drop_index('ix_ai_usage_logs_user_created', table_name='ai_usage_logs')
    op.drop_index('ix_ai_usage_logs_created_at', table_name='ai_usage_logs')
    op.drop_index('ix_ai_usage_logs_operation', table_name='ai_usage_logs')
    op.drop_index('ix_ai_usage_logs_user_id', table_name='ai_usage_logs')
    
    # Drop table
    op.drop_table('ai_usage_logs')
