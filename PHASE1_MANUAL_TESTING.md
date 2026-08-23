# Phase 1 Manual Testing & Migration Guide

Since automated testing isn't working in the current environment, here's how to manually verify and deploy Phase 1.

---

## ✅ Manual Verification Checklist

### 1. Files Created
Check these files exist:

```bash
# In backend/
- [ ] app/services/tier_benefits.py
- [ ] app/tier_benefits.json  
- [ ] alembic/versions/036_add_content_source_field.py
- [ ] scripts/backfill_content_sources.py
```

**Verification:** All files are present ✅

---

### 2. Files Modified
Check these files were updated:

```bash
# In backend/
- [ ] app/config.py (has premium_reading_multiplier, etc.)
- [ ] app/models/__init__.py (has content_source field)
- [ ] app/services/subscription.py (get_points_multiplier has activity_type)
- [ ] .env (has PREMIUM_READING_MULTIPLIER, etc.)
```

**Quick checks:**
```bash
# Check config.py
grep "premium_reading_multiplier" app/config.py

# Check models
grep "content_source" app/models/__init__.py

# Check subscription.py
grep "activity_type" app/services/subscription.py

# Check .env
grep "PREMIUM_READING_MULTIPLIER" .env
```

---

### 3. Environment Variables in .env

Verify your `backend/.env` has these lines:

```bash
# Premium multipliers
PREMIUM_READING_MULTIPLIER=2.0
PREMIUM_AD_MULTIPLIER=1.5
PREMIUM_TASK_MULTIPLIER=2.0
PREMIUM_DAILY_MULTIPLIER=2.0
PREMIUM_BILLS_MULTIPLIER=2.0

# Content sources
AD_FREE_CONTENT_SOURCES=openstax,openstax_textbook
AD_SUPPORTED_CONTENT_SOURCES=gutenberg,gnews,user_upload
DEFAULT_CONTENT_AD_BEHAVIOR=ad_supported

# Ad skip permissions
PREMIUM_CAN_SKIP_PRE_READ_ADS=true
PREMIUM_CAN_SKIP_POST_READ_ADS=true
PREMIUM_CAN_SKIP_FEED_ADS=true

# Config path
TIER_BENEFITS_JSON_PATH=tier_benefits.json
```

---

## 🗄️ Database Migration

### Step 1: Check Current Migration State

```bash
cd backend

# Activate virtual environment (Windows)
.venv\Scripts\activate

# Check current migration
alembic current

# Should show something like:
# 035_add_user_streaks_cols (head)
```

### Step 2: Run Migration

```bash
# Run the migration
alembic upgrade head

# Expected output:
# INFO  [alembic.runtime.migration] Running upgrade 035_add_user_streaks_cols -> 036_content_source, add_content_source_to_catalog
```

### Step 3: Verify Migration

```bash
# Connect to your database and check:
# Option 1: Using psql
psql $DATABASE_URL -c "\d content_catalog"

# Option 2: Using Python
python -c "from app.models import ContentCatalog; import inspect; print([m for m in dir(ContentCatalog) if 'content_source' in m])"
```

**Expected:** You should see `content_source` column in content_catalog table

---

## 📊 Backfill Content Sources

### Step 1: Dry Run (Safe)

```bash
cd backend
.venv\Scripts\activate

# Run dry-run to see what would change
python scripts/backfill_content_sources.py --dry-run
```

**Expected output:**
```
============================================================
Backfilling content_source for XXX rows
Dry run: True
============================================================

============================================================
Backfill Statistics
============================================================
Total rows:              XXX
Already set:             0
Detected Gutenberg:      YYY
Detected OpenStax:       ZZZ
...
```

### Step 2: Apply Backfill

```bash
# If dry-run looks good, apply changes
python scripts/backfill_content_sources.py

# Expected:
# ✅ Committed XXX updates to database
# ✅ Backfill complete!
```

---

## 🧪 Test Phase 1 Works

### Test 1: Config Loads

```bash
cd backend
.venv\Scripts\activate

python -c "from app.config import settings; print(f'Reading multiplier: {settings.premium_reading_multiplier}'); print(f'Ad multiplier: {settings.premium_ad_multiplier}')"
```

**Expected output:**
```
Reading multiplier: 2.0
Ad multiplier: 1.5
```

### Test 2: Tier Benefits Service

```python
# Create test file: test_manual.py
from app.services.tier_benefits import get_multiplier, is_content_ad_free
from app.models import UserTier

# Test multipliers
print("Free reading:", get_multiplier(UserTier.FREE, 'reading'))  # Should be 1.0
print("Premium reading:", get_multiplier(UserTier.PREMIUM_MONTHLY, 'reading'))  # Should be 2.0
print("Premium ad:", get_multiplier(UserTier.PREMIUM_MONTHLY, 'ad'))  # Should be 1.5

# Test content detection
print("OpenStax ad-free:", is_content_ad_free('openstax'))  # Should be True
print("Gutenberg ad-free:", is_content_ad_free('gutenberg'))  # Should be False
```

