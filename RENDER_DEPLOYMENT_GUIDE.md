# Render Deployment Guide for PagePay Backend

## Current Status
- ✅ PostgreSQL database already provisioned on Render
- ✅ Backend code updated to use PostgreSQL (asyncpg driver)
- ✅ render.yaml created for deployment configuration
- ✅ Requirements updated: `aiomysql` → `asyncpg`

## What Changed

### 1. Database Driver
- **Before**: `aiomysql==0.2.0` (MySQL async driver)
- **After**: `asyncpg==0.30.0` (PostgreSQL async driver)
- **File**: `backend/requirements.txt`

### 2. Deployment Configuration
- Created `backend/render.yaml` — automatic service configuration
- Created `backend/Procfile` — process manager for Render
- Created `backend/.dockerignore` — excludes unnecessary files from build

### 3. Environment Variables (for Render dashboard)
Set these in your Render service environment:
- `DATABASE_URL` — automatically linked to your PostgreSQL instance
- `SECRET_KEY` — generated automatically (do not check in)
- `CORS_ORIGINS` — updated to include your Render URLs
- `PUBLIC_BASE_URL` — set to `https://pagepay-backend.onrender.com`
- `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, `PAYSTACK_WEBHOOK_SECRET` — copy from `.env`
- `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY` — copy from `.env`
- `CLOUDINARY_*` — copy from `.env`

## Deployment Steps

### Step 1: Push to GitHub
```bash
cd c:\Users\kenik\OneDrive\Desktop\pagepay
git add -A
git commit -m "feat: prepare backend for Render deployment with PostgreSQL"
git push origin main
```

### Step 2: Create Web Service on Render
1. Go to [render.com](https://render.com) dashboard
2. Click **+ New** → **Web Service**
3. Connect your GitHub repository (pagepay)
4. Configure:
   - **Name**: `pagepay-backend`
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r backend/requirements.txt`
   - **Start Command**: `gunicorn app.main:app -w 2 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:$PORT --timeout 120`
   - **Root Directory**: `backend/`
   - **Instance Type**: `Free`

### Step 3: Link PostgreSQL Database
1. In Render dashboard, find your **pagepay** PostgreSQL database
2. In the Web Service settings, click **Environment**
3. Add environment variable: `DATABASE_URL`
4. Click "From Database" and select your **pagepay** postgres instance
5. It will auto-fill the connection string

### Step 4: Add Sensitive Environment Variables
In the Web Service **Environment** section, add:
- `PAYSTACK_SECRET_KEY` = (from your `.env`)
- `PAYSTACK_PUBLIC_KEY` = (from your `.env`)
- `PAYSTACK_WEBHOOK_SECRET` = (from your `.env`)
- `GEMINI_API_KEY` = (from your `.env`)
- `GROQ_API_KEY` = (from your `.env`)
- `OPENROUTER_API_KEY` = (from your `.env`)
- `CLOUDINARY_CLOUD_NAME` = `dcr5v9f3c`
- `CLOUDINARY_API_KEY` = (from your `.env`)
- `CLOUDINARY_API_SECRET` = (from your `.env`)
- `ADMIN_TOKEN` = `dev-admin-token` (or generate new one)
- `CORS_ORIGINS` = `https://pagepay-admin.onrender.com,http://localhost:3000`
- `PUBLIC_BASE_URL` = `https://pagepay-backend.onrender.com`

### Step 5: Deploy
1. Click **Deploy** in Render dashboard
2. Watch the build logs (should take 5-10 minutes on first deploy)
3. Once "Your service is live" appears, copy the URL: `https://pagepay-backend.onrender.com`

### Step 6: Update Frontend API URLs
**Admin Panel** (`admin/src/lib/api.ts`):
```typescript
const API_BASE = 'https://pagepay-backend.onrender.com/api/v1'
```

**Client App** (`client/app/config.ts` or similar):
```typescript
const API_BASE = 'https://pagepay-backend.onrender.com/api/v1'
```

### Step 7: Test the Deployment
1. Login to admin panel with PostgreSQL backend
2. Check `/api/v1/auth/me` returns your user profile
3. Verify database queries work (list users, payments, etc.)

## Troubleshooting

### Build Fails
- Check build logs in Render dashboard
- Common issues:
  - Missing environment variables → add to service settings
  - Incorrect root directory → should be `backend/`
  - Python version mismatch → use Python 3.11+

### "cannot import name 'aiomysql'"
- This means requirements.txt wasn't updated properly
- Verify `asyncpg==0.30.0` is in `backend/requirements.txt`
- Trigger a manual redeploy in Render dashboard

### Database Connection Error
- Ensure `DATABASE_URL` is linked to your PostgreSQL instance
- Check PostgreSQL is healthy in Render dashboard
- Run migrations if needed (see next section)

### Migrations & Schema
If your Alembic migrations need to run on startup:
1. Update `backend/Dockerfile` start command to:
```bash
alembic upgrade head && gunicorn app.main:app ...
```

2. Or update `backend/Procfile`:
```
web: alembic upgrade head && gunicorn app.main:app ...
```

## Rollback
If deployment breaks:
1. Render dashboard → Web Service → Deployments
2. Find last working deployment
3. Click "Redeploy" on that deployment
4. Service rolls back to previous version

## Next Steps
- [ ] Deploy backend to Render
- [ ] Update admin panel to use Render API URL
- [ ] Update client app to use Render API URL
- [ ] Test login and admin features
- [ ] Move admin panel to Render (Render static site)
- [ ] Move client app to EAS Build with Expo

## Notes
- Free tier Render instances spin down after 15 min inactivity (cold starts ~5 sec)
- For production, upgrade to paid plan
- PostgreSQL free tier has limitations (10GB storage max)
- Recommend monitoring via Render logs → metrics
