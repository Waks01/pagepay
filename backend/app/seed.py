"""Idempotent seed for the Phase 2 ad-infrastructure tables.

Run via the lifespan hook in `app/main.py`. Safe to call repeatedly —
we SELECT-then-INSERT on the natural key (placement, app_config.key,
provider_name) so re-running never throws and never duplicates.

This file is the only place that hardcodes the production AdMob unit
IDs. The client reads them indirectly via `GET /api/v1/config/ads`
which filters `app_config` by `environment`. When AppLovin lands,
add new rows here — the existing app_config schema already has a
column for it.
"""

import json
import logging
import os
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AdPlacement, AppConfig, AiProviderHealth, AdminUser, ContentCatalog
from app.config import settings


logger = logging.getLogger("uvicorn.error")


# ── AdMob unit IDs ──────────────────────────────────────────────────
# Mirrors `admob.md` at the repo root. App IDs (`~...`) come from
# `settings.admob_app_id_android` / `settings.admob_app_id_ios`
# (env vars). Unit IDs (`/...`) are public ad unit identifiers and
# are listed here for seeding. When AppLovin lands, add new rows
# here — the existing app_config schema already has a column for it.

_ADMOB_APP_ID_ANDROID = settings.admob_app_id_android or "ca-app-pub-3898064484524772~6521009021"
_ADMOB_APP_ID_IOS = settings.admob_app_id_ios or "ca-app-pub-3898064484524772~4871553842"

# Per-platform unit IDs. Keys are (location, platform).
_UNIT_IDS: dict[tuple[str, str], str] = {
    # Android
    ("in_feed", "android"):      "ca-app-pub-3898064484524772/6538723260",  # pagepay_nativeAdvanced
    ("interstitial", "android"): "ca-app-pub-3898064484524772/8633302518",  # pagepay_interstitial
    ("rewarded", "android"):     "ca-app-pub-3898064484524772/4958048285",  # pagepay_rewarded
    ("banner", "android"):       "ca-app-pub-3898064484524772/7400111898",  # pagepay_banner
    # iOS
    ("in_feed", "ios"):          "ca-app-pub-3898064484524772/9882805007",  # pagepay_nativeAdvanced_ios
    ("interstitial", "ios"):     "ca-app-pub-3898064484524772/7312481982",  # pagepay_interstitial_ios
    ("rewarded", "ios"):         "ca-app-pub-3898064484524772/8242420273",  # pagepay_rewarded_ios
    ("banner", "ios"):           "ca-app-pub-3898064484524772/2638739802",  # pagepay_banner_ios
}

# Mapping from ad_placements.location → ad_type. The two are separate
# columns today (location is the slot in the UI; ad_type is the SDK
# format string) but in v1 they're always the same.
_LOCATION_AD_TYPE = {
    "in_feed": "native",
    "interstitial": "interstitial",
    "rewarded": "rewarded",
    "banner": "banner",
}


async def seed_ad_placements(db: AsyncSession) -> int:
    """Insert any missing rows into ad_placements (idempotent)."""
    rows: list[dict] = []
    for (location, platform), unit_id in _UNIT_IDS.items():
        rows.append({
            "location": location,
            "platform": platform,
            "ad_type": _LOCATION_AD_TYPE[location],
            "priority": 1,
            "primary_provider": "admob",
            "fallback_provider": None,
            "ad_unit_id": unit_id,
            "enabled": True,
        })

    inserted = 0
    for row in rows:
        existing = (
            await db.execute(
                select(AdPlacement).where(
                    (AdPlacement.location == row["location"]) &
                    (AdPlacement.platform == row["platform"])
                )
            )
        ).scalars().first()
        if existing is None:
            db.add(AdPlacement(**row))
            inserted += 1
        elif existing.ad_unit_id != row["ad_unit_id"]:
            existing.ad_unit_id = row["ad_unit_id"]

    if inserted:
        await db.commit()
    return inserted


