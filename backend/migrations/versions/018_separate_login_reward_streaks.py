"""Separate login tracking from reward streaks

Revision ID: 018_separate_login_reward_streaks
Revises: 017_content_body_sentinels_version
Create Date: 2024-08-23 20:30:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '018_separate_login_reward_streaks'
down_revision = '017_content_body_sentinels_version'
branch_labels = None
depends_on = None


def upgrade():
    # Add new columns for separate login tracking and reward streaks
    op.add_column('user_streaks', sa.Column('longest_login_streak', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('user_streaks', sa.Column('total_logins', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('user_streaks', sa.Column('reward_streak', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('user_streaks', sa.Column('longest_reward_streak', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('user_streaks', sa.Column('last_reward_claim_date', sa.String(length=10), nullable=True))
    op.add_column('user_streaks', sa.Column('reward_streak_expires_at', sa.DateTime(), nullable=True))
    
    # Migrate existing data: copy current values to new login tracking fields
    op.execute("""
        UPDATE user_streaks 
        SET 
            longest_login_streak = longest_streak,
            total_logins = CASE WHEN last_login_date IS NOT NULL THEN consecutive_login_days ELSE 0 END,
            reward_streak = 0,  -- Reset all reward streaks to 0
            longest_reward_streak = 0,
            last_reward_claim_date = last_claim_date,
            reward_streak_expires_at = NULL
    """)


def downgrade():
    # Remove the new columns
    op.drop_column('user_streaks', 'reward_streak_expires_at')
    op.drop_column('user_streaks', 'last_reward_claim_date')
    op.drop_column('user_streaks', 'longest_reward_streak')
    op.drop_column('user_streaks', 'reward_streak')
    op.drop_column('user_streaks', 'total_logins')
    op.drop_column('user_streaks', 'longest_login_streak')