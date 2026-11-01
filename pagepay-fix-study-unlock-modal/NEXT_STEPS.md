# Next Steps - Notifications Testing

## 🎯 What You Need to Do Now

### **Step 1: Install Dependencies** (2 minutes)
```bash
cd client
npm install
```

### **Step 2: Rebuild the App** (10 minutes)
```bash
# Clean previous builds
npx expo prebuild --clean

# Build and run on Android
npx expo run:android
```

### **Step 3: Run Backend Migration** (1 minute)
```bash
cd backend

# Run migration to create notification tables
alembic upgrade head

# Install Firebase Admin SDK
pip install firebase-admin
```

### **Step 4: Test the Flow** (5 minutes)
1. Open the app on your device
2. Login (FCM token will auto-register)
3. Go to Profile tab
4. Tap "Notifications" (no more "Coming soon"!)
5. Toggle settings and save
6. Verify settings saved (reload modal)

---

## 🧪 Testing Notifications

### **Option A: From Python Script** (Recommended)
Create `backend/test_notification.py`:
```python
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from app.config import settings
from app.services.fcm import initialize_firebase, send_task_alert

async def test():
    initialize_firebase()
    engine = create_async_engine(settings.database_url)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with async_session() as db:
        await send_task_alert(db, user_id=1, task_title="Test Task", reward_amount=500)

asyncio.run(test())
```

Run it:
```bash
cd backend
python test_notification.py
```

### **Option B: From Python REPL**
```bash
cd backend
python
```

```python
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from app.config import settings
from app.services.fcm import initialize_firebase, send_push_notification

async def send_test():
    initialize_firebase()
    engine = create_async_engine(settings.database_url)
    async_session = sessionmaker(engine, class_=AsyncSession)
    
    async with async_session() as db:
        result = await send_push_notification(
            db=db,
            user_id=1,  # Replace with your user ID
            title="🎉 Test Notification",
            body="This is a test from PagePay!",
            category="task_alerts"
        )
        print(result)

asyncio.run(send_test())
```

---

## ✅ Success Checklist

- [ ] App rebuilt successfully
- [ ] Backend migration ran
- [ ] Logged in on device
- [ ] Console shows "FCM token registered successfully"
- [ ] Can open Notification Settings modal
- [ ] Can toggle preferences and save
- [ ] Sent test notification from backend
- [ ] Notification appeared on device
- [ ] Tapping notification opens app

---

## 🚨 If Something Goes Wrong

### **Build Errors**
```bash
# Clear everything
cd client
rm -rf node_modules android ios .expo
npm install
npx expo prebuild --clean
npx expo run:android
```

### **FCM Token Not Registering**
1. Check console logs in app
2. Verify `google-services.json` exists
3. Verify package name matches Firebase console
4. Check notification permissions granted

### **Backend Error: "firebase-admin not found"**
```bash
cd backend
pip install firebase-admin
```

### **Backend Error: "firebase-service-account.json not found"**
- Verify file is in `backend/firebase-service-account.json`
- Check it's valid JSON
- Don't commit it to git!

---

## 📱 Expected User Flow

1. **User opens app** → FCM listeners start
2. **User logs in** → FCM token registered with backend
3. **User goes to Profile** → Sees "Notifications" row (no "Coming soon")
4. **User taps Notifications** → Modal opens with settings
5. **User toggles preferences** → Saved to backend
6. **Backend sends notification** → Checks preferences first
7. **Notification delivered** → User receives on device
8. **User taps notification** → App opens

---

## 🎉 What's Now Working

✅ **Backend:**
- Firebase Admin SDK integrated
- Notification preferences API
- FCM token management
- Smart notification sending (respects quiet hours & preferences)

✅ **Frontend:**
- Beautiful notification settings modal
- FCM token auto-registration
- Notification listeners
- Profile screen integration
- Permission handling

✅ **Features:**
- Master push toggle
- Category-specific toggles (study, tasks, referral, wallet, ads)
- Quiet hours with time pickers
- System permission warnings
- Multi-device support

---

**Ready to test?** Run the commands above and let me know how it goes!
