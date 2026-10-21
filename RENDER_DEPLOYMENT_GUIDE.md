# Render Deployment Guide for PagePay Backend

> **Updated Oct 2026.** The AI provider list below is stale — Gemini/Groq/
> OpenRouter were removed in commit `cd01eff`. The project now uses
> **Cloudflare Workers AI only**. The migration section is also important:
> **production does not run `alembic upgrade head` on deploy**, so a new
> migration must be applied manually or the app will crash on the columns
> it expects.

## Current Status
- ✅ PostgreSQL database on **Neon** (not Render — `DATABASE_URL` points at Neon; the app and local dev share it)
- ✅ Backend code uses PostgreSQL (asyncpg driver)
- ✅ `backend/render.yaml` created for deployment configuration
- ✅ Requirements updated: `aiomysql` → `asyncpg`
- ✅ Live service: `https://pagepay-fff6.onrender.com`

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
- `DATABASE_URL` — the Neon connection string (`postgresql+asyncpg://...`)
- `SECRET_KEY` — generated automatically (do not check in)
- `CORS_ORIGINS` — updated to include your Render URLs
- `PUBLIC_BASE_URL` — set to `https://pagepay-fff6.onrender.com`
- `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY` — copy from `.env`. Paystack signs webhooks with the **secret key**; there is no `PAYSTACK_WEBHOOK_SECRET`.
- `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` — **these replace `GEMINI_API_KEY` / `GROQ_API_KEY` / `OPENROUTER_API_KEY`**, which are gone. In `render.yaml` they are `sync: false`, so set them in the Render dashboard by hand.
- `CLOUDINARY_*` — copy from `.env`
- `ADMOB_*` — copy from `.env` (the SSV callback is registered on the AdMob rewarded unit as `https://pagepay-fff6.onrender.com/api/v1/study/ads/complete`)

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
- `CORS_ORIGINS` = `https://pagepay-fff6.onrender.com,http://localhost:3000`
- `PUBLIC_BASE_URL` = `https://pagepay-fff6.onrender.com`

### Step 5: Deploy
1. Click **Deploy** in Render dashboard
2. Watch the build logs (should take 5-10 minutes on first deploy)
3. Once "Your service is live" appears, copy the URL: `https://pagepay-fff6.onrender.com`

### Step 6: Update Frontend API URLs
**Admin Panel** (`admin/src/lib/api.ts`):
```typescript
const API_BASE = 'https://pagepay-fff6.onrender.com/api/v1'
```

**Client App** (`client/app/config.ts` or similar):
```typescript
const API_BASE = 'https://pagepay-fff6.onrender.com/api/v1'
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
- Ensure `DATABASE_URL` is the Neon connection string (`postgresql+asyncpg://...`)
- Check the Neon project is healthy
- Run migrations if needed (see next section)

### Migrations & Schema

**Production does not run `alembic upgrade head` on deploy.** `render.yaml`'s
`startCommand` is gunicorn only:

```yaml
startCommand: gunicorn app.main:app -w 2 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:$PORT --timeout 120 --graceful-timeout 30 --keep-alive 5
```

So a new migration must be applied by hand before the code that needs it
deploys. The usual sequence:

```bash
cd backend
$env:PYTHONPATH="."; python -m alembic upgrade head
```

This reads `DATABASE_URL` from `settings`, so with the local `.env` pointing
at Neon it applies to production.

**Do not** chain `alembic upgrade head &&` onto the start command as a
matter of course: if a migration fails the service will not boot at all.
Apply migrations as a separate step, then deploy.

Columns that the migration chain may not reach are also backfilled
idempotently at boot in `app/main.py` (`ADD COLUMN IF NOT EXISTS`) — see
`_ensure_critical_columns` and `_ensure_sow_job_progress_columns`. That is
the safety net, not a substitute for running the migration.

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
