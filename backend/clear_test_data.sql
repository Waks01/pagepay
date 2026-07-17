-- Clear test data from PagePay database
-- Run this with: mysql -u pagepay -ppagepass pagepay < clear_test_data.sql

USE pagepay;

-- Show counts before clearing
SELECT 'Before clearing:' AS status;
SELECT 'ad_events' AS table_name, COUNT(*) AS count FROM ad_events
UNION ALL
SELECT 'payments', COUNT(*) FROM payments
UNION ALL
SELECT 'payout_transactions', COUNT(*) FROM payout_transactions
UNION ALL
SELECT 'reading_sessions', COUNT(*) FROM reading_sessions;

-- Clear revenue-related data
DELETE FROM ad_events;
DELETE FROM payments;
DELETE FROM payout_transactions;
DELETE FROM reading_sessions;
DELETE FROM study_transactions;
DELETE FROM referrals;
DELETE FROM community_notes;
DELETE FROM fraud_flags;
DELETE FROM task_submissions;

-- Reset user balances but keep accounts
UPDATE users SET 
    points_balance = 0, 
    subscription_expires_at = NULL, 
    tier = 'basic', 
    last_active_at = NULL;

-- Show results
SELECT 'After clearing:' AS status;
SELECT 'ad_events' AS table_name, COUNT(*) AS count FROM ad_events
UNION ALL
SELECT 'payments', COUNT(*) FROM payments
UNION ALL
SELECT 'payout_transactions', COUNT(*) FROM payout_transactions
UNION ALL
SELECT 'reading_sessions', COUNT(*) FROM reading_sessions;

SELECT 'Database cleared successfully!' AS message;