async def seed_app_config(db: AsyncSession) -> int:
    """Insert the default app_config rows (idempotent)."""
    rows: list[dict] = [
        {
            "key": "app.environment",
            "value": "prod",
            "environment": "prod",
            "description": "Active environment for /api/v1/config/ads filtering.",
        },
        {
            "key": "app.environment",
            "value": "dev",
            "environment": "dev",
            "description": "Active environment for /api/v1/config/ads filtering.",
        },
        {
            "key": "admob.app_id.android",
            "value": _ADMOB_APP_ID_ANDROID,
            "environment": "prod",
            "description": "AdMob App ID for Android (production).",
        },
        {
            "key": "admob.app_id.ios",
            "value": _ADMOB_APP_ID_IOS,
            "environment": "prod",
            "description": "AdMob App ID for iOS (production).",
        },
    ]
    for (location, platform), unit_id in _UNIT_IDS.items():
        rows.append({
            "key": f"admob.{location}.{platform}",
            "value": unit_id,
            "environment": "prod",
            "description": f"AdMob {location} unit ID ({platform}).",
        })

    inserted = 0
    for row in rows:
        existing = (
            await db.execute(
                select(AppConfig).where(AppConfig.key == row["key"])
            )
        ).scalars().first()
        if existing is None:
            db.add(AppConfig(**row))
            inserted += 1
        else:
            existing.value = row["value"]
            existing.description = row["description"]

    if inserted:
        await db.commit()
    return inserted


async def seed_ai_provider_health(db: AsyncSession) -> int:
    """Phase 3 prep: ensure one row per known provider exists (idempotent)."""
    rows: list[dict] = [
        {"provider_name": "openai", "consecutive_failures": 0},
        {"provider_name": "anthropic", "consecutive_failures": 0},
        {"provider_name": "google", "consecutive_failures": 0},
    ]

    inserted = 0
    for row in rows:
        existing = (
            await db.execute(
                select(AiProviderHealth).where(
                    AiProviderHealth.provider_name == row["provider_name"]
                )
            )
        ).scalars().first()
        if existing is None:
            db.add(AiProviderHealth(**row))
            inserted += 1

    if inserted:
        await db.commit()
    return inserted


async def seed_initial_content(db: AsyncSession) -> int:
    """Import a small batch of books if the catalog is empty.

    Idempotent: skips if any parent content already exists. This keeps
    startup fast on warm databases while still populating a fresh one.
    """
    existing = (await db.execute(select(ContentCatalog.id).limit(1))).scalar_one_or_none()
    if existing is not None:
        return 0
    try:
        from app.services.content.gutendex import import_gutendex
        return await import_gutendex(db, limit=20, start_page=1)
    except Exception as exc:  # noqa: BLE001 — startup seed; best-effort
        logger.warning("Initial content seed failed: %s", exc)
        return 0


async def seed_openstax_books(db: AsyncSession) -> int:
    """Pull OpenStax STEM textbooks (CC BY 4.0) on first run.

    Idempotent: skips if any openstax-sourced row already exists in
    content_catalog. The curriculum list lives in
    `app.services.content.openstax.CURRICULUM` — we pull the first
    3 books (the heaviest are physics + calculus, ~30 chapters each)
    on first seed and let the admin /refresh endpoint pull the rest
    on demand. Pulling all 12 at first seed would balloon startup
    time on Render free tier.
    """
    from app.services.content.openstax import import_openstax_books, CURRICULUM
    existing = (await db.execute(
        select(ContentCatalog.id)
        .where(ContentCatalog.source == "openstax")
        .limit(1)
    )).scalar_one_or_none()
    if existing is not None:
        return 0
    try:
        # Seed the first 3 books only. The admin /refresh endpoint
        # can pull the rest.
        summary = await import_openstax_books(db, curriculum=CURRICULUM[:3])
        return summary.get("books_imported", 0)
    except Exception as exc:  # noqa: BLE001 — startup seed; best-effort
        logger.warning("OpenStax seed failed: %s", exc)
        return 0


async def run_all_seeds(db: AsyncSession) -> dict[str, int]:
    """Run every seed. Returns a count of new rows per table for
    startup logging. Failures are logged and swallowed so a partial
    seed (e.g. AppConfig exists but AdPlacement doesn't) doesn't
    crash the API.
    """
    counts: dict[str, int] = {}
    for name, fn in (
        ("ad_placements", seed_ad_placements),
        ("app_config", seed_app_config),
        ("ai_provider_health", seed_ai_provider_health),
        ("app_config_streak", seed_streak_config),
        ("admin_users", seed_admin_users),
        ("content", seed_initial_content),
        ("openstax_books", seed_openstax_books),
    ):
        try:
            counts[name] = await fn(db)
        except Exception as exc:  # noqa: BLE001 — startup seed; best-effort
            logger.warning("Seed %s failed: %s", name, exc)
            counts[name] = 0
    return counts


