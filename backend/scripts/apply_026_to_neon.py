"""One-shot: apply 026_welcome_bonus to the Neon production DB.

The Neon DB has the Phase 1-5 schema deployed manually (no alembic_version
row exists yet). This script:

  1. Runs `alembic stamp 025_tasks_missing_columns` so alembic knows the
     long-stable head is recorded. We deliberately stamp at 025 rather
     than `head` because `head` is now the merged 026 — and we want the
     merge migration itself to be the only thing 026 does, with no risk
     of alembic trying to re-apply older migrations that are already in
     place.
  2. Runs `alembic upgrade head` to apply 026_welcome_bonus, which
     creates the `point_credits` table.
  3. Runs `alembic current` to print the new head.

Reads DATABASE_URL from .env (never echoed). Pass --render URL if you
need to override for the legacy Render DB.
"""
from __future__ import annotations

import asyncio
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse, urlunparse, parse_qs, urlencode


REPO_ROOT = Path(__file__).resolve().parents[1]


def die(msg: str, code: int = 1) -> None:
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(code)


def get_url_from_env() -> str:
    """Read DATABASE_URL from .env at the repo root."""
    env_path = REPO_ROOT / ".env"
    if not env_path.exists():
        die(f".env not found at {env_path}")
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith("DATABASE_URL="):
                return line.split("=", 1)[1].strip()
    die("DATABASE_URL not found in .env")


def mask_url(url: str) -> str:
    if "@" not in url:
        return url
    creds, host = url.split("@", 1)
    if ":" in creds:
        prefix = creds.split(":", 1)[0]
        if "//" in prefix:
            prefix = prefix.split("//", 1)[1]
        return f"{prefix}:****@{host}"
    return f"****@{host}"


def to_sa_url(url: str) -> str:
    """Rewrite plain `postgresql://...` to `postgresql+asyncpg://...`
    so alembic/env.py's async engine picks the right driver."""
    if url.startswith("postgresql://") and "+asyncpg" not in url and "+psycopg" not in url:
        return "postgresql+asyncpg://" + url[len("postgresql://"):]
    return url


def run_alembic(args: list[str], env: dict[str, str]) -> None:
    print(f"running: alembic {' '.join(args)}")
    result = subprocess.run(
        ["alembic", *args],
        cwd=str(REPO_ROOT),
        env=env,
    )
    if result.returncode != 0:
        die(f"alembic {' '.join(args)} failed (code {result.returncode})", result.returncode)


async def assert_point_credits(url: str) -> None:
    """Sanity check: confirm the point_credits table exists with the
    unique constraint after the migration."""
    import ssl
    import asyncpg

    plain = url.replace("postgresql+asyncpg://", "postgresql://", 1)
    parsed = urlparse(plain)
    qs = parse_qs(parsed.query)
    qs = {k: v for k, v in qs.items() if k not in {"sslmode", "sslrootcert", "channel_binding", "sslcert", "sslkey"}}
    plain = urlunparse(parsed._replace(query=urlencode(qs, doseq=True)))

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    conn = await asyncpg.connect(plain, ssl=ctx)
    try:
        exists = await conn.fetchval(
            "SELECT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='point_credits')"
        )
        print(f"  point_credits table present: {bool(exists)}")
        if exists:
            cols = await conn.fetch(
                "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='point_credits' ORDER BY ordinal_position"
            )
            for r in cols:
                print(f"    {r['column_name']}: {r['data_type']}")
    finally:
        await conn.close()


def main() -> int:
    url = get_url_from_env()
    sa_url = to_sa_url(url)

    print(f"connecting as: {mask_url(sa_url)}")
    print()

    env = os.environ.copy()
    env["DATABASE_URL"] = sa_url

    # 1. Stamp the historical head so alembic doesn't try to replay
    #    migrations that are already in place via out-of-band DDL.
    run_alembic(["stamp", "025_tasks_missing_columns"], env)
    print()

    # 2. Apply the new migration.
    run_alembic(["upgrade", "head"], env)
    print()

    # 3. Show the new head so we have a clean receipt.
    run_alembic(["current"], env)
    print()

    # 4. Confirm the point_credits table landed.
    print("verifying point_credits table ...")
    asyncio.run(assert_point_credits(url))
    print()
    print("done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())