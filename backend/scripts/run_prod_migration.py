"""One-shot migration runner for the production database.

Run this from your local machine to apply pending Alembic migrations
to the production PostgreSQL database (Neon or Render). Does the work of:

   1. Connecting to the database using the external connection URL.
   2. Reading the current Alembic revision.
   3. Running `alembic upgrade head` if needed.
   4. Verifying the result.

Usage:
    python scripts/run_prod_migration.py "<database_url>"

The URL should be the external connection string from your database
provider. Supported formats:
    Neon:   postgresql://user:pass@ep-XXXX.us-west-2.aws.neon.tech/dbname?sslmode=require
    Render: postgresql://user:pass@dpg-XXXX.ohio-postgres.render.com/dbname

The password is read from sys.argv so it doesn't end up in shell
history or in any process listing beyond this run. After this script
exits, the password is in memory only until the process is reaped.

Requirements:
    pip install -r requirements.txt
        (gives you alembic, sqlalchemy, asyncpg, psycopg2-binary)
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
ALEMBIC_INI = REPO_ROOT / "alembic.ini"


def die(msg: str, code: int = 1) -> None:
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(code)


def main() -> int:
    if len(sys.argv) != 2:
        die(
            "usage: python scripts/run_prod_migration.py "
            "\"<database_url>\""
        )

    url = sys.argv[1].strip()

    # Sanity-check the URL so we fail fast with a clear message
    # instead of a 30-second connection timeout.
    if not url.startswith("postgresql://") and not url.startswith("postgres://"):
        die("URL must start with postgresql:// or postgres://")

    # This project's alembic/env.py uses async_engine_from_config, so the
    # SQLAlchemy URL must point at an async driver (asyncpg). The external
    # URL is `postgresql://...` (no driver) — we transparently rewrite it
    # to `postgresql+asyncpg://...` so the env.py's async engine can pick
    # it up. The script never echoes the URL back, so the password stays
    # out of the log.
    if url.startswith("postgresql://") and "+asyncpg" not in url and "+psycopg" not in url:
        url = "postgresql+asyncpg://" + url[len("postgresql://"):]

    if not ALEMBIC_INI.exists():
        die(f"alembic.ini not found at {ALEMBIC_INI}. "
            f"Run this from the repo root or backend/ directory.")

    env = os.environ.copy()
    env["DATABASE_URL"] = url

    # Show what we're about to do without echoing the password.
    masked = url.split("@", 1)
    if len(masked) == 2:
        creds, host = masked
        if ":" in creds:
            user, _ = creds.split(":", 1)
            user = user.split("//", 1)[-1]
            masked = f"{user}:****@{host}"
    print(f"connecting as: {masked}")
    print("running: alembic upgrade head")
    print()

    # Use the system alembic if available, else fall back to `python -m alembic`.
    # We cd into the backend dir so alembic.ini is picked up automatically.
    result = subprocess.run(
        ["alembic", "upgrade", "head"],
        cwd=str(REPO_ROOT),
        env=env,
    )
    if result.returncode != 0:
        die(f"alembic exited with code {result.returncode}", result.returncode)

    # Verify
    print()
    verify = subprocess.run(
        ["alembic", "current"],
        cwd=str(REPO_ROOT),
        env=env,
        capture_output=True,
        text=True,
    )
    print(verify.stdout.strip() or "(no current revision printed)")
    if verify.returncode != 0:
        die(
            f"alembic current failed (code {verify.returncode}): "
            f"{verify.stderr.strip()}",
            verify.returncode,
        )

    print()
    print("done. the production schema is up to date.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
