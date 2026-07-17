# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## What PagePay Is

PagePay is a **read-to-earn + AI study platform** — an Expo mobile app where users earn points for verified reading time and ad-watching, and (Phase 3+) use AI to turn syllabi into quizzes/flashcards. Two audiences: casual readers and exam-prep students. Revenue comes from AdMob + AppLovin MAX (dual-network for fill/eCPM redundancy) and Flutterwave premium subscriptions. Target market launch is Nigeria (NGN pricing, Flutterwave).

This is a production revenue system from Day 1. No placeholders, mock data, TODOs, or "test mode" branches in committed code. If an integration is missing, raise an explicit error — never silently return empty objects.

---

## Repo Layout

The repo is a monorepo with three root-level projects:

```
pagepay/
├── kilo.json          # Phase + agent manifest
├── AGENTS.md          # Kilo command/agent system (READ FIRST)
├── roadmap.md         # Full 6-phase product roadmap + DB schema + AI router code
├── .kilo/
│   ├── steering.md    # Product vision, brand, hard constraints (READ FIRST)
│   ├── agent/         # Role specs: backend.md, frontend.md, ai.md, devops.md
│   └── command/       # Per-phase implementation specs (phase1-core.md … phase6-scale.md)
├── backend/           # FastAPI + PostgreSQL + Docker (Python 3.11)
├── client/            # Expo SDK 54 / RN 0.81 / expo-router (the "new" frontend)
└── Earn9ja/           # Legacy / parallel Expo app (do not mix into client/)
```

**Read in this order before any implementation work:** `.kilo/steering.md` → relevant `.kilo/agent/*.md` → matching `.kilo/command/phaseN-*.md` → `roadmap.md` for the section you're touching.

The Kilo system treats commands as non-negotiable specifications — follow them unless you find a bug, in which case fix the command file first.

**Note on `client/`:** the version pinned in `client/package.json` is Expo SDK 54 / RN 0.81, not SDK 55 as documented in `roadmap.md`/`kilo.json`. The roadmap is the target; verify against `client/package.json` before pinning native dependencies.

---

## Common Commands

### Backend (`backend/`)

```bash
# Local dev (uses the in-repo .venv if present)
cd backend
python -m venv .venv && source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env                                # then edit

# Run the API
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Tests
pytest                                              # all tests
pytest tests/test_auth.py                           # single test file
pytest -k "test_login"                              # single test by name
pytest --cov=app --cov-report=term                  # with coverage

# Docker (api + postgres + cron — see docker-compose.yml)
docker compose up --build                           # full stack
docker compose up db api                            # skip cron
```

Health check: `GET /api/v1/health`. The Dockerfile's HEALTHCHECK pings the same path on `:8000`.

### Client (`client/`)

```bash
cd client
npm install
npx expo start --clear          # dev server (Expo Go works only before Phase 2)
npm run android | npm run ios   # platform launchers
npm run lint                    # eslint (eslint-config-expo)
npx tsc --noEmit                # typecheck
```

**Phase 2+ requires `expo-dev-client` builds, NOT Expo Go.** AdMob + AppLovin native modules will not load in Expo Go.

### Cron container

The cron service (content sync from Gutendex/GNews) runs as a separate Docker container. Entrypoint is `python -m app.services.cron`; `docker-compose.yml` wraps it in a 6-hour sleep loop. The module is idempotent — a partial run is harmless.

---

## Backend Architecture

`backend/app/` is organized as:

```
app/
├── main.py              # FastAPI app + lifespan + router registration
├── config.py            # pydantic-settings Settings (reads backend/.env)
├── database.py          # async SQLAlchemy engine, AsyncSessionLocal, get_db()
├── limiter.py           # slowapi rate limiter
├── models/__init__.py   # ALL SQLAlchemy models in one file (Base + User + ReadingSession +
│                        #   ContentCatalog + AdEvent + ReadingProgress + SliceBookmark)
├── schemas/__init__.py  # ALL Pydantic request/response models in one file
├── routers/             # One file per resource group (auth, content, sessions, wallet,
│                        #   progress, admin, health) — mounted at /api/v1/*
├── services/
│   ├── auth.py          # JWT + password hashing helpers
│   ├── content/
│   │   ├── gutendex.py  # Public-domain book importer
│   │   ├── gnews.py     # News importer (requires GNEWS_API_KEY)
│   │   └── slicing/     # Long works → ~2-minute slices (parent_work_id + read_order)
│   └── cron/            # Scheduled content sync (runs in its own Docker container)
└── tests/               # pytest + pytest-asyncio; tests use sqlite+aiosqlite in-memory
                         #   via conftest.py — NOT PostgreSQL
```

### Key patterns

