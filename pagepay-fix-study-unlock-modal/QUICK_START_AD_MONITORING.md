# 🚀 Quick Start: Ad Monitoring System

## ✅ **What Was Built**

Complete ad monitoring system with:

- 📊 SSV callback logging (every AdMob callback tracked)
- 📈 eCPM trending charts
- 🏆 Top earners leaderboard
- 🎯 Per-unit performance (Android vs iOS)
- 🚨 Fraud detection (manual query)
- 🔄 Fill rate funnel analytics
- 🎨 Full admin dashboard UI

---

## 🔧 **Quick Deployment**

### **Step 1: Run Database Migration**

```bash
cd backend
alembic upgrade head
```

**Expected Output:**

```
INFO  [alembic.runtime.migration] Running upgrade 020_openstax_sentinels_version -> 021_ad_monitoring, Add ad monitoring tables
```

### **Step 2: Restart Backend**

```bash
# If using Render: Auto-deploys on git push
# If local:
uvicorn app.main:app --reload
```

### **Step 3: Start Admin Dashboard**

```bash
cd admin
npm run dev
```

### **Step 4: Access Admin Dashboard**

1. Open admin dashboard (http://localhost:5173 or your Render URL)
2. Login with admin credentials
3. Click **"Ad Analytics"** in the left sidebar
4. You should see the new dashboard! 🎉

---

## 📊 **What You'll See**

### **Metrics Overview Cards**

- Total Ads (7d)
- Points Credited (7d)
- Active Users (7d)
- Current eCPM (NGN)

### **eCPM Trending Chart**

- 30-day line chart
- Shows daily eCPM in ₦ per 1000 impressions

### **Ad Unit Performance**

- rewarded_android stats
- rewarded_ios stats
- Ads watched, points, unique users, avg points/ad

### **Top Earners Table**

- Ranked users by ad rewards
- Shows email, ads watched, points earned, NGN value

### **SSV Callback Logs**

- Recent AdMob SSV callbacks
- Filter by status: success, signature_failed, expired, etc.
- Shows rejection reasons for failures

### **Fill Rate Funnel**

- Visual funnel: requested → loaded → shown → completed
- Load rate, show rate, completion rate percentages
- Health indicators

### **Suspicious Users Detection**

- Manual query with configurable thresholds
- Default: flag users with >250 ads in 24 hours
- Risk levels: 🟢 Normal, 🟡 Power User, 🟠 High, 🔴 Suspicious

---

## 🧪 **Testing**

### **Verify Backend Endpoints**

```bash
# Visit Swagger docs
http://localhost:8000/docs

# Look for new endpoints under "admin-ads" tag:
GET /admin/ads/ssv-logs
GET /admin/ads/ecpm-trending
GET /admin/ads/top-earners
GET /admin/ads/unit-performance
GET /admin/ads/suspicious-users
GET /admin/ads/fill-rate-funnel
```

### **Verify SSV Logging**

1. Trigger a test rewarded ad watch in the client app
2. Check backend logs for: `"AdMob SSV credit: user=..."`
3. Query SSV logs in admin dashboard
4. Should see new entry with status="success"

### **Test Fraud Detection**

1. In admin dashboard, go to **"Suspicious Activity Detection"**
2. Set threshold: min_ads=10, hours=24
3. Click **"Search"**
4. Should see users who watched ≥10 ads in last 24 hours

---

## 🎯 **Fraud Detection Thresholds**

### **Recommended Limits**

| Usage Level    | Ads/24h | Sessions/24h | Points/24h  | Risk      |
| -------------- | ------- | ------------ | ----------- | --------- |
| **Normal**     | 0-150   | 0-75         | 0-3,150     | 🟢 Green  |
| **Power User** | 151-200 | 76-100       | 3,150-4,200 | 🟡 Yellow |
| **High Usage** | 201-250 | 101-125      | 4,200-5,250 | 🟠 Orange |
| **Suspicious** | 251+    | 126+         | 5,250+      | 🔴 Red    |

### **Per-Ad Economics**

- Reward per ad: 25 points × 0.85 (user share) = **21 points**
- 2 ads per reading session (pre-read + post-read) = **42 points/session**
- 10 points = ₦1

### **Example: 200 Ads/Day (Power User Cap)**

- 200 ads = 100 reading sessions
- 100 sessions × 42 points = 4,200 points
- 4,200 points ÷ 10 = **₦420 earned/day**
- Reading time: ~1 hour 40 minutes

---

## 🔍 **Monitoring Best Practices**

### **Daily Checks**

1. **SSV Callback Health**
   - Check for signature failures (should be <1%)
   - Investigate expired tokens (may indicate slow ad loading)

2. **eCPM Trends**
   - Monitor daily eCPM (should be ₦0.30-₦4.50 in Nigeria)
   - Alert if eCPM drops >30% day-over-day

3. **Top Earners**
   - Review top 20 earners daily
   - Flag anyone with >250 ads/day

4. **Fill Rate**
   - Load rate should be ≥90%
   - Completion rate should be ≥90% (rewarded ads)
   - Overall completion ≥80%

### **Weekly Reviews**

1. **Fraud Patterns**
   - Run suspicious users query with min_ads=200
   - Investigate red-flagged users
   - Check for IP clustering (multiple accounts)

2. **Unit Performance**
   - Compare Android vs iOS performance
   - Identify underperforming units

3. **Revenue Reconciliation**
   - Compare admin dashboard totals with AdMob dashboard
   - Verify points credited match expected rewards

---

## 🐛 **Troubleshooting**

### **"No data available" in dashboard**

**Cause:** New deployment, no ad events yet

**Solution:** Wait for users to watch ads, or manually test with client app

---

### **SSV logs show "signature_failed"**

**Cause:** AdMob sent callback with invalid signature

**Possible Issues:**

1. Public keys need refresh (auto-retries)
2. AdMob test vs production unit ID mismatch
3. Network tampering (unlikely with HTTPS)

**Solution:** Check `raw_query_params` in SSV log entry for debugging

---

### **Fill rate funnel shows "0 requested"**

**Cause:** Client not calling fill rate endpoint yet

**Solution:** Implement fill rate tracking in client RewardedAd component (see AD_MONITORING_IMPLEMENTATION.md)

---

### **eCPM chart is flat/empty**

**Cause:** Need ≥2 days of data for line chart

**Solution:** Wait 2 days after deployment, or use smaller time range (7 days)

---

## 📞 **Support**

### **Backend Issues**

- Check `/admin/ads/*` endpoint responses in Swagger docs
- Verify `ad_ssv_logs` and `ad_fill_rate_events` tables exist
- Check backend logs for errors

### **Frontend Issues**

- Check browser console for API errors
- Verify admin user has `dashboard.view` permission
- Check React Query dev tools for failed queries

### **Data Issues**

- SSV not logging: Verify `admob_ssv_callback()` was updated
- No top earners: No users have watched ads yet
- Empty suspicious users: Good! No fraud detected

---

## 🎉 **You're All Set!**

The ad monitoring system is **fully integrated and ready to use**. Start monitoring your AdMob performance, track eCPM trends, and detect fraud patterns! 🚀

### **Key Files Modified:**

**Backend:**

- ✅ `backend/app/models/__init__.py` - New models
- ✅ `backend/alembic/versions/021_ad_monitoring_tables.py` - Migration
- ✅ `backend/app/routers/ads.py` - SSV logging + fill rate endpoint
- ✅ `backend/app/routers/admin_ads.py` - New analytics endpoints
- ✅ `backend/app/schemas/__init__.py` - New response models
- ✅ `backend/app/config.py` - Fixed admob_webhook_secret docs

**Frontend:**

- ✅ `admin/src/features/ads/` - 8 new files (dashboard + components)
- ✅ `admin/src/App.tsx` - Added /ads route
- ✅ `admin/src/shared/components/Sidebar.tsx` - Added nav link

**Documentation:**

- ✅ `AD_MONITORING_IMPLEMENTATION.md` - Full implementation details
- ✅ `QUICK_START_AD_MONITORING.md` - This file
