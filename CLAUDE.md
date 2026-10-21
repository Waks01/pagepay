# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## What PagePay Is

PagePay is a **read-to-earn + AI study platform** — an Expo mobile app where users earn points for verified slice completion, ad-watching, and completing social tasks. It features an AI-powered study system that turns syllabi into quizzes/flashcards and a VTU bills payment system. Revenue comes from **AdMob** and **Paystack** premium subscriptions. Target market: Nigeria.

This is a production revenue system. No placeholders, mock data, or TODOs in committed code. If an integration is missing, raise an explicit error — never silently return empty objects.

**Current state (Oct 2026):** Phases 1–8 shipped; in Phase 9 (monetization hardening). The AdMob **backend** SSV is live; the AdMob **client** pipeline is not built yet. AI is Cloudflare Workers AI only (Granite standard / GLM premium / Llama vision / MeloTTS) — the old Gemini/Groq/OpenRouter pool was removed.

---

## Repo Layout

The repo is a monorepo:
```
pagepay/
├── kilo.json          # Phase + agent manifest
├── AGENTS.md          # Kilo command/agent system
├── roadmap.md         # Product roadmap (June 2026 plan + current status header)
├── .kilo/             # Steering, agent roles, and phase specs
├── backend/           # FastAPI + PostgreSQL + Docker (Python 3.11)
├── page/              # ACTIVE Frontend (Expo SDK 57 / RN 0.86)
├── admin/             # Admin dashboard (React + Vite)
├── client/            # Legacy Frontend (Expo SDK 54) - do not use
├── books/             # Design documents
├── alembic/           # Legacy alembic root (migrations live in backend/alembic)
└── paystack-router/   # Standalone Paystack webhook receiver
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
- **Auth**: JWT HS256, 7-day expiry, with refresh-token rotation. `get_current_user` is the standard dependency gate.
- **Ad Rewards (SSV)**: Credits are strictly server-side. We issue `AdRequest` tokens to the client → AdMob → Signed SSV callback → Points credited. The callback is `GET /api/v1/study/ads/complete` and verifies an ECDSA P-256 signature against AdMob's rotating keys plus a Google reverse-DNS check, deduplicated on `transaction_id`.
- **AI**: One provider (Cloudflare Workers AI). `route_ai()` in `app/ai/router.py` is a **Python function, not an HTTP endpoint**. It picks between `ai_standard_model` (Granite) and `ai_premium_model` (GLM) by tier; generation tasks always use premium. **Cloudflare returns text in `result.response`, not `result.choices[0].message.content`** — reading the wrong key silently yields an empty response and a 503.
- **Reading Engine**: Long works are sliced into ~1-min reads. `ReadingProgress` tracks the slice; `SliceBookmark` tracks the scroll offset.
- **AI Study System**: SOW (Scheme of Work) upload → Async OCR/Parsing job → Generated `StudyMaterial` → Unlocked `StudyAsset` (MCQs, Flashcards) via points or ads. A **PDF is rendered page by page with PyMuPDF and OCR'd by the vision model** — its embedded text layer is not used, because a scan or a photo has none. The job row carries real `progress` and `stage` values that the client renders.
- **Social Task Marketplace**: Sponsors post `Task`s → Workers submit `TaskSubmission` → AI/Admin verification → Payout.
- **VTU Bills**: Integrated payment for airtime/data/elec. Uses a dispute system for non-delivery. Two providers (Peyflex, BigiSub) selected by `settings.bills_provider`.
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

Expo Router file-based routing under **`src/app/`** (not `app/` — `page/app/` does not exist):
- `(auth)/`: Login, Register, email-code verification.
- `(onboarding)/`: Onboarding.
- `(app)/`: Main navigation — `home/`, `catalog/`, `reader/`, `book/`, `study/`, `tasks/`, `community/`, `wallet/`, `profile/`, `premium/`, `rewards/`, `notification/`.
- `billing/`: Subscription + billing history. `fund-wallet/`: Funding success.

**Architecture:**
- **State Management**: TanStack Query v5 (server state), Zustand (client state).
- **Auth**: `expo-secure-store` for tokens (Never `AsyncStorage`).
- **Styling**: Custom themed components in `components/` and `src/shared/`.
- **SDK**: Expo SDK 57 / React Native 0.86.
- **Ads**: `react-native-google-mobile-ads` is installed but **has no config plugin and no call sites** — see `admob.md` §9.

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
9. **Tests must not call live providers.** Monkeypatch `route_ai` and the OCR helper — a test that hits Cloudflare is slow, non-deterministic and burns the daily allowance.
10. **Ad-earned credit is service credit, never cashable.** The 60% ad margin exists only because the liability is service, not cash.
