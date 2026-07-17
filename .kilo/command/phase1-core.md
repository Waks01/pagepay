# Command: Phase 1 — Read-to-Earn Core

**Duration:** Weeks 1–3
**Agent:** Backend + Frontend
**Goal:** Ship a functional read-to-earn app to Play Store using free content (Gutendex + GNews).

---

## Shared Pre-Work
1. Create GitHub repo `pagepay` with branch `main`
2. Set up `FEATURE_BRANCH=phase-1` for all work-merge to main after approval
3. Create `.env.example` in backend root
4. Approve PR with CI green before merge

---

## Backend Tasks

### Step 1: Project Scaffolding
- Initialize FastAPI project:
  ```
  mkdir app && cd app
  mkdir -p routers models schemas services
  touch __init__.py main.py database.py
  ```
- `requirements.txt`: `fastapi uvicorn[standard] gunicorn sqlalchemy[asyncio] asyncpg aio-mysql psycopg2-binary pydantic python-jose[cryptography] passlib[bcrypt] python-multipart aiofiles alembic httpx tenacity slowapi`
- `requirements-dev.txt`: add `pytest pytest-asyncio pytest-cov`

### Step 2: Database Setup
- Create `app/database.py`:
  - `DATABASE_URL = "postgresql+asyncpg://user:pass@host:5432/pagepay"` for production (PostgreSQL 18 on Render)
  - `create_async_engine` with `pool_size=20, pool_recycle=1800`
  - `pool_pre_ping` defaults to `False`; set to `True` if stale-connection errors appear in production
  - `get_db` async generator with `AsyncSession`
- Run `alembic init alembic` and configure `env.py` for async
- Create initial migration with all models from `roadmap.md`:
  - `User`, `ReadingSession`, `ContentCatalog`, `AdEvent`
  - `User.tier` Enum: FREE, PREMIUM_MONTHLY, PREMIUM_YEARLY
  - Indexes: `user_id`, `content_id`, `created_at` on relevant tables
  - User includes referral fields: `referral_code`, `referred_by`, `referrals_today_count`

### Step 3: Auth Endpoints
- `POST /api/v1/auth/register`:
  - Request: `{email/phone, password, referral_code?}`
  - Validate unique email/phone
  - Validate referral code if provided
  - Generate unique 6-char referral code for new user
  - Hash password with bcrypt
  - Create user with `points_balance=0`, `tier=FREE`
  - Return `{access_token, token_type: "bearer"}`
- `POST /api/v1/auth/login`:
  - Request: `{email/phone, password}` (OAuth2PasswordRequestForm)
  - Verify hash
  - JWT encode `sub=user.id`, expiry 7 days
  - Return token
- `GET /api/v1/auth/me`:
  - Return `{id, email, phone, points_balance, tier, created_at, is_worker, is_sponsor}`
- `POST /api/v1/auth/change-password`:
  - Request: `{current_password, new_password}`
  - Verify current password, update hash
- `POST /api/v1/auth/forgot-password`:
  - Generate one-time reset token with expiry
  - In production: send email/SMS (for dev: return token)
- `POST /api/v1/auth/reset-password`:
  - Validate token, update password, mark token used
- `POST /api/v1/auth/logout`:
  - No-op 204 response (stateless JWT, Phase 4 adds revocation list)
- Rate limit: 5 attempts per 15 minutes per IP on login (use `slowapi`)

### Step 4: Content API
- Content extraction services:
  - `services/content/gutendex.py` — fetch from `gutendex.com/books`
  - `services/content/gnews.py` — fetch from GNews API (free key)
  - `services/content/rss.py` — fetch from generic RSS feeds
- Admin endpoint: `POST /api/v1/admin/content/import`
  - Query params: `?source=gutenberg&limit=50`
  - Fetches, normalizes, bulk inserts into `content_catalog`
  - Skips duplicates (check `source_url` unique index)
- Public endpoints:
  - `GET /api/v1/content/catalog?category=fiction&page=1&limit=20`
  - `GET /api/v1/content/{id}` → returns full `body_text` + metadata

### Step 5: Reading Engine
- Start: `POST /api/v1/session/start`:
  - Auth required
  - Request: `{content_id}`
  - Creates `ReadingSession` with `start_time=now()`
  - Returns `{session_id}`
- Heartbeat: `POST /api/v1/session/heartbeat`:
  - Auth required
  - Request: `{session_id, scroll_events: number, app_state: string}`
  - If `app_state=="background"` or `scroll_events==0` → set `timer_paused=true`
  - Else → `timer_paused=false`, increment `scroll_events`
  - Returns `{paused: bool, duration_seconds: int}`
- End: `POST /api/v1/session/end`:
  - Auth required
  - Request: `{session_id}`
  - Calculates `duration_seconds` from start/end time
  - Validates `verified=true` (scroll events > 0)
  - Awards points: `points = max(0, (effective_duration // 600) * 5)` — floor division, as implemented
  - Stages `pending_points` on the row for post-read ad claim

### Step 6: Dockerize
- `Dockerfile` with multi-stage build (see devops agent spec)
- `docker-compose.yml` with FastAPI + PostgreSQL
- `.dockerignore` with `__pycache__`, `.git`, `.env`, `alembic/versions/*.py` (migrations handled separately)
- Verify: `docker compose up --build` → visit `http://localhost:8000/api/v1/health`

### Step 7: Testing
- Write tests in `tests/`:
  - `test_auth.py` — register, login, duplicate email, wrong password
  - `test_reading.py` — start session, heartbeat, end, point calculation
  - `test_content.py` — catalog fetch, content retrieval
  - `test_anti_cheat.py` — zero scroll events pauses timer
