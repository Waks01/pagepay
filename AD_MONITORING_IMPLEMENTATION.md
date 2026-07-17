# Ad Monitoring System Implementation Summary

## 🎯 **Overview**

Comprehensive ad monitoring and analytics system for PagePay's AdMob rewarded ads, including SSV callback logging, eCPM trending, fraud detection, and fill rate analytics.

---

## ✅ **What Was Built**

### **Backend (Python/FastAPI)**

#### **1. Database Models & Migration** (`021_ad_monitoring`)

**New Tables:**

- `ad_ssv_logs` - Logs ALL AdMob SSV callback attempts (success + failures)
  - Tracks: user_id, token, transaction_id, status, rejection_reason, points_credited
  - Indexes: user_id, token, status, created_at
- `ad_fill_rate_events` - Tracks ad lifecycle (requested → loaded → shown → completed)
  - Tracks: user_id, ad_request_id, ad_unit, stage, error_code
  - Indexes: user_id, ad_request_id, ad_unit, stage, created_at

**Modified Tables:**

- `ad_events` - Added index on `created_at` for faster time-based queries

**Migration File:** `backend/alembic/versions/021_ad_monitoring_tables.py`

---

#### **2. Updated SSV Callback Handler**

**File:** `backend/app/routers/ads.py`

**Changes:**

- Every SSV callback attempt (success/failure) is now logged to `ad_ssv_logs`
- Logs captured for:
  - ✅ Success (credited)
  - ❌ Signature verification failures
  - ⚠️ Expired tokens
  - ⚠️ Duplicate requests
  - ⚠️ User mismatches
  - ⚠️ Malformed custom_data
  - ⚠️ Unknown tokens
  - ⚠️ Non-rewarded units
  - ⚠️ Invalid reward amounts

**IMPORTANT:** AdMob SSV uses **ECDSA P-256** digital signatures (not HMAC-SHA256)

- Signature verified using Google's public keys from `gstatic.com/admob/reward/verifier-keys.json`
- Keys cached for 24 hours, auto-refresh on verification failure
- `admob_webhook_secret` config is **unused** (kept for backwards compatibility)

---

#### **3. New Admin API Endpoints**

**File:** `backend/app/routers/admin_ads.py`

| Endpoint                          | Description                     | Params                        |
| --------------------------------- | ------------------------------- | ----------------------------- |
| `GET /admin/ads/ssv-logs`         | Recent SSV callback logs        | status, user_id, hours, limit |
| `GET /admin/ads/ecpm-trending`    | Daily eCPM over time            | days                          |
| `GET /admin/ads/top-earners`      | Users with most ad rewards      | days, limit                   |
| `GET /admin/ads/unit-performance` | Per-unit stats (android vs ios) | days                          |
| `GET /admin/ads/suspicious-users` | Manual fraud query              | min_ads, hours                |
| `GET /admin/ads/fill-rate-funnel` | Ad lifecycle funnel metrics     | days, ad_unit                 |

---

#### **4. New Client-Facing Endpoint**

**File:** `backend/app/routers/ads.py`

**Endpoint:** `POST /api/v1/ads/fill-rate-event`

**Purpose:** Track ad lifecycle stages from the client

**Stages:**

- `requested` - User tapped "Watch Ad"
- `loaded` - Ad finished loading
- `shown` - Ad started playing
- `completed` - User finished watching
- `failed` - Ad failed to load/show

**Usage:** Client calls this at each stage with the same `ad_request_id` (client-generated UUID)

---

#### **5. New Response Schemas**

**File:** `backend/app/schemas/__init__.py`

- `AdSsvLogItem` - SSV callback log entry
- `EcpmTrendItem` - Daily eCPM data point
- `TopEarnerItem` - User with high earnings
- `UnitPerformanceItem` - Per-unit stats
- `SuspiciousUserItem` - Flagged user
- `FillRateFunnelItem` - Fill rate metrics

---

#### **6. Config Documentation Fix**

**File:** `backend/app/config.py`

**Updated:** `admob_webhook_secret` comment to correctly state:

- AdMob uses **ECDSA P-256** signature verification with public keys
- NOT HMAC-SHA256 with shared secret
- Field kept for backwards compatibility / future use

---

### **Frontend Admin Dashboard (React/TypeScript)**

#### **7. New Feature: Ad Analytics Dashboard**

**Location:** `admin/src/features/ads/`

**Components:**

1. **AdDashboardPage.tsx** - Main container page
   - Displays metrics overview
   - Coordinates all sub-components
2. **EcpmTrendChart.tsx** - Line chart of daily eCPM
   - Uses D3 for rendering
   - 30-day trending view
   - Shows ₦ per 1000 impressions

3. **SsvLogTable.tsx** - SSV callback logs
   - Filterable by status (success, signature_failed, expired, etc.)
   - Time range selector (1h, 6h, 24h, 7d)
   - Shows rejection reasons

