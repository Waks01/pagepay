import asyncio
import logging
import os
import traceback
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from starlette.middleware.base import BaseHTTPMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
import socketio
from app.config import settings
from app.database import AsyncSessionLocal, engine
from app.limiter import limiter
from app.models import Base
from app.routers import auth, content, sessions, health, wallet, progress, ads, study, legal, bills, notifications, pin
from app.routers.images import router as images_router
from app.routers.audio import router as audio_router
from app.routers.study_data import router as study_data_router
from app.routers.ai import router as ai_router
from app.routers.referral import router as referral_router
from app.routers.community import router as community_router
from app.routers.streak import router as streak_router
from app.routers.analytics import router as analytics_router
from app.routers.payouts import router as payouts_router
from app.routers.payments import router as payments_router
from app.routers.admin import router as admin_router
from app.routers.config import router as config_router
from app.routers.tasks import router as tasks_router
from app.routers.sponsor import router as sponsor_router
from app.routers.works_social import router as works_social_router
from app.seed import run_all_seeds, run_migrations
from app.services.task_processor import task_processor
from app.services.ai_verification import verification_service
from app.websocket import sio

logger = logging.getLogger("uvicorn.error")

# Background task processor
processor_task = None


async def _seed_in_background():
    """Run seeding in the background after app is ready.

    Seeds core app config, ad placements, AI provider health, streak
    config, admin users, and initial content from Gutendex. Safe to
    call repeatedly — idempotent SELECT-then-INSERT pattern.
    """
    try:
        async with AsyncSessionLocal() as session:
            counts = await run_all_seeds(session)
            if any(counts.values()):
                logger.info("Phase 2 seed inserted: %s", counts)
    except Exception as exc:
        logger.error("Phase 2 background seed failed: %s", exc)


