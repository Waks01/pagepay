# PagePay Push Notifications Setup Guide

**Status:** Backend Complete ✅ | Firebase Setup In Progress ⏳ | Frontend Pending ⏸️

---

## ✅ Backend Complete (What I Just Built)

### 1. **Database Migration** 
`backend/alembic/versions/005_notification_preferences.py`

Creates two tables:
- `user_notification_preferences` - Stores notification settings per user
- `fcm_tokens` - Stores Firebase Cloud Messaging tokens per device

### 2. **API Endpoints**
`backend/app/routers/notifications.py`

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v1/notifications/preferences` | GET | Get notification settings |
| `/api/v1/notifications/preferences` | PUT | Update notification settings |
| `/api/v1/notifications/fcm-token` | POST | Register device FCM token |
| `/api/v1/notifications/fcm-token/{token}` | DELETE | Deregister device |
| `/api/v1/notifications/fcm-tokens` | GET | List user's devices |

### 3. **Firebase Service Layer**
`backend/app/services/fcm.py`

Functions:
- `send_push_notification()` - Send to single user
- `send_bulk_push_notification()` - Send to multiple users
- `send_study_reminder()` - Study-specific notification
- `send_task_alert()` - Task-specific notification
- `send_referral_bonus()` - Referral-specific notification
- `send_wallet_update()` - Wallet-specific notification
- `send_ad_reward()` - Ad reward-specific notification

### 4. **Config & Dependencies**
- Added `FIREBASE_SERVICE_ACCOUNT_PATH` to `app/config.py`
- Added `firebase-admin==6.5.0` to `requirements.txt`
- Registered router in `app/main.py`

---

## ⏳ Firebase Setup (What You're Doing Now)

### Steps to Complete:

#### 1. Create Firebase Project
1. Go to https://console.firebase.google.com/
2. Click "Add project"
3. Name it "PagePay" (or your preferred name)
4. Disable Google Analytics (optional for now)
5. Click "Create project"

#### 2. Add Android App
1. In Firebase Console → Project Settings
2. Click "Add app" → Android icon
3. **Android package name:** `com.pagepay.app` (or your actual package name from `app.json`)
4. Download `google-services.json`
5. Save to: `client/google-services.json`

#### 3. Add iOS App
1. In Firebase Console → Project Settings
2. Click "Add app" → iOS icon
3. **iOS bundle ID:** `com.pagepay.app` (or your actual bundle ID from `app.json`)
4. Download `GoogleService-Info.plist`
5. Save to: `client/GoogleService-Info.plist`

#### 4. Get Service Account JSON (for Backend)
1. Firebase Console → Project Settings → Service accounts
2. Click "Generate new private key"
3. Download the JSON file
4. Save to: `backend/firebase-service-account.json`
5. Add to `.gitignore` (never commit this file!)

---

## ⏸️ Frontend Setup (Next Steps - After Firebase is Ready)

### 1. Install Dependencies
```bash
cd client
npx expo install @react-native-firebase/app @react-native-firebase/messaging expo-notifications
```

### 2. Configure Firebase in app.json
Add to `client/app.json`:
```json
{
  "expo": {
    "android": {
      "googleServicesFile": "./google-services.json"
    },
    "ios": {
      "googleServicesFile": "./GoogleService-Info.plist"
    },
    "plugins": [
      "@react-native-firebase/app",
      [
        "expo-notifications",
        {
          "icon": "./assets/icon.png",
          "color": "#00D9A0"
        }
      ]
    ]
  }
}
```

### 3. Create Notification Service
`client/src/lib/notifications.ts` - Handles:
- Request permissions
- Get FCM token
- Register token with backend
- Listen for notifications

### 4. Create NotificationSettingsModal
`client/components/NotificationSettingsModal.tsx` - UI for:
- Master push toggle
- Per-category toggles
- Quiet hours time pickers

### 5. Update Profile Screen
Replace the "Coming soon" alert with actual modal

---

## 🧪 Testing Plan

### Backend Tests
```bash
cd backend

# Run migration
alembic upgrade head

# Test endpoints
curl -X GET http://localhost:8000/api/v1/notifications/preferences \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Frontend Tests (After Setup)
1. Request notification permissions
2. Verify FCM token is sent to backend
3. Send test notification from backend
4. Verify notification appears on device
5. Test preference toggles
6. Test quiet hours

---

## 📋 Environment Variables Needed

### Backend `.env`
```env
# Add this line
FIREBASE_SERVICE_ACCOUNT_PATH=firebase-service-account.json
```

### Frontend (no new env vars needed)

---

## 🚀 Deployment Checklist

### Development
- [ ] Firebase project created
- [ ] `google-services.json` downloaded
- [ ] `GoogleService-Info.plist` downloaded
- [ ] Service account JSON downloaded
- [ ] Backend migration run
- [ ] Backend dependencies installed
- [ ] Frontend dependencies installed
- [ ] Test notification sent successfully

### Production
- [ ] Firebase project mode: Production
- [ ] Service account JSON in production server
- [ ] Environment variable `FIREBASE_SERVICE_ACCOUNT_PATH` set
- [ ] APNs certificates configured (iOS)
- [ ] Test notifications on production

---

## 📞 Support Resources

### Firebase Documentation
- FCM Setup: https://firebase.google.com/docs/cloud-messaging
- React Native Firebase: https://rnfirebase.io/
- Expo Notifications: https://docs.expo.dev/versions/latest/sdk/notifications/

### Troubleshooting
- **Notifications not arriving:** Check FCM token is registered and active
- **iOS not working:** Verify APNs certificates and bundle ID
- **Android not working:** Verify package name matches `google-services.json`
- **Permissions denied:** Check device settings and app permissions

---

## 🎯 Next Immediate Actions

**For You (Firebase Setup):**
1. Create Firebase project ✅
2. Add Android app + download `google-services.json` ✅
3. Add iOS app + download `GoogleService-Info.plist` ✅
4. Generate service account JSON ✅
5. Place files in correct locations ✅

**For Me (After Your Firebase Setup):**
1. Create notification service (`client/src/lib/notifications.ts`)
2. Create NotificationSettingsModal UI
3. Wire up profile screen
4. Test end-to-end flow

---

**Current Status:** Waiting for Firebase setup completion before proceeding to frontend implementation.

**Estimated Time Remaining:** 
- Firebase setup: 15-20 minutes (you)
- Frontend implementation: 2-3 hours (me)
- Testing: 30 minutes

**Total:** ~3-4 hours to complete notifications feature
