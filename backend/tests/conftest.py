import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.main import app
from app.config import settings
from app.database import get_db
from app.limiter import limiter
from app.models import Base

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

engine_test = create_async_engine(TEST_DATABASE_URL, echo=False)
AsyncTestSession = async_sessionmaker(engine_test, class_=AsyncSession, expire_on_commit=False)


@pytest_asyncio.fixture(scope="function", autouse=True)
async def setup_db():
    # slowapi's Limiter holds per-IP counters in module-level state;
    # clear them so the 5/15min login limit doesn't bleed across tests.
    limiter.reset()
    # Force the payouts router down its v1 stub path even when the
    # developer's local `.env` has real Paystack keys. Tests that
    # explicitly want to exercise live Paystack (Phase 4 wiring)
    # should use the `live_paystack` fixture below.
    settings.paystack_secret_key = None
    settings.paystack_public_key = None
    # NOTE: Settings has no `paystack_webhook_secret` field — Paystack
    # uses the same `paystack_secret_key` for webhook signing. The line
    # below used to set a non-existent field and crashed the fixture
    # with a pydantic ValueError on every test in the suite. Removed
    # in the ad-system security hardening pass (task #3) so tests can
    # actually run. If a future Paystack integration introduces a
    # separate webhook secret, restore the line below and add the
    # field to `app/config.py:Settings`.
    # settings.paystack_webhook_secret = None
    # Drop the cached lazy client + bank list so the next call sees
    # the (now-None) secret and raises PaystackError rather than
    # leaking between tests.
    from app.services import paystack as _ps
    _ps._client = None
    _ps._BANKS_CACHE = None
    async with engine_test.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine_test.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def db_session():
    async with AsyncTestSession() as session:
        yield session


@pytest_asyncio.fixture
async def client():
    async def override_get_db():
        async with AsyncTestSession() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