4. **TopEarnersTable.tsx** - Users with highest ad rewards
   - Ranked list with ads watched, points earned, NGN value
   - Time range selector (today, 7d, 30d)

5. **UnitPerformanceCard.tsx** - Per-unit breakdown
   - rewarded_android vs rewarded_ios stats
   - Shows ads watched, points, unique users, avg points/ad

6. **SuspiciousUsersTable.tsx** - Fraud detection query UI
   - Manual search with configurable thresholds
   - Default: flag users with >250 ads in 24h
   - Risk levels: 🟢 Normal (0-150), 🟡 Power User (151-200), 🟠 High (201-250), 🔴 Suspicious (251+)
   - Shows ads/hour, hours active, risk assessment

7. **FillRateFunnelCard.tsx** - Ad lifecycle funnel
   - Visual funnel: requested → loaded → shown → completed
   - Calculates load rate, show rate, completion rate
   - Health indicators (✅ Excellent, ⚠️ Fair, ❌ Poor)

---

#### **8. Routing & Navigation**

**Updated Files:**

- `admin/src/App.tsx` - Added `/ads` route
- `admin/src/shared/components/Sidebar.tsx` - Added "Ad Analytics" menu item (TrendingUp icon)

**Navigation:** Dashboard → **Ad Analytics** → [Ad Monitoring Dashboard]

---

## 🔧 **Configuration**

### **Fraud Detection Thresholds**

**Normal User:** 0-150 ads/day (75 sessions, 3,150 points, ₦315)

- 1 hour 15 minutes of reading
- Totally legitimate

**Power User:** 151-200 ads/day (100 sessions, 4,200 points, ₦420)

- 1 hour 40 minutes of reading
- Reasonable for engaged users

**Flag for Review:** 251+ ads/day

- Admin investigates manually via "Suspicious Users" query
- Adjustable thresholds: `min_ads` and `hours` params

**Per-Ad Reward:** 25 points × 0.85 (user share) = **21 points per ad**

- 2 ads per reading session (pre-read + post-read) = **42 points/session**

---

## 📊 **Key Metrics**

### **eCPM Calculation**

```
eCPM = (total_points_credited / ads_watched) × (₦1 / 10 points) × 1000
```

**Example:**

- 1000 ads watched
- 21,000 points credited
- eCPM = (21,000 / 1,000) × 0.1 × 1000 = **₦2,100 per 1000 impressions**

### **Fill Rate Funnel**

```
Requested (100%) → Loaded (90%) → Shown (85%) → Completed (80%)
```

- **Load Rate:** % of requests that successfully loaded an ad
- **Show Rate:** % of loaded ads that were shown to user
- **Completion Rate:** % of shown ads that user completed watching
- **Overall Completion:** requested → completed (end-to-end)

**Healthy Rates:**

- Load Rate: ≥90% ✅
- Completion Rate: ≥90% ✅ (rewarded ads have high completion)

---

## 🚀 **Deployment Steps**

### **1. Backend Migration**

```bash
cd backend
alembic upgrade head
```

**Note:** If you encounter `asyncio extension requires async driver` error, ensure you're using `psycopg2-binary` or `asyncpg` for PostgreSQL.

### **2. Restart Backend**

```bash
# Render will auto-deploy
# Or locally:
cd backend
uvicorn app.main:app --reload
```

### **3. Restart Admin Dashboard**

```bash
cd admin
npm run dev
```

### **4. Verify**

**Backend:**

- ✅ Visit `http://localhost:8000/docs` and check new endpoints under "admin-ads" tag
- ✅ Test SSV logging by triggering a test ad watch (signature verification test)

**Frontend:**

- ✅ Login to admin dashboard
- ✅ Navigate to "Ad Analytics" in sidebar
- ✅ Verify all cards load without errors

---

## 🔐 **Security Notes**

### **SSV Signature Verification**

- **ECDSA P-256** with SHA-256 hashing
- Public keys fetched from Google: `https://www.gstatic.com/admob/reward/verifier-keys.json`
- Keys cached for 24 hours
- Automatic key refresh on verification failure
- **401 Unauthorized** returned for invalid signatures (AdMob will retry)

### **Fraud Detection**

- Server-side verification prevents client-side reward tampering
- Token-based system (`AdRequest` table) prevents replay attacks
- User mismatch detection (token issued to user A, callback claims user B)
- Suspicious activity detection via manual admin queries (no auto-bans)

---

## 📝 **API Examples**

### **Get SSV Logs**

```bash
GET /admin/ads/ssv-logs?status=signature_failed&hours=24&limit=50
```

**Response:**