- Run: `pytest tests/ --cov=app --cov-report=term`
- Target: 80% coverage minimum

### Step 8: Deploy
- Deploy backend to Render.app with PostgreSQL 18 database
- Run migrations via `alembic upgrade head`
- Verify health endpoint returns `{"status": "ok"}`
- Store production DB URL in Render environment variables

---

## Frontend Tasks

### Step 1: Project Initialization
```bash
npx create-expo-app@latest pagepay --template blank-typescript
cd pagepay
npx expo install expo-router expo-status-bar expo-secure-store expo-app-state
npx expo install expo-image expo-document-picker expo-sharing expo-localization
npx expo install @shopify/flash-list react-native-reanimated
npx expo install @tanstack/react-query zustand react-native-mmkv
npx expo install expo-dev-client  # Required for native modules in Phase 2+
# Use Expo SDK 54+
```

### Step 2: Folder Structure
- Create `app/` directory with `(auth)/`, `(tabs)/`, `reader/`, `pin/`
- Create `src/features/study/` and `src/shared/`
- Set up `src/shared/api/client.ts` with base fetch wrapper + JWT interceptor
- Set up `src/shared/lib/storage.ts` with `expo-secure-store` helpers (NOT MMKV)
- Set up `src/shared/lib/preferences.ts` for theme/language/biometric/onboarding state
- NOTE: `src/shared/lib/constants.ts` does not exist yet; API_URL is currently inline in `client.ts`

### Step 3: API Client
- `client.ts`:
  - Base URL from `constants.ts` (dev vs prod)
  - Interceptor: attach `Authorization: Bearer <token>` from MMKV
  - Interceptor: on 401, clear tokens and redirect to `/login`
- Generate TypeScript types from backend Pydantic models (manual or via OpenAPI)

### Step 4: Auth Screens
- Login screen (`app/(auth)/login.tsx`):
  - Email/phone + password fields
  - Login button → calls `POST /api/v1/auth/login`
  - Store token in `expo-secure-store`, navigate to `/(tabs)/`
  - Token + refresh token stored via `saveToken`/`saveRefreshToken`
  - Error display for invalid credentials
- Register screen (`app/(auth)/register.tsx`):
  - Phone/email + password + confirm password
  - Calls `POST /api/v1/auth/register`
  - Auto-login after registration

### Step 5: Tab Navigation (Catalog)
- `app/(tabs)/_layout.tsx`: `<Tabs />` with 4 tabs (Home, Catalog, Study, Wallet)
- Catalog screen (`app/(tabs)/catalog.tsx`):
  - `useQuery` to fetch `GET /api/v1/content/catalog`
  - Render `ScrollView` of book cards + in-feed `NativeAdBanner` every 4th item
  - `FlashList` is NOT currently used; consider migrating long feeds
  - Filter chips: Fiction | Non-Fiction | News | Classics
  - Pull-to-refresh
- Book detail tap → navigate to `/reader/{id}`

### Step 6: Reader Screen
- `app/reader/[id].tsx`:
  - Fetch `GET /api/v1/content/{id}` on mount
  - Render title, author, body_text in `<ScrollView>` or `<FlashList>`
  - Start session: `POST /api/v1/session/start` on mount
  - Heartbeat: `setInterval` every 10s calling `POST /api/v1/session/heartbeat`
    - Payload: `{ session_id, scroll_events: count, app_state: current }`
  - AppState listener: if background → send `app_state: "background"`
  - Scroll listener: increment `scroll_events` counter
  - End session on unmount: `POST /api/v1/session/end`
  - Floating timer UI showing elapsed time and potential points
  - NOTE: >100px/30s scroll anti-cheat and "Read Check" modal every 5 articles are NOT implemented. Current approach: 1-minute read slices with 5k character chunks. Do not re-add these without explicit request.

### Step 7: Wallet Tab
- `app/(tabs)/wallet.tsx`:
  - Show current points balance (from `useQuery` on `/api/v1/auth/me`)
  - Transaction history list (mock for now, real endpoint in Phase 5+)
  - "Withdraw" button (disabled, placeholder text)

### Step 8: Build + Test
- Run locally: `npx expo run:android` (needs Android Studio) or `npx expo run:ios`
- Verify:
  - Login flow works
  - Catalog loads and scrolls
  - Reader starts session and sends heartbeats
  - Wallet shows balance update after reading
- Create production build via EAS:
  ```bash
  eas build --platform android --profile preview
  ```
- Share APK with 5 testers

### Step 9: Ship Phase 1
- Build production binary: `eas build --platform android --profile production`
- Upload to Google Play Console (internal testing track)
- Metadata: "PagePay: Read & Earn"
- Verify in internal test: auth → read → earn → wallet all functional
- Promote to closed testing (50-100 users)

---

## Acceptance Criteria (Phase 1 Complete)
✅ User can register, login, logout
✅ User can browse catalog with filter chips
✅ User can read article/book
✅ Points awarded for verified reading time
✅ Wallet shows updated balance
✅ Anti-cheat (scroll + app state) functional
✅ App builds and runs on real Android device
✅ Live on Play Store internal testing
✅ Backend: `pytest --cov=app` returns 80%+ coverage, 0 failures
✅ Backend: `docker compose up --build` boots clean, `/api/v1/health` returns 200
✅ E2E: Auth → browse catalog → open book → heartbeat → end session → balance updates in wallet
✅ No TODO comments, placeholder strings, or mock data in committed code