async def seed_streak_config(db: AsyncSession) -> int:
    """Insert streak bonus multiplier config rows into app_config."""
    from app.models import AppConfig

    rows: list[dict] = [
        {"key": "streak.bonus_7d_multiplier", "value": "1.2", "description": "Multiplier for 7-day streak", "environment": "prod"},
        {"key": "streak.bonus_30d_multiplier", "value": "1.5", "description": "Multiplier for 30-day streak", "environment": "prod"},
        {"key": "streak.bonus_7d_label", "value": "7-day streak (+20%)", "description": "Label for 7-day streak bonus", "environment": "prod"},
        {"key": "streak.bonus_30d_label", "value": "30-day legend (+50%)", "description": "Label for 30-day streak bonus", "environment": "prod"},
    ]

    inserted = 0
    for row in rows:
        existing = (
            await db.execute(select(AppConfig).where(AppConfig.key == row["key"]))
        ).scalar_one_or_none()
        if existing is None:
            db.add(AppConfig(**row))
            inserted += 1
    if inserted:
        await db.commit()
    return inserted


async def seed_admin_users(db: AsyncSession) -> int:
    """Create a default super_admin if the table is empty.

    Email/password are env-overridable via `PAGEADMIN_EMAIL` /
    `PAGEADMIN_PASSWORD`. Defaults to `admin@pagepay.app` / `admin123`.
    Idempotent: skips insert when any admin row already exists.
    """
    from app.services.admin_auth import hash_password
    import os

    existing = (await db.execute(select(AdminUser).limit(1))).scalar_one_or_none()
    if existing is not None:
        return 0

    email = os.getenv("PAGEADMIN_EMAIL", "admin@pagepay.app")
    password = os.getenv("PAGEADMIN_PASSWORD", "admin123")
    db.add(AdminUser(
        email=email,
        password_hash=hash_password(password),
        role="super_admin",
        permissions=json.dumps(["*"]),
        is_active=True,
    ))
    await db.commit()
    return 1


# ── Schema migrations ──────────────────────────────────────────────
# Seed rows are easy to make idempotent: SELECT-by-key, INSERT-if-missing.
# Schema migrations are a different problem — column adds, type changes,
# index creates — that can't be expressed as upserts. Alembic tracks
# applied revisions in `alembic_version`; `upgrade head` against a
# current DB is a no-op, which is why this is safe to call on every
# startup (matches the seed-on-startup pattern above).
#
# We read the current revision via the same AsyncSession the seeds use,
# then call `alembic upgrade head` against `DATABASE_URL` from the
# environment. We swallow exceptions and log, exactly like the seeds —
# a half-deployed migration that crashes the API on boot is worse than
# serving requests against a stale schema while the operator investigates.

async def run_migrations(db: AsyncSession) -> bool:
    """Apply pending Alembic migrations. Idempotent.

    Returns True if a migration was applied, False if the schema
    was already at head (or migration was skipped on error).
    """
    from alembic import command as alembic_command
    from alembic.config import Config as AlembicConfig
    from alembic.runtime.migration import MigrationContext
    from alembic.script import ScriptDirectory

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        logger.warning("Migrations skipped: DATABASE_URL not set.")
        return False

    cfg = AlembicConfig(os.environ.get("ALEMBIC_CONFIG", "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", database_url)

    try:
        head = ScriptDirectory.from_config(cfg).get_heads()
        head_rev = head[0] if head else None

        current_rev = (
            await db.execute(text("SELECT version_num FROM alembic_version"))
        ).scalar_one_or_none()
    except Exception as exc:  # noqa: BLE001 — best-effort
        current_rev = None
        logger.info("alembic: no alembic_version table yet (%s); will run upgrade.", exc)

    logger.info("alembic: current=%s head=%s", current_rev, head_rev)

    if current_rev == head_rev:
        logger.info("alembic: already at head; skipping.")
        return False

    # `alembic upgrade` is sync (it drives its own engine). Run it
    # off the event loop so the seed background task doesn't block.
    import asyncio
    try:
        await asyncio.to_thread(alembic_command.upgrade, cfg, "head")
    except Exception as exc:  # noqa: BLE001 — best-effort
        logger.error("alembic upgrade failed: %s", exc)
        return False

    logger.info("alembic: upgrade complete")
    return True
