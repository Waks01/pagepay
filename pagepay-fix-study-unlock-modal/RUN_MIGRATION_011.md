# How to Run Migration 011 - Step by Step

## ⚠️ READ THIS FIRST

Migration 011 will **divide all user points balances by 100**. This is permanent and cannot be easily undone without a database backup.

**Current situation:**
- Migration 009 already ran (multiplied balances by 10 incorrectly)
- You have 1 test user
- Need to fix their balance from 100:1 to 10:1 ratio

---

## Step 1: Get Your Database URL

1. Go to your Render dashboard: https://dashboard.render.com
2. Navigate to your PostgreSQL database
3. Copy the **External Database URL** (NOT the internal one)
4. It should look like:
   ```
   postgresql://pagepay:LONG_PASSWORD_HERE@dpg-xxxxxx.ohio-postgres.render.com/pagepay
   ```

---

## Step 2: Run the Migration

Open your terminal in the PagePay project root and run:

```bash
cd backend
python scripts/run_prod_migration.py "YOUR_DATABASE_URL_HERE"
```

**Example:**
```bash
python scripts/run_prod_migration.py "postgresql://pagepay:abc123xyz@dpg-ct12abc.ohio-postgres.render.com/pagepay"
```

---

## Step 3: What You'll See

The script will output something like:

```
connecting as: pagepay:****@dpg-ct12abc.ohio-postgres.render.com/pagepay
running: alembic upgrade head

INFO  [alembic.runtime.migration] Running upgrade 010_add_user_auth_columns -> 011_fix_points_conversion_rate, Fix points conversion rate - divide by 100

done. the production schema is up to date.
```

---

## Step 4: Verify the Migration

### Check Current Migration Status:
```bash
cd backend
python scripts/run_prod_migration.py "YOUR_DATABASE_URL_HERE"
```

If already up to date, you'll see:
```
done. the production schema is up to date.
```

### Check User Balance (Optional):
You can verify your test user's balance was corrected by:

1. **Via API**: Call `GET /api/v1/auth/me` and check `points_balance`
2. **Via Database**: Use a PostgreSQL client to query:
   ```sql
   SELECT email, points_balance FROM users;
   ```

**Expected result:**
- If user had 100,000 points before → Now has 1,000 points (= ₦100)
- If user had 10,000 points before → Now has 100 points (= ₦10)

---

## Step 5: Test the System

### Test Wallet Funding:
1. Open your frontend app
2. Navigate to "Fund Wallet"
3. Select ₦500
4. Verify it shows **5,000 pts** (not 50,000 pts) ✅

### Test Bills Payment:
1. Try to buy ₦100 airtime
2. Should see estimated points: **~20 pts** (from commission)
3. Should cost: **1,000 pts** to purchase ✅

### Test Ad Rewards:
1. Watch a rewarded ad
2. Check points earned
3. Should be small amounts (like 9-10 points per ad) ✅

---

## Troubleshooting

### Error: "Can't connect to database"
- ✅ Check you're using the **External** Database URL (not Internal)
- ✅ Verify the URL includes the full host: `dpg-xxxxx.ohio-postgres.render.com`
- ✅ Check your internet connection

### Error: "Migration already applied"
- ✅ This is normal if you run the command twice
- ✅ Check user balance to confirm it was applied

### Points balance looks wrong after migration
**Example issue:** User had 100,000 points, now has 1,000 points

**Check:**
1. What was their original balance before migration 009? 
   - If it was 10,000 → 1,000 is correct (₦100 in new system)
2. Calculate: `current_balance ÷ 10 = naira value`
   - 1,000 ÷ 10 = ₦100 ✅

---

## Rollback (Emergency Only)

**⚠️ WARNING**: Only use this if something went seriously wrong!

To rollback migration 011:

```bash
cd backend
alembic downgrade -1
```

This will multiply balances by 100 again (returning to the incorrect state).

---

## What Happens Next?

After migration 011 is applied:

1. ✅ **All user balances are corrected** (divided by 100)
2. ✅ **Frontend displays correct point amounts**
3. ✅ **All backend calculations use 10:1 ratio**
4. ✅ **Documentation is consistent**

### Deploy Frontend:
Once you verify backend is working:
```bash
cd client
# Your normal deployment process
```

---

## Quick Checklist

Before running migration:
- [ ] Copied External Database URL from Render
- [ ] Understand migration will divide balances by 100
- [ ] Ready to test after migration

After running migration:
- [ ] Migration completed successfully
- [ ] User balance is now 1/100th of previous value
- [ ] Frontend shows correct point amounts
- [ ] Tested wallet funding (₦500 = 5,000 pts)
- [ ] Tested bills payment (correct point costs)

---

## Need Help?

If you run into issues:

1. Check `CONVERSION_RATE_FIX_SUMMARY.md` for detailed explanation
2. Review `MIGRATION_011_DECISION.md` for migration logic
3. Check Render logs for backend errors
4. Verify migration status with `alembic current`

---

## Ready? Run This Command:

```bash
cd backend
python scripts/run_prod_migration.py "YOUR_EXTERNAL_DATABASE_URL_HERE"
```

Replace `YOUR_EXTERNAL_DATABASE_URL_HERE` with the URL from Render dashboard.

**That's it!** Migration 011 will run and fix the conversion rate. 🎉