async def _migrate_in_background():
    """Run Alembic migrations in the background after app is ready.

    Same shape as _seed_in_background: API starts serving requests
    immediately, schema migrations apply asynchronously. Idempotent —
    `alembic upgrade head` against a current database is a no-op.
    """
    try:
        async with AsyncSessionLocal() as session:
            await run_migrations(session)
    except Exception as exc:
        logger.error("Background migration failed: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global processor_task

    # Ensure the v3 image proxy cache dir exists on startup. The
    # proxy router creates it lazily on first request as a
    # belt-and-suspenders measure, but having the dir ready at
    # boot lets us fail fast on a misconfigured volume mount
    # (e.g. Render disk not attached) instead of returning 502
    # to the first reader session.
    try:
        from pathlib import Path
        Path(settings.image_cache_dir).mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        logger.warning("Could not create image cache dir %s: %s", settings.image_cache_dir, exc)

    # Only create tables, don't seed yet
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    except Exception as exc:
        # Tables may already exist from a prior run with a different schema.
        # create_all is idempotent for matching tables, but stale schemas crash
        # the worker. Log and continue so the API still serves requests.
        logger.warning("Skipping create_all on startup: %s", exc)
    
    # Start seeding in background (don't block app startup)
    logger.info("Scheduling background seeding...")
    asyncio.create_task(_seed_in_background())

    # Apply pending migrations in background (idempotent on every boot).
    logger.info("Scheduling background migrations...")
    asyncio.create_task(_migrate_in_background())

    # Pre-warm AdMob SSV verifier keys in background so the first
    # callback doesn't block on a 10s HTTPS fetch.
    async def _prewarm_admob_keys():
        try:
            from app.routers.ads import _fetch_verifier_keys
            await _fetch_verifier_keys()
            logger.info("AdMob SSV verifier keys pre-warmed")
        except Exception as exc:
            logger.warning("AdMob SSV key pre-warm failed (will retry on first callback): %s", exc)

    asyncio.create_task(_prewarm_admob_keys())
    
    # Start Phase 7 background task processor
    # Only start if explicitly enabled via environment variable
    # Render free tier can't reliably run background tasks due to connection pooling
    should_run_processor = os.getenv("RUN_TASK_PROCESSOR", "false").lower() == "true"
    
    if should_run_processor:
        logger.info("Starting Phase 7 task processor...")
        processor_task = asyncio.create_task(task_processor.start())
    else:
        logger.info("Phase 7 task processor disabled (set RUN_TASK_PROCESSOR=true to enable)")
        processor_task = None

    yield
    
    # Shutdown: stop background processor
    logger.info("Stopping Phase 7 task processor...")
    task_processor.stop()
    if processor_task:
        processor_task.cancel()
        try:
            await processor_task
        except asyncio.CancelledError:
            pass
    
    # Close AI verification service HTTP client
    await verification_service.close()


app = FastAPI(title="PagePay API", lifespan=lifespan)
app.state.limiter = limiter

# Mount Socket.IO
socket_app = socketio.ASGIApp(sio, app)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Return all unhandled exceptions as JSON so the client always gets
    a parseable error response instead of raw text/plain or HTML.

    Uses FastAPI's standard `detail` key so the frontend error handling
    (which reads `response.data.detail`) works without changes.
    """
    logger.error("Unhandled exception: %s\n%s", exc, traceback.format_exc())
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


def _rate_limit_handler(request, exc):
    """Render a RateLimitExceeded as a JSON 429 instead of letting
    slowapi's default handler crash.

    Starlette's exception-handler contract is `(request, exc) -> Response`.
    The previous lambda returned `exc.detail` (a string), which Starlette
    then tried to call as a handler — hence `TypeError: 'str' object is
    not callable` whenever the 5/15min login limit actually fired.
    """
    return JSONResponse(
        status_code=429,
        content={"error": {"code": "rate_limited", "message": str(exc.detail)}},
    )


class RequestSizeLimitMiddleware(BaseHTTPMiddleware):
    """Reject requests with body larger than the configured limit.

    JSON/API payloads: 1 MB
    Multipart (file uploads): 10 MB
    """
    async def dispatch(self, request: Request, call_next):
        content_length = request.headers.get("content-length")
        if content_length:
            size = int(content_length)
            content_type = request.headers.get("content-type", "")
            limit = 10 * 1024 * 1024 if "multipart" in content_type else 1 * 1024 * 1024
            if size > limit:
                return JSONResponse(
                    status_code=413,
                    content={"detail": f"Request body too large. Maximum size is {limit // 1024 // 1024} MB."},
                )
        return await call_next(request)


class CSRFMiddleware(BaseHTTPMiddleware):
    """Require X-Requested-With header on admin mutation endpoints.

    Browsers automatically send cookies on same-site requests. Without
    CSRF protection, a malicious site can forge state-changing requests
    on behalf of an authenticated admin. Requiring a custom header
    blocks this because browsers cannot set custom headers in
    cross-origin requests without CORS preflight.
    """
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        method = request.method
        if path.startswith("/api/v1/admin") and method in ("POST", "PUT", "DELETE", "PATCH"):
            if request.headers.get("X-Requested-With") != "XMLHttpRequest":
                return JSONResponse(
                    status_code=403,
                    content={"detail": "Missing X-Requested-With header"},
                )
        return await call_next(request)


app.add_exception_handler(RateLimitExceeded, _rate_limit_handler)

app.add_middleware(RequestSizeLimitMiddleware)
app.add_middleware(CSRFMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With", "Origin", "Referer"],
)

API_PREFIX = "/api/v1"

app.include_router(auth.router, prefix=API_PREFIX)
app.include_router(content.router, prefix=API_PREFIX)
app.include_router(images_router, prefix=API_PREFIX)
app.include_router(audio_router, prefix=API_PREFIX)
app.include_router(study_data_router, prefix=API_PREFIX)
app.include_router(sessions.router, prefix=API_PREFIX)
app.include_router(wallet.router, prefix=API_PREFIX)
app.include_router(health.router, prefix=API_PREFIX)
app.include_router(admin_router, prefix=API_PREFIX)
app.include_router(progress.router, prefix=API_PREFIX)
app.include_router(ads.router, prefix=API_PREFIX)
app.include_router(payouts_router, prefix=API_PREFIX)
app.include_router(payments_router, prefix=API_PREFIX)
app.include_router(config_router, prefix=API_PREFIX)
app.include_router(study.router, prefix=API_PREFIX)
app.include_router(ai_router, prefix=API_PREFIX)
app.include_router(referral_router, prefix=API_PREFIX)
app.include_router(community_router, prefix=API_PREFIX)
app.include_router(streak_router, prefix=API_PREFIX)
app.include_router(analytics_router, prefix=API_PREFIX)
app.include_router(legal.router, prefix=API_PREFIX)

# Phase 7: Social Tasks
app.include_router(tasks_router, prefix=API_PREFIX)
app.include_router(sponsor_router, prefix=API_PREFIX)

# Phase 3: Notifications
app.include_router(notifications.router, prefix=API_PREFIX)

# Transaction PIN
app.include_router(pin.router, prefix=API_PREFIX)

# Phase 8: Bills & Earn
app.include_router(bills.router, prefix=API_PREFIX)

# OpenStax + work-level social (Phase: OpenStax integration)
app.include_router(works_social_router, prefix=API_PREFIX)
