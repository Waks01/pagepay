"""Recover from alembic / schema drift on the production database.

The production database has the right *columns* (created by some
out-of-band process — manual ALTERs, a prior schema sync, etc.) but
`alembic_version` is empty. Running `alembic upgrade head` from
scratch fails on the first duplicate column, even though every
column the chain wants already exists.

Recovery:

  1. `alembic stamp head` — write the current head revision into
     `alembic_version` without running any DDL. This stops the chain
     from trying to re-apply migrations 001–010.

  2. Connect, read the `users` table schema, and compare it against
     the columns migration 010 adds. For any column the model
     declares but the table doesn't have, run an `ADD COLUMN IF NOT
     EXISTS` with the same defaults and types as 010.

  3. Print a final status report and exit.

Idempotent and safe to re-run.

Usage:
    python scripts/recover_prod_schema.py "<external_database_url>"
"""
from __future__ import annotations

import asyncio
import os
import subprocess
import sys
from pathlib import Path

import asyncpg


REPO_ROOT = Path(__file__).resolve().parents[1]

# Columns migration 010_add_user_auth_columns adds to the users
# table. Mirrored from the migration file so we can verify and
# backfill any column that alembic didn't get a chance to add.
EXPECTED_USER_COLUMNS: dict[str, str] = {
    "failed_login_attempts":          "INTEGER DEFAULT 0",
    "locked_until":                   "TIMESTAMP NULL",
    "email_verified":                 "BOOLEAN DEFAULT FALSE",
    "email_verification_token":       "VARCHAR(255) NULL",
    "email_verification_expires_at":  "TIMESTAMP NULL",
    "last_login_at":                  "TIMESTAMP NULL",
    "last_login_ip":                  "VARCHAR(45) NULL",
    "last_login_user_agent":          "VARCHAR(255) NULL",
    "device_fingerprint":             "VARCHAR(255) NULL",
    "sponsor_kyc_status":             "VARCHAR(20) DEFAULT 'none'",
    "sponsor_kyc_submitted_at":       "TIMESTAMP NULL",
    "sponsor_kyc_reviewed_at":        "TIMESTAMP NULL",
    "sponsor_kyc_reviewer_id":        "BIGINT NULL",
    "business_name":                  "VARCHAR(255) NULL",
    "business_registration_number":   "VARCHAR(100) NULL",
    "sponsor_auto_approve_ai":        "BOOLEAN DEFAULT FALSE",
    "gender":                         "VARCHAR(20) NULL",
    "date_of_birth":                  "TIMESTAMP NULL",
    "city":                           "VARCHAR(100) NULL",
    "country":                        "VARCHAR(50) DEFAULT 'Nigeria'",
    "languages":                      "TEXT NULL",
}


def die(msg: str, code: int = 1) -> None:
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(code)


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


def to_asyncpg_url(url: str) -> str:
    """Rewrite `postgresql://` → `postgresql+asyncpg://` for SQLAlchemy
    when needed, and to plain `postgresql://` for asyncpg directly."""
    if url.startswith("postgresql+asyncpg://"):
        return url.replace("postgresql+asyncpg://", "postgresql://", 1)
    return url


def stamp_head(url: str) -> None:
    """Run `alembic stamp head` against the given URL. Writes the
    current head revision into `alembic_version` without running DDL."""
    env = os.environ.copy()
    # For stamp, use the SQLAlchemy async URL (matches env.py).
    sa_url = url
    if sa_url.startswith("postgresql://") and "+asyncpg" not in sa_url:
        sa_url = "postgresql+asyncpg://" + sa_url[len("postgresql://"):]
    env["DATABASE_URL"] = sa_url

    print(f"running: alembic stamp head  ({mask_url(sa_url)})")
    result = subprocess.run(
        ["alembic", "stamp", "head"],
        cwd=str(REPO_ROOT),
        env=env,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(result.stdout)
        print(result.stderr, file=sys.stderr)
        die(f"alembic stamp head failed (code {result.returncode})", result.returncode)
    if result.stdout.strip():
        print(result.stdout.strip())


async def add_missing_columns(url: str) -> tuple[int, list[str]]:
    """Connect, list users columns, add any from EXPECTED_USER_COLUMNS
    that are missing. Returns (added_count, added_list)."""
    conn = await asyncpg.connect(to_asyncpg_url(url))
    try:
        existing = {
            row["column_name"]
            for row in await conn.fetch(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = 'users' AND table_schema = 'public'
                """
            )
        }
        print(f"users table currently has {len(existing)} columns.")

        added: list[str] = []
        for col, ddl in EXPECTED_USER_COLUMNS.items():
            if col in existing:
                continue
            sql = f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {col} {ddl}"
            print(f"  adding {col} ...")
            await conn.execute(sql)
            added.append(col)
        return len(added), added
    finally:
        await conn.close()


async def main_async(url: str) -> int:
    print(f"connecting as: {mask_url(url)}")
    print()
    stamp_head(url)
    print()
    added_count, added = await add_missing_columns(url)
    if added_count:
        print()
        print(f"added {added_count} missing columns: {', '.join(added)}")
    else:
        print("no missing columns. schema matches model.")
    print()
    print("done. the production schema is up to date.")
    print("if list_users is still 500ing, redeploy the pagepay service.")
    return 0


def main() -> int:
    if len(sys.argv) != 2:
        die(
            "usage: python scripts/recover_prod_schema.py "
            "\"<external_database_url>\""
        )

    url = sys.argv[1].strip()
    if ".render.com" not in url:
        die("URL doesn't look like a Render external host.")
    if "dpg-" not in url:
        die("URL is missing the dpg- host.")
    return asyncio.run(main_async(url))


if __name__ == "__main__":
    sys.exit(main())
