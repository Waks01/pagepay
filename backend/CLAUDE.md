# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Backend Overview
The backend is a FastAPI application using SQLAlchemy 2.0 (async) and PostgreSQL. It implements a "Read-to-Earn" system where user activity (reading time and ad-watching) is verified server-side and credited as points.

## Common Commands

### Environment Setup
```bash
# Setup virtual environment
python -m venv .venv
.venv\Scripts\activate  # Windows
source .venv/bin/activate # POSIX

# Install dependencies
pip install -r requirements.txt -r requirements-dev.txt
```

### Development & Execution
```bash
# Run the API server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Database Migrations (Alembic)
alembic upgrade head
```

### Testing
```bash
# Run all tests
pytest

# Run a specific test file
pytest tests/test_auth.py

# Run a specific test by name
pytest -k "test_login"

# Run with coverage
pytest --cov=app --cov-report=term
```

## Architecture & Structure

### Project Layout
`app/` is organized by responsibility:
- `main.py`: FastAPI app initialization and router mounting.
- `database.py`: PostgreSQL `asyncpg` engine and session management.
- `models/__init__.py`: Centralized SQLAlchemy models (Single Source of Truth).
- `schemas/__init__.py`: Centralized Pydantic request/response models.
- `routers/`: Resource-specific endpoints (mounted under `/api/v1`).
- `services/`: Business logic, external integrations (Paystack, AdMob), and complex calculations.

### Key Technical Patterns
- **Async Everything**: All DB calls use `await db.execute(...)` and `await db.commit()`.
- **Server-Side Verification (SSV)**: Ad rewards are never trusted from the client. The system uses `AdRequest` tokens passed to AdMob, which are verified via an ECDSA-signed callback from Google before crediting points.
- **Reading Session State Machine**:
  - `/session/start` $\rightarrow$ `/session/heartbeat` (verified reading) $\rightarrow$ `/session/end` (calculate pending points) $\rightarrow$ `/session/claim` (credit to wallet).
- **Bundled Rewards**: Ad rewards (pre-read and post-read) and reading-time points are accumulated in `ReadingSession.pending_points` and committed as a single wallet transaction during `/session/claim`.
- **Response Envelopes**: Follow the pattern `{"data": ..., "meta": {...}}` for lists and `{"error": {"code": "...", "message": "..."}}` for errors.

## Database Constraints
- **Database**: PostgreSQL (using `asyncpg`).
- **Alembic**: Migration IDs are descriptive (e.g., `019_add_sess_id_ads`). Keep them $\le 32$ characters to avoid `StringDataRightTruncationError` in the `alembic_version` table.
- **Precision**: Financial values (revenue) are stored in micro-units (USD $\times 10^6$) using `BigInteger` to avoid float rounding errors.
