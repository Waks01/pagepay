"""Destructive re-ingest of the OpenStax catalog in production.

This script is the operational counterpart to the v3 ingest fix
(`backend/app/services/content/openstax.py`). The old code only
fetched each chapter's intro page; the new code walks the section
chain via OpenStax's prev/next nav, which produces the real 7-30
slices per chapter instead of 1.

To get the new structure into production we have to wipe the old
OpenStax rows from `content_catalog` and re-ingest. Cascading FKs
will sweep up `reading_progress`, `slice_bookmarks`, and the
`reading_units` rows attached to the old slices.

Why this script is destructive and can't be idempotent
------------------------------------------------------
The import itself is idempotent on `(title, source_url)` — a re-run
skips any book already in the catalog. To get the new slice
structure we MUST drop the old parent (and cascade-delete the old
slices + their reading_units + their progress) before the
importer will treat the book as "new" again. The "class_level"
column the migration adds also needs to populate, and the importer
sets that field per BookEntry on every run — a partial update
would leave some books with `class_level=None` while others have
the real value.

So the operation is:

    1. DELETE FROM content_catalog WHERE source='openstax'
       (cascades: reading_units, slice_bookmarks, reading_progress
        on the deleted slice ids)
    2. import_openstax_books() — re-inserts parent + slices + units

Usage
-----
    # Dry run — show what would be deleted and the books that would
    # be re-ingested, but touch nothing.
    python scripts/reingest_openstax.py --dry-run "<external_url>"

    # Re-ingest all 12 OpenStax books. Requires --yes to confirm the
    # destructive DELETE.
    python scripts/reingest_openstax.py --yes "<external_url>"

    # Re-ingest a single book. Useful for verifying the fix on one
    # book before wiping all 12.
    python scripts/reingest_openstax.py --yes --only-slug university-physics-volume-1 "<external_url>"

The URL is the EXTERNAL Database URL from the Render dashboard,
exactly the same convention as run_prod_migration.py.

Caveat: `import_openstax_books` is idempotent on the SLUG, not the
shape. If you have an old `university-physics-volume-1` parent with
only 1 slice and you re-run this script, the importer sees the
parent still there and skips it. So the DELETE in step 1 is not
optional — it's the mechanism that lets the importer treat the
book as "new" and produce the full 30-slice structure.

The progress + bookmarks that get deleted belong to users who read
the broken (1-slice) version of the books. They'll lose their
"continue reading" pointer into those books and their scroll
position, but the books themselves will be back at full fidelity
within the next minute. The catalog refresh + the client-side
`/continue` endpoint will just show "Not started" for the affected
books — same UX as opening them for the first time.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import ssl
import sys
import time
from pathlib import Path

# Make the backend app importable when this script is run from
# anywhere (not just the scripts/ directory). The repo layout is
# backend/scripts/<this>.py, so backend/ is parents[1].
REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import asyncpg  # noqa: E402
from sqlalchemy.ext.asyncio import (  # noqa: E402
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

# We deliberately do NOT import app.config or app.models at module
# level. app.config instantiates a pydantic Settings() on import
# and fails if DATABASE_URL / SECRET_KEY aren't set in the env —
# this script takes the database URL on the command line, not from
# the env, so the operator doesn't need a populated .env to run it.
# app.models has its own dependency on the database URL through
# SQLAlchemy's metadata; we use raw asyncpg + the SQLAlchemy async
# engine (which we build with our own DSN) instead of touching it.
from app.services.content.openstax import (  # noqa: E402
    CURRICULUM,
    BookEntry,
    import_openstax_books,
)


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("reingest_openstax")


# ── DB connection helpers ──────────────────────────────────────────
# We open a separate asyncpg connection for the destructive DELETE
# so we can use the simpler raw-SQL path, and then the SQLAlchemy
# async engine for the actual import. The DELETE doesn't need
# SQLAlchemy — it just needs to run once, transactionally, with the
# right connection. The import needs SQLAlchemy so the slicer
# flushes + commits per book the way the rest of the app expects.


def build_asyncpg_dsn(external_url: str) -> str:
    """Convert the external postgresql:// URL to an asyncpg DSN.

    The external URL is what Render exposes on the dashboard. It
    already uses sslmode=require for psycopg2, which asyncpg also
    accepts in the DSN. We strip the query string and rebuild it
    with explicit SSL context — Render's Postgres requires SSL.
    """
    dsn = external_url
    # Normalize scheme for asyncpg (it expects postgresql://, not
    # postgresql+asyncpg://).
    if dsn.startswith("postgresql+asyncpg://"):
        dsn = dsn.replace("postgresql+asyncpg://", "postgresql://", 1)
    return dsn


def build_sqlalchemy_dsn(external_url: str) -> str:
    """Convert the external URL to a SQLAlchemy asyncpg DSN.

    Same URL the app uses in production. We let the connection use
    the env SSL config (verify-mode=CERT_REQUIRED when
    ENVIRONMENT=production) by going through `settings.database_url`
    when possible. For this script the user passes the URL on the
    command line, so we adapt it ourselves.
    """
    dsn = external_url
    if dsn.startswith("postgresql://"):
        dsn = dsn.replace("postgresql://", "postgresql+asyncpg://", 1)
    elif dsn.startswith("postgres://"):
        dsn = dsn.replace("postgres://", "postgresql+asyncpg://", 1)
    return dsn


async def count_openstax_rows(conn: asyncpg.Connection) -> dict:
    """Return a snapshot of what's currently in the OpenStax catalog.

    Returns a dict with:
      - parents: count of content_catalog rows with source='openstax'
                 AND parent_work_id IS NULL
      - slices:  count of content_catalog rows with source='openstax'
                 AND parent_work_id IS NOT NULL
      - units:   count of reading_units rows whose slice_id belongs
                 to an openstax slice
      - progress_rows: count of reading_progress rows that point at
                       an openstax parent
      - bookmark_rows: count of slice_bookmarks rows that point at
                       an openstax slice

    These counts let the user see the blast radius of the DELETE
    before they confirm with --yes.
    """
    parents = await conn.fetchval(
        "SELECT COUNT(*) FROM content_catalog "
        "WHERE source='openstax' AND parent_work_id IS NULL"
    )
    slices = await conn.fetchval(
        "SELECT COUNT(*) FROM content_catalog "
        "WHERE source='openstax' AND parent_work_id IS NOT NULL"
    )
    units = await conn.fetchval(
        "SELECT COUNT(*) FROM reading_units ru "
        "JOIN content_catalog cc ON cc.id = ru.slice_id "
        "WHERE cc.source='openstax'"
    )
    progress_rows = await conn.fetchval(
        "SELECT COUNT(*) FROM reading_progress rp "
        "JOIN content_catalog cc ON cc.id = rp.work_id "
        "WHERE cc.source='openstax'"
    )
    bookmark_rows = await conn.fetchval(
        "SELECT COUNT(*) FROM slice_bookmarks sb "
        "JOIN content_catalog cc ON cc.id = sb.slice_id "
        "WHERE cc.source='openstax'"
    )
    return {
        "parents": int(parents or 0),
        "slices": int(slices or 0),
        "units": int(units or 0),
        "progress_rows": int(progress_rows or 0),
        "bookmark_rows": int(bookmark_rows or 0),
    }


async def list_openstax_slugs(conn: asyncpg.Connection) -> list[str]:
    """Return the distinct slugs (source_url substrings) currently
    in the OpenStax catalog, ordered alphabetically. Used by --dry-run
    and the confirmation prompt to show the user exactly which books
    are about to be wiped.
    """
    rows = await conn.fetch(
        "SELECT DISTINCT source_url FROM content_catalog "
        "WHERE source='openstax' AND source_url LIKE 'openstax:%' "
        "ORDER BY source_url"
    )
    return [r["source_url"].removeprefix("openstax:") for r in rows]


async def delete_openstax_rows(
    conn: asyncpg.Connection,
    only_slugs: list[str] | None = None,
) -> dict:
    """Delete all openstax-source rows from content_catalog.

    If `only_slugs` is provided, only delete rows whose source_url
    matches `openstax:{slug}` for one of those slugs. Otherwise
    every openstax row goes.

    The FKs in the schema cascade:
      - reading_units.slice_id  → content_catalog.id
      - slice_bookmarks.slice_id → content_catalog.id
      - reading_progress.work_id → content_catalog.id (only on the
        parent; progress on child slices is rare in practice but
        also possible via work_id=child.id in casual reader code)

    We use raw SQL with RETURNING to get the actual deleted-id
    counts, not the .rowcount estimate (PostgreSQL's rowcount for
    multi-row DELETEs is "rows that passed the WHERE", which is
    what we want, but RETURNING is more honest and doesn't depend
    on the driver).

    Returns a dict with the delete counts so the user can see
    exactly what happened.
    """
    if only_slugs:
        # Build a parameterized IN clause. asyncpg's parameter
        # substitution for `= ANY($1::text[])` is the cleanest
        # way to do this safely.
        parent_rows = await conn.fetch(
            "DELETE FROM content_catalog "
            "WHERE source='openstax' AND parent_work_id IS NULL "
            "  AND source_url = ANY($1::text[]) "
            "RETURNING id",
            [f"openstax:{s}" for s in only_slugs],
        )
        # Cascading FKs handle the children. We don't need to
        # issue additional DELETEs — the parent drop cascades.
        return {
            "parents_deleted": len(parent_rows),
            "only_slugs": only_slugs,
        }
    parent_rows = await conn.fetch(
        "DELETE FROM content_catalog "
        "WHERE source='openstax' AND parent_work_id IS NULL "
        "RETURNING id"
    )
    return {
        "parents_deleted": len(parent_rows),
        "only_slugs": None,
    }


def make_async_engine(external_url: str):
    """Build a SQLAlchemy async engine pointed at the external URL.

    Mirrors the SSL config in app/database.py so we can talk to
    Render's Postgres the same way the running app does. We set
    ENVIRONMENT=production in the env for the duration of this
    script so the SSL context is strict (Render requires
    CERT_REQUIRED).
    """
    import os
    os.environ.setdefault("ENVIRONMENT", "production")

    dsn = build_sqlalchemy_dsn(external_url)
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = True
    ssl_context.verify_mode = ssl.CERT_REQUIRED

    engine = create_async_engine(
        dsn,
        pool_size=2,  # script runs once; we don't need 20
        max_overflow=0,
        connect_args={"ssl": ssl_context},
    )
    return engine


def filter_curriculum(only_slugs: list[str] | None) -> list[BookEntry]:
    """Return the subset of CURRICULUM the user asked for.

    If only_slugs is None, return the whole list. If a slug is
    not in CURRICULUM we still include a synthetic BookEntry so
    the user can re-ingest an old book that's not in the current
    curriculum — better to make the import do its best than to
    silently drop it.
    """
    if only_slugs is None:
        return list(CURRICULUM)

    by_slug = {b.slug: b for b in CURRICULUM}
    out: list[BookEntry] = []
    for s in only_slugs:
        if s in by_slug:
            out.append(by_slug[s])
        else:
            # Synthetic entry — we don't have the full attribution
            # or subject for an unknown slug, so the caller has
            # to accept that. We use sensible defaults that
            # match the other entries.
            out.append(
                BookEntry(
                    slug=s,
                    subject="general",
                    education_level="tertiary",
                    attribution=(
                        "Source: OpenStax, Rice University. "
                        "Licensed under CC BY 4.0."
                    ),
                    short_label=s,
                )
            )
    return out


def print_summary(slug: str, book_result: dict, elapsed: float) -> None:
    """One log line per book with the key counts.

    Format mirrors what the admin /seed endpoint logs so the
    output is consistent with whatever the operator already
    sees in production.
    """
    log.info(
        "  %-38s scanned=%d imported=%d skipped=%d "
        "chapters=%d slices=%d (%.1fs)",
        slug,
        book_result.get("books_scanned", 0),
        book_result.get("books_imported", 0),
        book_result.get("books_skipped", 0),
        book_result.get("chapters_total", 0),
        book_result.get("slices_total", 0),
        elapsed,
    )


async def run_import(
    session_factory: async_sessionmaker[AsyncSession],
    curriculum: list[BookEntry],
) -> dict:
    """Run import_openstax_books for the given curriculum.

    We import one book at a time and log per-book results, so a
    long ingest has visible progress. The function returns the
    aggregate summary across all books.
    """
    agg = {
        "books_scanned": 0,
        "books_imported": 0,
        "books_skipped": 0,
        "chapters_total": 0,
        "slices_total": 0,
    }
    t_total = time.monotonic()

    # Reuse import_openstax_books in single-book mode so we get
    # per-book logging. The function takes a curriculum list, so
    # we call it once per book.
    for book in curriculum:
        t0 = time.monotonic()
        async with session_factory() as db:
            result = await import_openstax_books(db, curriculum=[book])
        elapsed = time.monotonic() - t0
        for k in agg:
            agg[k] += result.get(k, 0)
        print_summary(book.slug, result, elapsed)

    log.info(
        "  ── total: scanned=%d imported=%d skipped=%d "
        "chapters=%d slices=%d (%.1fs)",
        agg["books_scanned"],
        agg["books_imported"],
        agg["books_skipped"],
        agg["chapters_total"],
        agg["slices_total"],
        time.monotonic() - t_total,
    )
    return agg


async def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Destructive re-ingest of the OpenStax catalog. "
            "Wipes all rows with source='openstax' from "
            "content_catalog (cascading to reading_progress, "
            "slice_bookmarks, reading_units) and re-runs the "
            "OpenStax importer. Use --dry-run first."
        ),
    )
    parser.add_argument(
        "database_url",
        help=(
            "External PostgreSQL URL from the Render dashboard "
            "(the one with .ohio-postgres.render.com in the host, "
            "NOT the internal one)."
        ),
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Skip the interactive destructive-DELETE confirmation.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be deleted and the books that would be "
             "re-ingested, but touch nothing.",
    )
    parser.add_argument(
        "--only-slug",
        action="append",
        default=None,
        help=(
            "Limit the re-ingest to a single OpenStax slug (e.g. "
            "'university-physics-volume-1'). Can be passed multiple "
            "times. If omitted, all 12 books in CURRICULUM are "
            "re-ingested. The DELETE is also scoped to the same "
            "slugs when this flag is set."
        ),
    )
    args = parser.parse_args()

    dsn_asyncpg = build_asyncpg_dsn(args.database_url)

    # ── Step 1: count + list what's currently in the catalog ─────
    log.info("Connecting to %s ...", dsn_asyncpg.split("@")[-1])
    conn = await asyncpg.connect(dsn=dsn_asyncpg, ssl="require")
    try:
        counts = await count_openstax_rows(conn)
        slugs = await list_openstax_slugs(conn)
    finally:
        await conn.close()

    target_slugs = args.only_slug
    if target_slugs:
        scoped_slugs = [s for s in slugs if s in target_slugs]
    else:
        scoped_slugs = slugs

    log.info("Current OpenStax catalog state:")
    log.info("  parents (books):     %d", counts["parents"])
    log.info("  slices:              %d", counts["slices"])
    log.info("  reading_units:       %d", counts["units"])
    log.info("  reading_progress:    %d", counts["progress_rows"])
    log.info("  slice_bookmarks:     %d", counts["bookmark_rows"])
    log.info("  distinct slugs:      %d", len(slugs))
    if target_slugs:
        log.info(
            "  scope:               only-slug = %s (will affect %d of %d slugs)",
            target_slugs, len(scoped_slugs), len(slugs),
        )
    if scoped_slugs:
        for s in scoped_slugs:
            log.info("    - %s", s)

    # ── Step 2: dry-run short-circuit ─────────────────────────────
    if args.dry_run:
        log.info(
            "Dry run: would DELETE %d openstax parents and re-ingest "
            "%d books. No changes made. Re-run with --yes to execute.",
            len(scoped_slugs), len(target_slugs or CURRICULUM),
        )
        return 0

    # ── Step 3: destructive confirmation ─────────────────────────
    if not args.yes:
        log.warning(
            "This will DELETE %d openstax parents from content_catalog, "
            "cascading to their slices, reading_units, slice_bookmarks, "
            "and reading_progress rows. The 1-slice versions of these "
            "books will be replaced with the new 7-30 slice versions.",
            len(scoped_slugs),
        )
        try:
            answer = input("Type 'yes' to continue: ").strip().lower()
        except EOFError:
            log.error("No interactive input available. Re-run with --yes.")
            return 2
        if answer != "yes":
            log.info("Aborted. No changes made.")
            return 1

    # ── Step 4: DELETE ────────────────────────────────────────────
    conn = await asyncpg.connect(dsn=dsn_asyncpg, ssl="require")
    try:
        async with conn.transaction():
            result = await delete_openstax_rows(
                conn,
                only_slugs=target_slugs,
            )
    finally:
        await conn.close()

    log.info(
        "Deleted %d openstax parents (cascading to children).",
        result["parents_deleted"],
    )

    # ── Step 5: re-ingest ─────────────────────────────────────────
    curriculum = filter_curriculum(target_slugs)
    log.info(
        "Re-ingesting %d book(s): %s",
        len(curriculum),
        ", ".join(b.slug for b in curriculum),
    )

    engine = make_async_engine(args.database_url)
    session_factory = async_sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    try:
        agg = await run_import(session_factory, curriculum)
    finally:
        await engine.dispose()

    # ── Step 6: final report ──────────────────────────────────────
    log.info("=" * 60)
    log.info("Re-ingest complete.")
    log.info("  Parents deleted:  %d", result["parents_deleted"])
    log.info("  Books scanned:    %d", agg["books_scanned"])
    log.info("  Books imported:   %d", agg["books_imported"])
    log.info("  Books skipped:    %d", agg["books_skipped"])
    log.info("  Chapters total:   %d", agg["chapters_total"])
    log.info("  Slices total:     %d", agg["slices_total"])
    if agg["books_imported"] == 0:
        log.warning(
            "No books were imported. Check the per-book log lines "
            "above for the specific reason (license gate, 404 chain "
            "broke too early, slicer produced 0 slices, etc.)."
        )
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