Run it:
```bash
python test_manual.py
```

**Expected output:**
```
Free reading: 1.0
Premium reading: 2.0
Premium ad: 1.5
OpenStax ad-free: True
Gutenberg ad-free: False
```

### Test 3: Subscription Service Integration

```python
# test_subscription.py
from app.services.subscription import get_points_multiplier
from app.models import User, UserTier
from datetime import datetime, timedelta

# Create mock premium user
user = User()
user.tier = UserTier.PREMIUM_MONTHLY
user.subscription_expires_at = datetime.utcnow() + timedelta(days=30)

# Test multipliers
print("Reading multiplier:", get_points_multiplier(user, 'reading'))  # 2.0
print("Ad multiplier:", get_points_multiplier(user, 'ad'))  # 1.5
print("Task multiplier:", get_points_multiplier(user, 'task'))  # 2.0
```

Run it:
```bash
python test_subscription.py
```

**Expected output:**
```
Reading multiplier: 2.0
Ad multiplier: 1.5
Task multiplier: 2.0
```

---

## 🚀 Deploy to Render

### Step 1: Add Environment Variables

1. Go to Render Dashboard → Your Backend Service → Environment
2. Add these 12 variables:

```
PREMIUM_READING_MULTIPLIER=2.0
PREMIUM_AD_MULTIPLIER=1.5
PREMIUM_TASK_MULTIPLIER=2.0
PREMIUM_DAILY_MULTIPLIER=2.0
PREMIUM_BILLS_MULTIPLIER=2.0
AD_FREE_CONTENT_SOURCES=openstax,openstax_textbook
AD_SUPPORTED_CONTENT_SOURCES=gutenberg,gnews,user_upload
DEFAULT_CONTENT_AD_BEHAVIOR=ad_supported
PREMIUM_CAN_SKIP_PRE_READ_ADS=true
PREMIUM_CAN_SKIP_POST_READ_ADS=true
PREMIUM_CAN_SKIP_FEED_ADS=true
TIER_BENEFITS_JSON_PATH=tier_benefits.json
```

3. Click "Save Changes"

### Step 2: Deploy

1. Commit and push to GitHub:
```bash
git add .
git commit -m "Phase 1: Premium infrastructure and config loader"
git push origin main
```

2. Render will auto-deploy

3. Monitor deployment logs for:
   - Migration 036 runs successfully
   - "Loaded tier benefits config v1.0.0" message

### Step 3: Run Backfill on Production

1. Open Render Shell (or SSH)
2. Run backfill:
```bash
python scripts/backfill_content_sources.py --dry-run
# Review output
python scripts/backfill_content_sources.py
```

---

## ✅ Success Criteria

Phase 1 is complete when:

- [x] All 4 files created
- [x] All 4 files modified  
- [x] All 12 .env variables added
- [ ] Migration runs successfully (alembic upgrade head)
- [ ] Backfill completes without errors
- [ ] tier_benefits.json loads on backend startup
- [ ] Config shows correct multiplier values
- [ ] No errors in backend logs

---

## 🐛 Troubleshooting

### Issue: Migration fails

**Error:** `revision 036_content_source not found`

**Fix:**
```bash
# Check migration file name matches
ls alembic/versions/ | grep 036

# Should see: 036_add_content_source_field.py
```

### Issue: tier_benefits.json not found

**Error:** `Tier benefits JSON not found at tier_benefits.json`

**Fix:** Check the file is at `backend/app/tier_benefits.json`

### Issue: Import errors

**Error:** `ModuleNotFoundError: No module named 'app.services.tier_benefits'`

**Fix:** 
```bash
# Make sure you're in backend directory
cd backend

# Activate venv
.venv\Scripts\activate

# Verify file exists
ls app/services/tier_benefits.py
```

### Issue: Backfill doesn't detect sources

**Solution:** Check the detection logic in `scripts/backfill_content_sources.py`. You may need to add more detection patterns for your specific data.

---

## 📝 After Phase 1 Complete

Once all tests pass:

1. ✅ Mark Phase 1 as complete
2. 🎯 Ready to start Phase 2: Apply Multipliers to Point Rewards
3. 📊 Monitor logs for any tier_benefits loading issues
4. 🔍 Check a few content_catalog rows have content_source populated

---

**Questions? Issues?**
- Check `PHASE1_COMPLETION_SUMMARY.md` for detailed info
- Review `PREMIUM_IMPLEMENTATION_ROADMAP.md` for full plan
