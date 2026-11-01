# Migration 011: Fixing Points Conversion Rate

## Problem Summary

**Migration 009 had an error:**
- It **multiplied** points by 10 when it should have **divided** by 10
- This gave users 100x more purchasing power than intended

**Correct conversion from 100:1 to 10:1:**
- OLD: 100 points = ₦1
- NEW: 10 points = ₦1
- User who had 1,000 points (₦10) should now have 100 points (still ₦10)

---

## Decision: Which Migration Approach?

### **SCENARIO A: No transactions since migration 009 ran**

**Use migration 011 as-is** (simple divide by 100)

```sql
UPDATE users SET points_balance = FLOOR(points_balance / 100)
```

This is clean and simple.

---

### **SCENARIO B: Users made transactions after migration 009**

**Problem:** New transactions (ads, bills, deposits) already used the correct 10:1 ratio.

**Example:**
1. User had 1,000 points before migration 009
2. Migration 009 ran → now 10,000 points
3. User bought ₦100 airtime → -1,000 points → balance: 9,000 points
4. User earned from ad → +50 points → balance: 9,050 points
5. If we now divide by 100: 9,050 / 100 = 90 points (WRONG! Should be ~140 points)

**Solution:** Complex migration that tracks transaction timestamps

```python
def upgrade() -> None:
    """
    More sophisticated fix that accounts for post-migration transactions.
    
    Steps:
    1. Identify when migration 009 ran (check alembic_version table)
    2. Calculate each user's balance at the time of migration 009
    3. Divide that balance by 100
    4. Add back all transactions that occurred AFTER migration 009
    """
    
    # Get migration 009 timestamp
    migration_009_time = op.execute(
        "SELECT MAX(created_at) FROM alembic_version_history "
        "WHERE version_num = '009_adjust_points_conversion_rate'"
    ).scalar()
    
    # For each user, recalculate correct balance
    op.execute(f"""
        WITH pre_migration_balance AS (
            -- Calculate balance at time of migration 009
            -- This would require transaction history table
            SELECT user_id, 
                   SUM(points_change) as balance_at_migration
            FROM (
                SELECT user_id, points_earned as points_change
                FROM ad_events 
                WHERE created_at < '{migration_009_time}'
                UNION ALL
                SELECT user_id, points_earned as points_change
                FROM bill_transactions
                WHERE created_at < '{migration_009_time}'
                UNION ALL
                SELECT user_id, -amount_kobo as points_change
                FROM payouts
                WHERE created_at < '{migration_009_time}'
                -- Add other transaction sources...
            ) all_transactions
            GROUP BY user_id
        ),
        post_migration_transactions AS (
            -- Calculate all changes AFTER migration 009
            SELECT user_id,
                   SUM(points_change) as post_migration_delta
            FROM (
                SELECT user_id, points_earned as points_change
                FROM ad_events
                WHERE created_at >= '{migration_009_time}'
                UNION ALL
                SELECT user_id, points_earned as points_change
                FROM bill_transactions
                WHERE created_at >= '{migration_009_time}'
                -- Add other sources...
            ) post_migration
            GROUP BY user_id
        )
        UPDATE users u
        SET points_balance = FLOOR(COALESCE(pre.balance_at_migration, 0) / 100) 
                           + COALESCE(post.post_migration_delta, 0)
        FROM pre_migration_balance pre
        LEFT JOIN post_migration_transactions post ON pre.user_id = post.user_id
        WHERE u.id = pre.user_id
    """)
```

---

## How to Decide Which Approach?

### **Check 1: When did migration 009 run?**

```sql
SELECT * FROM alembic_version WHERE version_num = '009_adjust_points_conversion_rate';
```

### **Check 2: Are there transactions after that date?**

```sql
-- Check ad_events table
SELECT COUNT(*) FROM ad_events WHERE created_at > '2026-07-08 14:55:00';

-- Check bill_transactions table
SELECT COUNT(*) FROM bill_transactions WHERE created_at > '2026-07-08 14:55:00';

-- Check payment table (wallet deposits)
SELECT COUNT(*) FROM payment WHERE created_at > '2026-07-08 14:55:00';
```

### **Check 3: How many users are affected?**

```sql
SELECT COUNT(*) as total_users,
       MIN(points_balance) as min_balance,
       MAX(points_balance) as max_balance,
       AVG(points_balance) as avg_balance
FROM users
WHERE points_balance > 0;
```

---

## Recommendation

### **If migration 009 ran recently (< 24 hours ago) AND minimal transactions:**
✅ **Use the simple migration 011** (divide by 100)

### **If migration 009 ran days/weeks ago OR many transactions since:**
⚠️ **Use the complex migration** (recalculate from transaction history)

### **If you're unsure:**
1. **Backup the database first!**
   ```bash
   pg_dump -h <host> -U <user> -d <database> > backup_before_migration_011.sql
   ```

2. Run queries in "Check 1, 2, 3" above
3. Share results to determine best approach

---

## Current Status

Migration 011 file created with **SIMPLE APPROACH** (divide by 100).

**Before running:**
1. Check if approach matches your scenario
2. Backup database
3. Test on staging environment first
4. Review affected user balances

**To run migration:**
```bash
cd backend
alembic upgrade head
```

**To rollback if issues:**
```bash
alembic downgrade -1
```