- **API prefix:** everything mounts under `/api/v1`. New endpoints go in `routers/` and are wired into `main.py`.
- **Async DB:** SQLAlchemy 2.0 async + `asyncpg` (production) / `aiosqlite` (tests). Always `await db.execute(...)`, `await db.commit()`, `await db.refresh(...)`.
- **Auth:** JWT HS256, 7-day expiry (`ACCESS_TOKEN_EXPIRE_MINUTES=10080`). `get_current_user` dependency in `routers/auth.py` is the standard gate.
- **Admin/cron auth:** shared secret in `X-Admin-Token` header, validated against `settings.admin_token`. Default `dev-admin-token` in dev — override in production.
- **Anti-cheat (server):** if >45s since last heartbeat, pause the session timer. If `scroll_events` are zero for 3 consecutive heartbeats, pause. Points formula: `5 pts per 600s` of verified duration — recalculated server-side, never trusted from client.
- **CORS:** `CORS_ORIGINS` is a comma-separated string; `settings.cors_origins_list` splits it. Default includes Expo's dev ports `8081` and `19006`.
- **Reading engine model:** books/articles are sliced into ~1-min reads. `content_catalog` holds both parent works and child slices — `parent_work_id`/`read_order` link them. Rewards are bundled: Pre-read Ad $\rightarrow$ Reading Session $\rightarrow$ Post-read Ad, with all points staged in `ReadingSession.pending_points` and linked via `AdRequest.session_id` before being credited as a single wallet transaction. `reading_progress` is the coarse pointer (which slice to resume); `slice_bookmarks` is the fine pointer (scroll offset within a slice). See `routers/progress.py` for the full state machine (`/continue`, `/bookmark`, `/finish`, `/start`).
- **Response envelope convention (per `backend.md`):** lists as `{"data": ..., "meta": {"page": 1, "total": N}}`, errors as `{"error": {"code": "...", "message": "...", "details": {}}}`. Existing endpoints have drifted from this — normalize when adding new ones.

### Database schema (current)

All in `app/models/__init__.py`: `users`, `reading_sessions`, `content_catalog` (with `parent_work_id`/`read_order`/`total_slices` for sliced works), `ad_events`, `reading_progress`, `slice_bookmarks`. Phase 3+ adds `study_materials`, `quiz_sessions`, `payments`, `referrals`, `ai_provider_health` (per `roadmap.md`) — not yet present.

---

## Frontend Architecture (`client/`)

Expo Router file-based routing under `app/`:

```
app/
├── _layout.tsx          # Root layout (providers: QueryClient, theme, auth)
├── (auth)/              # login.tsx, register.tsx (route group, no /auth in URL)
├── (tabs)/              # Bottom tab navigator — index, catalog, wallet, (study: Phase 3)
├── reader/[id].tsx      # Dynamic reader route
├── modal.tsx
└── ...
```

`components/` holds shared UI (`Field.tsx`, `PrimaryButton.tsx`, `ContentCard.tsx`, `CategoryChip.tsx`, `ResumeCard.tsx`, `PageMark.tsx`, `themed-*`). `src/shared/` is scaffolded but mostly empty — when adding feature code, follow the feature-based structure from `.kilo/agent/frontend.md` (features/{auth,catalog,reader,study,wallet} + shared/{api,components,hooks,lib}).

State management standard: TanStack Query v5 (server state), Zustand (client state), `expo-secure-store` (auth tokens — never `AsyncStorage` for sensitive data). MMKV is documented in steering but the project currently uses `expo-secure-store` only.

Brand colors: purple `#6C5CE7` (primary), green `#00B894` (earnings/money). Inter font.

---

## Hard Constraints (from `.kilo/steering.md`)

1. No client-side point calculation — server recalculates and credits after SSV.
2. No mock data, TODOs, or placeholder strings in committed code.
3. No `console.log` in production builds.
4. No `AsyncStorage` for tokens — use `expo-secure-store`.
5. No sync AI clients inside async FastAPI routes.
6. No Expo Go for Phase 2+ builds (use `expo-dev-client`).
7. No shipping a phase until: `pytest` passes + `tsc --noEmit` passes + `eslint` passes + smoke E2E passes.
8. JWT secret + admin token must be overridden from env in production; never commit real secrets.

---

## Phase Status

`kilo.json` lists all 6 phases as `pending`. Phase 1 (Read-to-Earn Core) is the most built-out — backend has auth, content, sessions, wallet, progress, admin/cron; client has auth screens, catalog, reader, wallet tabs. Phase 2 (Ads), Phase 3 (AI Study), and Phase 4 (Payments) are spec-only — `.kilo/command/phaseN-*.md` files describe what to build, but no `ads/`, `study/`, or `payments/` routers exist yet. Confirm current phase state in `roadmap.md` before assuming a feature is or isn't implemented.