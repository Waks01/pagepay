import ssl
from urllib.parse import urlparse, urlunparse, parse_qs, urlencode

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.config import settings

DATABASE_URL = settings.database_url

# Convert postgresql:// to postgresql+asyncpg:// for async support
if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)

# SQLAlchemy's asyncpg dialect (as of 2.0.36) auto-unpacks the URL's query
# string into asyncpg.connect() kwargs. asyncpg doesn't accept `sslmode`,
# `channel_binding`, or other psycopg2-style params — it expects `ssl` (an
# SSLContext) and a few others. Strip the unsupported params from the URL
# before handing it to the engine; we handle SSL via connect_args["ssl"]
# below, so we don't need any of them.
parsed = urlparse(DATABASE_URL)
qs = parse_qs(parsed.query)
unsupported = {"sslmode", "sslrootcert", "channel_binding", "sslcert", "sslkey"}
qs = {k: v for k, v in qs.items() if k not in unsupported}
DATABASE_URL = urlunparse(parsed._replace(query=urlencode(qs, doseq=True)))

connect_args: dict[str, object] = {
    "server_settings": {
        "application_name": "pagepay_backend",
    },
}

if DATABASE_URL.startswith("postgresql+asyncpg://"):
    ssl_context = ssl.create_default_context()
    if settings.environment == "production":
        ssl_context.check_hostname = True
        ssl_context.verify_mode = ssl.CERT_REQUIRED
    else:
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE
    connect_args["ssl"] = ssl_context

engine = create_async_engine(
    DATABASE_URL,
    # Pool tuning lives in settings (env-overridable). See config.py:
    # DB_POOL_SIZE / DB_MAX_OVERFLOW / DB_POOL_RECYCLE_SECONDS.
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    pool_recycle=settings.db_pool_recycle_seconds,
    connect_args=connect_args,
    pool_pre_ping=True,
    echo=False,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
