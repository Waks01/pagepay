-- Migration: Separate login tracking from reward streaks
-- Run this SQL script on your Neon database

-- Add new columns for separate login tracking and reward streaks
DO $$
BEGIN
    -- Add columns if they don't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'user_streaks' AND column_name = 'longest_login_streak') THEN
        ALTER TABLE user_streaks ADD COLUMN longest_login_streak INTEGER NOT NULL DEFAULT 0;
        RAISE NOTICE 'Added column: longest_login_streak';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'user_streaks' AND column_name = 'total_logins') THEN
        ALTER TABLE user_streaks ADD COLUMN total_logins INTEGER NOT NULL DEFAULT 0;
        RAISE NOTICE 'Added column: total_logins';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'user_streaks' AND column_name = 'reward_streak') THEN
        ALTER TABLE user_streaks ADD COLUMN reward_streak INTEGER NOT NULL DEFAULT 0;
        RAISE NOTICE 'Added column: reward_streak';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'user_streaks' AND column_name = 'longest_reward_streak') THEN
        ALTER TABLE user_streaks ADD COLUMN longest_reward_streak INTEGER NOT NULL DEFAULT 0;
        RAISE NOTICE 'Added column: longest_reward_streak';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'user_streaks' AND column_name = 'last_reward_claim_date') THEN
        ALTER TABLE user_streaks ADD COLUMN last_reward_claim_date VARCHAR(10);
        RAISE NOTICE 'Added column: last_reward_claim_date';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'user_streaks' AND column_name = 'reward_streak_expires_at') THEN
        ALTER TABLE user_streaks ADD COLUMN reward_streak_expires_at TIMESTAMP;
        RAISE NOTICE 'Added column: reward_streak_expires_at';
    END IF;
END
$$;

-- Migrate existing data: copy current values to new login tracking fields
UPDATE user_streaks 
SET 
    longest_login_streak = COALESCE(longest_streak, 0),
    total_logins = CASE WHEN last_login_date IS NOT NULL THEN COALESCE(consecutive_login_days, 0) ELSE 0 END,
    reward_streak = 0,  -- Reset all reward streaks to 0 (clean slate)
    longest_reward_streak = 0,
    last_reward_claim_date = last_claim_date,
    reward_streak_expires_at = NULL
WHERE longest_login_streak = 0; -- Only update rows that haven't been migrated yet

-- Verify the migration
SELECT 
    COUNT(*) as total_users,
    AVG(longest_login_streak) as avg_login_streak,
    AVG(reward_streak) as avg_reward_streak,
    COUNT(CASE WHEN last_reward_claim_date IS NOT NULL THEN 1 END) as users_with_claims
FROM user_streaks;

-- Show sample of migrated data
SELECT 
    user_id,
    current_streak,
    longest_streak,
    consecutive_login_days,
    longest_login_streak,
    total_logins,
    reward_streak,
    longest_reward_streak,
    last_claim_date,
    last_reward_claim_date
FROM user_streaks
LIMIT 5;