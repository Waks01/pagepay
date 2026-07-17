# PagePay Backend

FastAPI backend for PagePay read-to-earn platform with social tasks marketplace.

## Tech Stack

- **Framework:** FastAPI 0.111.0
- **Database:** MySQL 8.0 with async SQLAlchemy 2.0
- **Auth:** JWT tokens (python-jose)
- **Migrations:** Alembic 1.13.3
- **AI:** Multi-provider routing (Gemini, Groq, OpenRouter)
- **Media:** Cloudinary for image uploads
- **Payments:** Paystack integration
- **Container:** Docker + docker-compose

## Quick Start

### 1. Start MySQL

```bash
docker-compose up -d mysql
```

### 2. Run Migrations

```bash
# Using Python directly
cd backend
python -m alembic upgrade head

# Or using Docker
docker-compose exec backend python -m alembic upgrade head
```

### 3. Start Backend

```bash
# Development (hot-reload)
docker-compose up backend

# Or locally with venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 4. Verify

```bash
curl http://localhost:8000/health
```

## Database Migrations

### Create New Migration

```bash
cd backend
python -m alembic revision --autogenerate -m "description of changes"
```

### Apply Migrations

```bash
python -m alembic upgrade head
```

### Rollback Last Migration

```bash
python -m alembic downgrade -1
```

### Check Current Version

```bash
python -m alembic current
```

### View Migration History

```bash
python -m alembic history
```

## Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

**Required variables:**

- `DATABASE_URL` - MySQL connection string
- `SECRET_KEY` - JWT signing key (use `openssl rand -hex 32`)
- `CLOUDINARY_*` - Cloudinary credentials for Phase 7 uploads
- `PAYSTACK_*` - Paystack API keys for payments
- `GEMINI_API_KEY` / `GROQ_API_KEY` / `OPENROUTER_API_KEY` - AI provider keys

## API Documentation

- **Swagger UI:** http://localhost:8000/docs
- **ReDoc:** http://localhost:8000/redoc

## Project Structure

```
backend/
├── alembic/                # Database migrations
│   ├── versions/          # Migration scripts
│   └── env.py            # Alembic environment config
├── app/
│   ├── routers/          # API endpoints
│   │   ├── auth.py       # Auth (signup, login)
│   │   ├── sessions.py   # Reading sessions
│   │   ├── content.py    # Content catalog
│   │   ├── tasks.py      # Phase 7 worker tasks
│   │   ├── sponsor.py    # Phase 7 sponsor endpoints
│   │   ├── payments.py   # Premium subscriptions
│   │   ├── payouts.py    # Withdrawals
│   │   └── admin.py      # Admin panel
│   ├── services/         # Business logic
│   │   ├── auth.py       # JWT token generation
│   │   ├── cloudinary.py # Image uploads
│   │   ├── ai_verification.py # Phase 7 AI verification
│   │   ├── task_processor.py  # Phase 7 background worker
│   │   └── ads.py        # Ad network resolution
│   ├── ai/              # AI router (Phase 3)
│   │   ├── router.py    # Multi-provider routing
│   │   └── providers/   # Gemini, Groq, OpenRouter
│   ├── models/          # SQLAlchemy models
│   ├── schemas/         # Pydantic schemas
│   ├── config.py        # Settings
│   ├── database.py      # DB connection
│   ├── limiter.py       # Rate limiting
│   └── main.py          # FastAPI app
├── tests/               # Pytest tests
├── docker-compose.yml   # Local dev stack
├── Dockerfile          # Backend container
├── requirements.txt    # Python dependencies
└── README.md           # This file
```

## Phase 7 - Social Tasks

### Architecture

- **Workers:** Users (is_worker=True) browse tasks, submit proofs
- **Sponsors:** Anyone (is_sponsor=True) can post tasks, requires KYC
- **Dual Role:** Users can be both worker and sponsor
- **Escrow:** Funds locked upfront when task is published
- **AI Verification:** Auto-approve (confidence ≥0.9), manual review (0.6-0.89), reject (<0.6)
- **Platform Fee:** 15% commission on task completion

### New Models

- `Task` - Task definition with targeting, rewards, AI settings
- `TaskSubmission` - Worker submissions with proofs, AI verification
- `UserReputation` - Worker/sponsor stats, XP, badges, streaks
- `SponsorWalletTransaction` - Separate wallet for sponsors
- `SponsorKYC` - Document storage for sponsor verification

### API Endpoints

**Worker:**
- `GET /api/v1/tasks` - List available tasks (filtered by eligibility)
- `GET /api/v1/tasks/{id}` - Task detail
- `POST /api/v1/tasks/{id}/start` - Start task timer
- `POST /api/v1/tasks/{id}/submit` - Submit proof
- `GET /api/v1/tasks/my-stats` - Worker reputation
- `GET /api/v1/tasks/my-submissions` - Submission history

**Sponsor:**
- `POST /api/v1/sponsor/register` - Register as sponsor
- `PUT /api/v1/sponsor/kyc` - Submit KYC documents
- `POST /api/v1/sponsor/wallet/deposit` - Deposit funds (Paystack)
- `POST /api/v1/sponsor/tasks` - Create draft task
- `POST /api/v1/sponsor/tasks/{id}/publish` - Publish and lock escrow
- `GET /api/v1/sponsor/tasks/{id}/submissions` - View submissions
- `POST /api/v1/sponsor/submissions/{id}/approve` - Approve submission
- `POST /api/v1/sponsor/submissions/{id}/reject` - Reject submission

**Admin:**
- `GET /api/v1/admin/tasks/kyc/pending` - Pending KYC applications
- `POST /api/v1/admin/tasks/kyc/{sponsor_id}/approve` - Approve KYC
- `POST /api/v1/admin/tasks/kyc/{sponsor_id}/reject` - Reject KYC
- `GET /api/v1/admin/tasks/submissions/flagged` - Flagged submissions
- `POST /api/v1/admin/tasks/submissions/{id}/approve` - Admin approve
- `POST /api/v1/admin/tasks/submissions/{id}/reject` - Admin reject
- `GET /api/v1/admin/tasks/analytics` - Phase 7 analytics

## Testing

```bash
# Run all tests
pytest

# With coverage
pytest --cov=app tests/

# Specific test file
pytest tests/test_auth.py
```

## Deployment

### Production Checklist

- [ ] Change `SECRET_KEY` in .env (use `openssl rand -hex 32`)
- [ ] Set `ADMIN_TOKEN` to secure value
- [ ] Configure real Paystack keys
- [ ] Set `PUBLIC_BASE_URL` to production domain
- [ ] Enable SSL/TLS
- [ ] Configure backup schedule for MySQL
- [ ] Set up monitoring (Sentry, Datadog, etc.)
- [ ] Configure log rotation
- [ ] Review CORS_ORIGINS whitelist

### Docker Production

```bash
# Build image
docker build -t pagepay-backend:latest .

# Run with compose
docker-compose -f docker-compose.prod.yml up -d

# View logs
docker-compose logs -f backend
```

## License

Proprietary - PagePay
