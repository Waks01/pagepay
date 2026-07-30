from logging.config import fileConfig
import asyncio
import ssl
from urllib.parse import urlparse, urlunparse, parse_qs, urlencode

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

from app.config import settings
from app.models import Base

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# add your model's MetaData object here
# for 'autogenerate' support
target_metadata = Base.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def get_url() -> str:
    """Get database URL from settings, with SSL params stripped.

    SQLAlchemy's asyncpg dialect auto-unpacks the URL's query string
    into asyncpg.connect() kwargs. asyncpg doesn't accept `sslmode`,
    `channel_binding`, etc. — it uses `ssl` (SSLContext). We strip the
    psycopg2-style params here and let asyncpg default to SSL-on (which
    Neon also requires). The asyncpg engine in `app/database.py` does
    the same thing for the runtime engine.
    """
    url = settings.database_url
    if not url.startswith("postgresql+asyncpg://"):
        return url
    parsed = urlparse(url)
    qs = parse_qs(parsed.query)
    unsupported = {"sslmode", "sslrootcert", "channel_binding", "sslcert", "sslkey"}
    qs = {k: v for k, v in qs.items() if k not in unsupported}
    return urlunparse(parsed._replace(query=urlencode(qs, doseq=True)))


def _connect_args() -> dict:
    """Build connect_args for the asyncpg engine with a real SSL context.

    asyncpg requires an ssl.SSLContext (not the `sslmode` string), so
    we construct one here and pass it explicitly. Without this, asyncpg
    refuses to connect to Neon (which requires TLS).
    """
    ctx = ssl.create_default_context()
    if settings.environment == "production":
        ctx.check_hostname = True
        ctx.verify_mode = ssl.CERT_REQUIRED
    else:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    return {"ssl": ctx}


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = get_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """In this scenario we need to create an Engine
    and associate a connection with the context.

    """

    section = config.get_section(config.config_ini_section, {})
    # Merge connect_args so asyncpg gets a real SSLContext, not a string.
    section["connect_args"] = _connect_args()
    connectable = async_engine_from_config(
        section,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
        url=get_url(),
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""

    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
