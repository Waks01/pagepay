# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## What PagePay Is

PagePay is a **read-to-earn + AI study platform** — an Expo mobile app where users earn points for verified reading time, ad-watching, and completing social tasks. It features an AI-powered study system that turns syllabi into quizzes/flashcards and a VTU bills payment system. Revenue comes from AdMob + AppLovin MAX and Flutterwave/Paystack premium subscriptions. Target market: Nigeria.

This is a production revenue system. No placeholders, mock data, or TODOs in committed code. If an integration is missing, raise an explicit error — never silently return empty objects.

---

## Repo Layout

The repo is a monorepo:
```
pagepay/
├── kilo.json          # Phase + agent manifest
├── AGENTS.md          # Kilo command/agent system
├── roadmap.md         # Product roadmap + DB schema
├── .kilo/             # Steering, agent roles, and phase specs
├── backend/           # FastAPI + PostgreSQL + Docker (Python 3.11)
├── page/              # ACTIVE Frontend (Expo SDK 57 / RN 0.86)
├── client/            # Legacy Frontend (Expo SDK 54) - do not use
└── Earn9ja/           # Legacy Expo app
```

**Onboarding Path:** `.kilo/steering.md` $\rightarrow$ `.kilo/agent/*.md` $\rightarrow$ `.kilo/command/phaseN-*.md` $\rightarrow$ `roadmap.md`.

---

## Common Commands

### Backend (`backend/`)
```bash
# Local dev
cd backend
python -m venv .venv && .venv\Scripts\activate # Windows
pip install -r requirements.txt -r requirements-dev.txt

# Run the API
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Tests
pytest                                              # all tests
pytest tests/test_auth.py                           # single file
pytest -k "test_login"                              # single test
pytest --cov=app --cov-report=term                  # with coverage

# Docker (API, Postgres, Cron)
docker compose up --build                           # full stack
```

### Frontend (`page/`)
```bash
cd page
npm install
npx expo start --clear          # dev server
npm run android | npm run ios   # launchers
npm run lint                    # eslint
npx tsc --noEmit                # typecheck
```
**Note:** Phase 2+ (Ads) and native integrations require `expo-dev-client` builds; they will not work in Expo Go.

---

## Backend Architecture

`backend/app/` is organized by responsibility:
- `main.py`: FastAPI app + router registration.
- `database.py`: Async SQLAlchemy engine (`asyncpg`) and session management.
- `models/__init__.py`: ALL SQLAlchemy models (Single Source of Truth).
- `schemas/__init__.py`: ALL Pydantic request/response models.
- `routers/`: Resource groups mounted at `/api/v1/*`.
- `services/`: Business logic and external integrations (Paystack, AdMob, AI providers).

### Key Technical Patterns
- **Async DB**: Always `await db.execute(...)`, `await db.commit()`, `await db.refresh(...)`.
- **Auth**: JWT HS256, 7-day expiry. `get_current_user` is the standard dependency gate.
- **Ad Rewards (SSV)**: Credits are strictly server-side. We issue `AdRequest` tokens to the client $\rightarrow$ AdMob $\rightarrow$ Signed SSV callback $\rightarrow$ Points credited.
- **Reading Engine**: Long works are sliced into $\sim$1-min reads. `ReadingProgress` tracks the slice; `SliceBookmark` tracks the scroll offset.
- **AI Study System**: SOW (Scheme of Work) upload $\rightarrow$ Async OCR/Parsing job $\rightarrow$ Generated `StudyMaterial` $\rightarrow$ Unlocked `StudyAsset` (MCQs, Flashcards) via points or ads.
- **Social Task Marketplace**: Sponsors post `Task`s $\rightarrow$ Workers submit `TaskSubmission` $\rightarrow$ AI/Admin verification $\rightarrow$ Payout.
- **VTU Bills**: Integrated payment for airtime/data/elec. Uses a dispute system for non-delivery.
- **Response Envelopes**: Lists: `{"data": ..., "meta": {"page": 1, "total": N}}`. Errors: `{"error": {"code": "...", "message": "..."}}`.

### Database Schema
All models are in `app/models/__init__.py`. Key entities:
- **Core**: `User`, `ReadingSession`, `ContentCatalog`, `ReadingProgress`, `SliceBookmark`.
- **Ads**: `AdEvent`, `AdSsvLog`, `AdFillRateEvent`, `AdPlacement`, `AdRequest`.
- **Study**: `StudyMaterial`, `SowUploadJob`, `QuizSession`, `StudyAsset`, `StudyTransaction`, `StudyProgress`.
- **Financials**: `Payment`, `PayoutAccount`, `PayoutTransaction`, `BillTransaction`, `SponsorWalletTransaction`.
- **Social/Community**: `Referral`, `CommunityNote`, `CommunityLike`, `Task`, `TaskSubmission`, `UserReputation`, `SponsorKYC`, `TaskMessage`.
- **Engagement**: `UserStreak`, `DailyReward`, `UserRewardClaim`, `Achievement`, `Leaderboard`.
- **Admin/Audit**: `AdminUser`, `AdminAuditLog`, `FraudFlag`, `UserAuditLog`, `Notification`, `FCMToken`.

---

## Frontend Architecture (`page/`)

Expo Router file-based routing under `app/`:
- `(auth)/`: Login, Register.
- `(tabs)/`: Main navigation (Home, Catalog, Wallet, Study, Tasks).
- `reader/[id].tsx`: Dynamic reading interface.

**Architecture:**
- **State Management**: TanStack Query v5 (server state), Zustand (client state).
- **Auth**: `expo-secure-store` for tokens (Never `AsyncStorage`).
- **Styling**: Custom themed components in `components/` and `src/shared/`.
- **SDK**: Expo SDK 57 / React Native 0.86.

---

## Hard Constraints (from `.kilo/steering.md`)

1. No client-side point calculation — server recalculates and credits after SSV.
2. No mock data, TODOs, or placeholder strings in committed code.
3. No `console.log` in production builds.
4. No `AsyncStorage` for tokens — use `expo-secure-store`.
5. No sync AI clients inside async FastAPI routes.
6. No Expo Go for Phase 2+ builds (use `expo-dev-client`).
7. No shipping a phase until: `pytest` passes + `tsc --noEmit` passes + `eslint` passes + smoke E2E passes.
8. JWT secret + admin token must be overridden from env in production.
