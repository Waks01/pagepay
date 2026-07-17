# Immediate Actions for Render Deployment

## Backend is Ready ✅
- `requirements.txt` updated: `aiomysql` → `asyncpg`
- `render.yaml` created for auto-configuration
- `Procfile` created for process management
- `.dockerignore` created to exclude unnecessary files
- Deployment guide created: `RENDER_DEPLOYMENT_GUIDE.md`

## You Need to Do These 4 Steps

### 1. PUSH TO GITHUB
```bash
cd c:\Users\kenik\OneDrive\Desktop\pagepay
git add -A
git commit -m "feat: prepare backend for Render deployment with PostgreSQL"
git push origin main
```

### 2. CREATE WEB SERVICE ON RENDER
- Go to [render.com](https://render.com)
- New → Web Service
- Connect to your GitHub repo
- Root Directory: `backend/`
- Select the free plan
- Click "Create Web Service"

### 3. LINK POSTGRESQL DATABASE
- In Render dashboard, open your Web Service
- Go to Environment variables
- Add `DATABASE_URL`
- Click "From Database" and select your existing `pagepay` PostgreSQL
- Auto-fills the connection string ✓

### 4. ADD ENVIRONMENT VARIABLES
Copy these from `backend/.env` into Render dashboard:
- `PAYSTACK_SECRET_KEY`
- `PAYSTACK_PUBLIC_KEY`
- `PAYSTACK_WEBHOOK_SECRET`
- `GEMINI_API_KEY`
- `GROQ_API_KEY`
- `OPENROUTER_API_KEY`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

Also set these new ones:
- `ADMIN_TOKEN` = `dev-admin-token`
- `PUBLIC_BASE_URL` = `https://pagepay-backend.onrender.com`
- `CORS_ORIGINS` = `https://pagepay-admin.onrender.com,http://localhost:3000`

## After Deployment

Once Render shows "Your service is live":

1. **Copy the backend URL** (looks like `https://pagepay-backend.onrender.com`)
2. **Update admin panel** - Change all `/api/v1` calls to use the Render URL
3. **Update client app** - Do the same
4. **Test login** - Should work with PostgreSQL backend now

## Estimated Time
- Push to GitHub: 2 minutes
- Render setup: 5 minutes
- Variables: 5 minutes
- Deployment: 10 minutes (watch the logs)
- **Total: ~25 minutes**

## Current Docker Status
Once everything works on Render, you can safely:
- `docker-compose down` (stop local containers)
- Delete local MySQL data volume if needed
- Work with production backend instead of localhost

No more fighting Docker zombie processes! ✅