```json
[
  {
    "id": 123,
    "user_id": 456,
    "token": "abc123...",
    "transaction_id": "xyz789...",
    "ad_unit": "rewarded_android",
    "status": "signature_failed",
    "rejection_reason": "ECDSA P-256 signature verification failed",
    "points_credited": null,
    "created_at": "2026-07-16T12:34:56Z"
  }
]
```

### **Get Suspicious Users**

```bash
GET /admin/ads/suspicious-users?min_ads=250&hours=24
```

**Response:**

```json
[
  {
    "user_id": 789,
    "email": "user@example.com",
    "status": "active",
    "ads_watched": 300,
    "total_points": 6300,
    "first_ad": "2026-07-16T00:00:00Z",
    "last_ad": "2026-07-16T23:59:00Z",
    "hours_active": 8.5,
    "ads_per_hour": 35.3,
    "risk_level": "red"
  }
]
```

### **Log Fill Rate Event (Client)**

```typescript
// Client-side code
const adRequestId = generateUUID();

// Stage 1: User taps "Watch Ad"
await api.post("/api/v1/ads/fill-rate-event", null, {
  params: {
    ad_request_id: adRequestId,
    ad_unit: "rewarded_android",
    stage: "requested",
    session_id: currentSession.id,
  },
});

// Stage 2: Ad loaded
ad.addAdEventListener(AdEventType.LOADED, async () => {
  await api.post("/api/v1/ads/fill-rate-event", null, {
    params: {
      ad_request_id: adRequestId,
      ad_unit: "rewarded_android",
      stage: "loaded",
    },
  });
});

// Stage 3: Ad shown
await api.post("/api/v1/ads/fill-rate-event", null, {
  params: {
    ad_request_id: adRequestId,
    ad_unit: "rewarded_android",
    stage: "shown",
  },
});

// Stage 4: Ad completed
ad.addAdEventListener(AdEventType.EARNED_REWARD, async () => {
  await api.post("/api/v1/ads/fill-rate-event", null, {
    params: {
      ad_request_id: adRequestId,
      ad_unit: "rewarded_android",
      stage: "completed",
    },
  });
});

// Stage 5: Ad failed
ad.addAdEventListener(AdEventType.ERROR, async (error) => {
  await api.post("/api/v1/ads/fill-rate-event", null, {
    params: {
      ad_request_id: adRequestId,
      ad_unit: "rewarded_android",
      stage: "failed",
      error_code: error.code,
      error_message: error.message,
    },
  });
});
```

---

## 🎯 **Next Steps (Optional Enhancements)**

### **Not Implemented (Out of Scope)**

1. **AppLovin MAX Integration** - Deferred per project plan
2. **Automated Fraud Bans** - Manual review only (no cron job)
3. **Real-time Socket.io Alerts** - Can be added later for live notifications
4. **Native/Banner/Interstitial Tracking** - Only rewarded ads earn points (per spec)

### **Future Improvements**

1. **Email/Slack Alerts** - Notify admins when SSV signature failures spike
2. **Automated Reports** - Daily/weekly email with eCPM trends and top earners
3. **A/B Testing** - Test different reward amounts per unit
4. **Geographic Breakdown** - eCPM by city/state in Nigeria
5. **User Risk Scoring** - ML model to predict fraud likelihood

---

## 📚 **Documentation References**

- [AdMob SSV Official Docs](https://developers.google.com/admob/android/ssv)
- [ECDSA Signature Algorithm](https://en.wikipedia.org/wiki/Elliptic_Curve_Digital_Signature_Algorithm)
- [Nigerian Market eCPM Rates](admob_reality.md)

---

## ✅ **Testing Checklist**

### **Backend**

- [ ] Migration runs successfully (`alembic upgrade head`)
- [ ] SSV callback logs new events to `ad_ssv_logs`
- [ ] All new admin endpoints return data (or empty arrays for new deployments)
- [ ] Fill rate event endpoint accepts valid stages

### **Frontend**

- [ ] Admin can navigate to "Ad Analytics"
- [ ] All cards load without errors
- [ ] SSV log table filters work
- [ ] Top earners table shows data (if any users have watched ads)
- [ ] Suspicious users search returns results (with correct thresholds)
- [ ] eCPM chart renders (requires ≥2 days of data)

### **Integration**

- [ ] Client RewardedAd component calls fill rate endpoint at each stage
- [ ] SSV callback creates both `AdEvent` AND `AdSsvLog` entries
- [ ] Admin dashboard updates in near-real-time (30-60s stale time)

---

## 🎉 **Summary**

You now have a **comprehensive ad monitoring system** with:
✅ SSV callback logging (every attempt logged)
✅ eCPM trending charts (30-day view)
✅ Top earners leaderboard
✅ Per-unit performance breakdown
✅ Manual fraud detection with configurable thresholds
✅ Fill rate funnel analytics
✅ Admin dashboard with all visualizations

**All wired and integrated end-to-end** ✨
