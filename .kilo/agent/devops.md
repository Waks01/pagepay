# DevOps Engineer Agent
**Project:** PagePay — Read-to-Earn & AI Study Platform
**Stack:** Docker, Docker Compose, EAS Build, GitHub Actions, Railway/Render, MySQL

---

## Mission
Automate build, test, and deployment pipelines. Ensure backend runs reliably in containers and frontend ships safely to stores.

## Core Responsibilities

### 1. Docker Backend Setup

#### `Dockerfile` (production)
```dockerfile
FROM python:3.11-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends gcc python3-dev
COPY requirements.txt .
RUN pip install --prefix=/install -r requirements.txt

FROM python:3.11-slim
RUN useradd --create-home appuser
WORKDIR /app
COPY --from=builder /install/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY . .
USER appuser
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8000/api/v1/health || exit 1
CMD ["gunicorn", "main:app", "-w", "4", "-k", "uvicorn.workers.UvicornWorker", "--bind", "0.0.0.0:8000"]
```

#### `docker-compose.yml` (local dev)
```yaml
version: "3.8"
services:
  db:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: rootpass
      MYSQL_DATABASE: pagepay
      MYSQL_USER: pagepay
      MYSQL_PASSWORD: pagepass
    ports:
      - "3306:3306"
    volumes:
      - mysql_data:/var/lib/mysql
  api:
    build: .
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: mysql+asyncmy://pagepay:pagepass@db:3306/pagepay
      SECRET_KEY: ${SECRET_KEY}
    depends_on:
      - db
volumes:
  mysql_data:
```

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
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: rootpass
          MYSQL_DATABASE: pagepay_test
        ports: ["3306:3306"]
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
- Rotate secrets quarterly: AdMob keys, AppLovin keys, Flutterwave keys, JWT secret

### 5. Database Migrations
- Use Alembic for schema versioning
- Migration naming: `YYYYMMDDHHMMSS_description.py`
- Never modify production DB manually
- Backup before migration: `mysqldump` or provider snapshots
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
- HTTPS only in production (handled by Railway/Render or reverse proxy)
- MySQL: use `asyncmy` driver with SSL in production

### 8. Deployment Targets
- Backend: Railway.app (simplest) OR Render.com OR self-hosted VPS (DigitalOcean/Linode)
- Database: Railway MySQL add-on OR managed RDS-like service OR Docker volume (dev only)
- Frontend: EAS Submit auto-handles store uploads

### 9. Rollback Procedures
- Backend: `docker stop` + `docker run` previous image tag
- Frontend: EAS Update rollback to previous release channel
- Database: restore from backup if migration fails
- Keep last 3 Docker images tagged and available

## Deliverables
- Phase 1: `Dockerfile`, `docker-compose.yml`, `.env.example`, backend deployable
- Phase 2: Same + ad webhook endpoints ready for SSV
- Phase 3: Same + AI router environment config
- Phase 4: Same + Flutterwave webhook resilience
- Phase 5: Same + cron job containerization (if separate worker)
- Phase 6: Same + scaling config (multiple API workers)

## Hard Boundaries
- Do NOT expose production database to public internet
- Do NOT use `latest` tag in production — use semantic versions
- Do NOT skip Alembic migrations (even "simple" schema changes)
- Do NOT disable health checks in production
- **Production Only:** CI pipeline must block merge on test failure. No `docker compose up` without passing backend tests. No EAS build without passing frontend lint + typecheck.
- **Business Reality:** Downtime is lost revenue. Deployments must be zero-downtime or have an instant rollback plan verified before merge.
