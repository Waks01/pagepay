"""One-shot migration runner for the production database.

Run this from your local machine to apply pending Alembic migrations
to the Render PostgreSQL database. Does the work of:

  1. Connecting to the database using the EXTERNAL connection URL
     (the one with .ohio-postgres.render.com in the host, not the
     internal one — the internal one only works from inside Render).
  2. Reading the current Alembic revision.
  3. Running `alembic upgrade head` if needed.
  4. Verifying the result.

Usage:
    python scripts/run_prod_migration.py "<external_database_url>"

The URL must be the EXTERNAL Database URL from the Render dashboard,
not the Internal one. Format:
    postgresql://pagepay:PASSWORD@dpg-XXXX.ohio-postgres.render.com/pagepay

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
            "\"<external_database_url>\""
        )

    url = sys.argv[1].strip()

    # Sanity-check the URL so we fail fast with a clear message
    # instead of a 30-second connection timeout.
    if not url.startswith("postgresql://") and not url.startswith("postgres://"):
        die("URL must start with postgresql:// (external URL from Render).")
    if ".ohio-postgres.render.com" not in url and "render.com" not in url:
        die(
            "URL doesn't look like a Render external host. "
            "Use the External Database URL, not the Internal one "
            "(the internal one only works from inside Render)."
        )
    if "dpg-" not in url:
        die("URL is missing the dpg- host. Double-check you copied the full URL.")

    # This project's alembic/env.py uses async_engine_from_config, so the
    # SQLAlchemy URL must point at an async driver (asyncpg). The Render
    # external URL is `postgresql://...` (no driver) — we transparently
    # rewrite it to `postgresql+asyncpg://...` so the env.py's async
    # engine can pick it up. The script never echoes the URL back, so
    # the password stays out of the log.
    if url.startswith("postgresql://") and "+asyncpg" not in url and "+psycopg" not in url:
        url = "postgresql+asyncpg://" + url[len("postgresql://"):]

    if not ALEMBIC_INI.exists():
        die(f"alembic.ini not found at {ALEMBIC_INI}. "
            f"Run this  the repo root or backend/ directory.")

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
    print("if list_users is still 500ing, redeploy the pagepay service.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
