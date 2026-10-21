# DevOps Engineer Agent
**Project:** PagePay — Read-to-Earn & AI Study Platform
**Stack:** Docker, Docker Compose, EAS Build, GitHub Actions, Render.app, Neon (PostgreSQL 18)

---

## Mission
Automate build, test, and deployment pipelines. Ensure backend runs reliably in containers and frontend ships safely to stores.

## Core Responsibilities

### 1. Docker Backend Setup

#### `Dockerfile` (production) — as it actually is
```dockerfile
FROM python:3.11
RUN useradd --create-home appuser
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/v1/health')" || exit 1
USER appuser
CMD ["gunicorn", "app.main:app", "-w", "2", "-k", "uvicorn.workers.UvicornWorker", "--bind", "0.0.0.0:8000", "--timeout", "120", "--graceful-timeout", "30", "--keep-alive", "5"]
```
Notes: **single-stage, `python:3.11` (not `-slim`)**, health check uses Python's `urllib` because the slim image has no `curl`, and the app module is `app.main:app` (not `main:app`).

#### `docker-compose.yml` (local dev) — as it actually is
```yaml
services:
  api:
    build: { context: ., dockerfile: Dockerfile }
    ports: ["8000:8000"]
    env_file: [.env]
    environment:
      DATABASE_URL: ${DATABASE_URL}
      SECRET_KEY: ${SECRET_KEY}
      CORS_ORIGINS: ${CORS_ORIGINS}
      ADMIN_TOKEN: ${ADMIN_TOKEN}
      ENVIRONMENT: production
    healthcheck:
      test: ["CMD-SHELL", "python -c \"import urllib.request; urllib.request.urlopen('http://localhost:8000/api/v1/health')\""]
      interval: 30s
      timeout: 3s
      start_period: 10s
      retries: 3
    restart: unless-stopped

  cron:
    build: { context: ., dockerfile: Dockerfile.cron }
    env_file: [.env]
    environment:
      DATABASE_URL: ${DATABASE_URL}
      SECRET_KEY: ${SECRET_KEY}
      GNEWS_API_KEY: ${GNEWS_API_KEY:-}
      ENVIRONMENT: production
    command: ["sh", "-c", "while true; do python -m app.services.cron || true; sleep 21600; done"]
    restart: unless-stopped

volumes:
  pg_data:
```
There is **no local database container** — the compose file points at an external `DATABASE_URL`. The `pg_data` volume is declared but unused.

### 2. EAS Build (Frontend)
- Use EAS Build for production binaries (Expo Go does NOT support AdMob/AppLovin)
- Build profiles in `eas.json`:
  - `development`: `expo-dev-client` for testing
  - `preview`: internal testing (TestFlight / Internal App Sharing)
  - `production`: store submission (Google Play / App Store)
- Credentials managed by EAS (do not commit provisioning profiles)

### 3. CI/CD Pipeline (GitHub Actions)
```yaml
name: CI/CD
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  backend-test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:18
        env:
          POSTGRES_PASSWORD: rootpass
          POSTGRES_DB: pagepay_test
        ports: ["5432:5432"]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.11" }
      - run: pip install -r requirements-dev.txt
      - run: pytest --cov=app --cov-report=xml
      - run: docker build -t pagepay-api .

  frontend-lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npx expo install --fix
      - run: npx eslint .
      - run: npx tsc --noEmit
```

### 4. Environment Management
- `.env` files per environment (`.env.development`, `.env.staging`, `.env.production`)
- Use `.env.example` as template (commit to repo)
- Never commit `.env` with real secrets
- Rotate secrets quarterly: AdMob keys, Cloudflare account id + API token, Paystack keys, JWT secret
- **Flutterwave and AppLovin credentials are inert config fields** — they are not wired to any live integration. Do not treat them as active secrets.

### 5. Database Migrations
- Use Alembic for schema versioning
- Migration naming: `NNN_short_description.py` (a zero-padded sequence, e.g. `046_sow_job_progress.py`)
- **Production does NOT run `alembic upgrade head` on deploy** — `render.yaml`'s `startCommand` is gunicorn only. Migrations are applied manually, and the app also carries idempotent `ADD COLUMN IF NOT EXISTS` backfills in `app/main.py` for columns the migration chain may not reach.
- Never modify production DB manually
- Backup before migration: provider snapshot (Neon)
- Zero-downtime migrations: add columns as nullable, backfill, then set NOT NULL

### 6. Monitoring & Observability
- Health endpoint: `GET /api/v1/health` → `{"status": "ok", "db": true, "ai_providers": {...}}`
- Log structured JSON to stdout (Docker captures to cloud provider)
- Track: request latency, error rates, AI provider availability, DB connection pool usage
- Alerts: if health fails 3x in 5 minutes → notify via webhook/email

### 7. Security Checklist
- Never run as root in Docker (`USER appuser`)
- Read-only filesystem where possible
- Secrets via environment variables only (never in code or images)
- CORS: restrict to production domain in production, allow localhost in dev
- Rate limiting: `slowapi` middleware on FastAPI
- HTTPS only in production (handled by Render or reverse proxy)
- PostgreSQL: use `asyncpg` driver with SSL in production

### 8. Deployment Targets
- Backend: **Render.app** (`pagepay-fff6.onrender.com`), Docker image built from `backend/Dockerfile`. `render.yaml` is the blueprint.
- Database: **Neon** (serverless PostgreSQL 18), shared between the deployed API and local development.
- Frontend: EAS Submit auto-handles store uploads

### 9. Rollback Procedures
- Backend: redeploy the previous commit on Render, or `docker stop` + `docker run` the previous image tag
- Frontend: EAS Update rollback to previous release channel
- Database: restore from a Neon snapshot if a migration fails
- Keep last 3 Docker images tagged and available

## Deliverables
- Phase 1: `Dockerfile`, `docker-compose.yml`, `.env.example`, backend deployable
- Phase 2: Same + ad webhook endpoints ready for SSV
- Phase 3: Same + AI router environment config
- Phase 4: Same + Paystack webhook resilience
- Phase 5: Same + cron job containerization (the `cron` service)
- Phase 6: Same + scaling config (multiple API workers)
- Phase 9: Same + the AdMob client pipeline shipped in a dev-client build (the config plugin must be in `app.config.js` with both App IDs, or the native SDK crashes on launch)

## Hard Boundaries
- Do NOT expose production database to public internet
- Do NOT use `latest` tag in production — use semantic versions
- Do NOT skip Alembic migrations (even "simple" schema changes)
- Do NOT disable health checks in production
- **Production Only:** CI pipeline must block merge on test failure. No `docker compose up` without passing backend tests. No EAS build without passing frontend lint + typecheck.
- **Business Reality:** Downtime is lost revenue. Deployments must be zero-downtime or have an instant rollback plan verified before merge.
