#!/usr/bin/env python3
"""Run database migration to add streak separation columns."""

import asyncio
import sys
from pathlib import Path
import os

# Add the backend directory to Python path
sys.path.insert(0, str(Path(__file__).parent))

# Load environment variables
from dotenv import load_dotenv
load_dotenv()

from sqlalchemy import text
from app.database import AsyncSessionLocal, engine


async def run_migration():
    """Run the migration to add new streak columns."""
    
    print("🔄 Starting database migration for streak separation...")
    
    migration_sql = """
    -- Add new columns for separate login tracking and reward streaks
    DO $$
    BEGIN
        -- Add columns if they don't exist
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'user_streaks' AND column_name = 'longest_login_streak') THEN
            ALTER TABLE user_streaks ADD COLUMN longest_login_streak INTEGER NOT NULL DEFAULT 0;
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'user_streaks' AND column_name = 'total_logins') THEN
            ALTER TABLE user_streaks ADD COLUMN total_logins INTEGER NOT NULL DEFAULT 0;
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'user_streaks' AND column_name = 'reward_streak') THEN
            ALTER TABLE user_streaks ADD COLUMN reward_streak INTEGER NOT NULL DEFAULT 0;
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'user_streaks' AND column_name = 'longest_reward_streak') THEN
            ALTER TABLE user_streaks ADD COLUMN longest_reward_streak INTEGER NOT NULL DEFAULT 0;
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'user_streaks' AND column_name = 'last_reward_claim_date') THEN
            ALTER TABLE user_streaks ADD COLUMN last_reward_claim_date VARCHAR(10);
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'user_streaks' AND column_name = 'reward_streak_expires_at') THEN
            ALTER TABLE user_streaks ADD COLUMN reward_streak_expires_at TIMESTAMP;
        END IF;
    END
    $$;
    
    -- Migrate existing data: copy current values to new login tracking fields
    UPDATE user_streaks 
    SET 
        longest_login_streak = longest_streak,
        total_logins = CASE WHEN last_login_date IS NOT NULL THEN consecutive_login_days ELSE 0 END,
        reward_streak = 0,  -- Reset all reward streaks to 0
        longest_reward_streak = 0,
        last_reward_claim_date = last_claim_date,
        reward_streak_expires_at = NULL
    WHERE longest_login_streak = 0; -- Only update rows that haven't been migrated yet
    """
    
    try:
        async with AsyncSessionLocal() as db:
            # Execute the migration
            await db.execute(text(migration_sql))
            await db.commit()
            print("✅ Migration completed successfully!")
            print("   - Added new streak tracking columns")
            print("   - Migrated existing data") 
            print("   - Reset all reward streaks to 0 (clean slate)")
            
    except Exception as e:
        print(f"❌ Migration failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(run_migration())