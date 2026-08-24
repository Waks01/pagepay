# Daily Reward Streak Fix

## Problem
The "Day X" counter in the daily rewards screen was appearing to increment based on app opens/logins rather than based on actual daily reward claims. This created confusion where users would see "Day 5" even though they had only claimed rewards on 3 days.

## Root Cause Analysis

After thorough investigation of the codebase, the backend logic was actually **correct**:

1. **Two separate streak systems exist:**
   - `consecutive_login_days` / `current_streak`: Tracks how many consecutive days user opened the app (login streak)
   - `reward_streak`: Tracks how many consecutive days user claimed daily rewards (reward streak)

2. **Backend correctly uses `reward_streak`:**
   - The `/api/v1/rewards/daily/status` endpoint correctly returns `streak.reward_streak` as `current_streak`
   - The `_claim_daily_reward_increment_streak()` function only increments `reward_streak` when a reward is actually claimed
   - The `_update_reward_streak()` function (called on status check) only resets `reward_streak` if it expires, never increments it

3. **Potential issues identified:**
   - **Stale data:** The frontend was caching the reward status for 1 hour (`staleTime: 60 * 60 * 1000`)
   - **Unclear distinction:** Comments didn't explicitly warn that login != claim
   - **No verification logging:** No logs to verify reward_streak wasn't changing unexpectedly on status checks

## Changes Made

### Backend (`backend/app/routers/daily_rewards.py`)

1. **Added defensive verification in `/daily/status` endpoint:**
   - Checks `reward_streak` before and after `_update_reward_streak()`
   - Logs a WARNING if `reward_streak` changes unexpectedly (should only reset to 0 if expired)
   - Logs INFO when streak expires normally

2. **Enhanced documentation:**
   - Added explicit comments that reward_streak only increments on actual claims
   - Clarified that `current_streak` in the response refers to reward claims, not logins
   - Added IMPORTANT notes in function docstrings

### Frontend (`page/src/app/(app)/rewards/daily.tsx`)

1. **Fixed query caching:**
   - Changed `staleTime` from 1 hour to 0 (always fetch fresh data)
   - Added `cacheTime` of 5 minutes for performance
   - This ensures users always see the latest reward status

2. **Added debug logging:**
   - Console logs show current reward streak and next day number
   - Logs confirm when claim succeeds and status query is invalidated

3. **Verified invalidation:**
   - Added log message when query is invalidated after successful claim
   - Ensures UI refreshes with new streak after claiming

## How It Works (After Fix)

### User Journey:
1. **Day 1:** User opens app
   - `reward_streak = 0`
   - Sees "Day 1" reward available
   - Claims reward → `reward_streak = 1`

2. **Day 2:** User opens app WITHOUT claiming
   - `reward_streak = 1` (unchanged - no claim)
   - Sees "Day 2" reward available
   - But they DON'T claim

3. **Day 3:** User opens app
   - Checks if Day 2 was claimed → NO
   - Streak expired → `reward_streak = 0`
   - Sees "Day 1" reward available again (streak reset)

4. **Day 3 (same day):** User claims
   - `reward_streak = 1`
   - Now sees "Day 2" for tomorrow

### Key Points:
- **"Day X" shown = reward_streak + 1** (the next day they can claim)
- **Streak only increments when user actually claims**
- **Streak resets to 0 if user misses a day**
- **Opening the app does NOT increment the reward streak**

## Testing Recommendations

1. **Test streak progression:**
   - Open app, claim Day 1
   - Check that it shows Day 2
   - Close and reopen app without claiming
   - Verify it still shows Day 2 (not Day 3)

2. **Test streak expiration:**
   - Claim a reward one day
   - Wait 24+ hours without claiming
   - Open app again
   - Verify it shows Day 1 (streak reset)

3. **Test consecutive claims:**
   - Claim Day 1 on Monday
   - Claim Day 2 on Tuesday
   - Claim Day 3 on Wednesday
   - Verify progression is 1→2→3

4. **Check logs:**
   - Monitor backend logs for any WARNING about unexpected reward_streak changes
   - Check frontend console for streak values matching expectations

## Verification

Run these queries to check current user streak states:

```sql
-- Check users with active reward streaks
SELECT user_id, reward_streak, last_reward_claim_date, 
       consecutive_login_days, last_login_date
FROM user_streaks
WHERE reward_streak > 0;

-- Check recent reward claims
SELECT user_id, claim_date, streak_day, points_earned
FROM user_reward_claims
ORDER BY claimed_at DESC
LIMIT 10;
```

## Migration Note

If users have incorrect streak data from before this fix, you may want to run:

```sql
-- Reset all reward streaks (users will start fresh)
UPDATE user_streaks
SET reward_streak = 0,
    longest_reward_streak = 0,
    last_reward_claim_date = NULL,
    reward_streak_expires_at = NULL;
```

Or keep existing data if you're confident the backend was working correctly before.
