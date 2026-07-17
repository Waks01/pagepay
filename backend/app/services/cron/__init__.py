"""Background job runner for content re-imports + subscription management + referral caps.

We don't want a full Celery/Redis dependency for a single daily job, so
this module exposes a `run_once()` function that:
   1. Imports a fresh batch from Gutendex (page 1, 50 books)
   2. Imports from GNews if an API key is configured
   3. Syncs new posts from Hive blockchain (Phase 5)
   4. Slices any newly-imported parents
   5. Expires subscriptions past their end date
   6. Resets daily referral counters

It's designed to be called either:
  - From a one-shot docker-compose service on a schedule, OR
  - From an external cron / k8s CronJob hitting `python -m app.services.cron`

Idempotent: re-running with the same source_url will be a no-op, so
crashing mid-run and restarting is safe.
"""

import asyncio
import logging
from datetime import date, datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models import User, UserTier, ContentCatalog
from app.services.content.gutendex import import_gutendex
from app.services.content.gnews import import_gnews
from app.services.content.slicing import slice_all_books

logger = logging.getLogger("uvicorn.error")


async def expire_subscriptions(db: AsyncSession) -> int:
    """Revert expired premium subscriptions back to free tier.
    
    Called daily to check if any user's subscription_expires_at has passed.
    """
    now = datetime.utcnow()
    
    result = await db.execute(
        update(User)
        .where(
            (User.tier != UserTier.FREE) &
            (User.subscription_expires_at <= now)
        )
        .values(tier=UserTier.FREE)
    )
    
    count = result.rowcount
    if count > 0:
        await db.commit()
        logger.info("Expired %d premium subscriptions", count)
    
    return count


async def reset_daily_referral_caps(db: AsyncSession) -> int:
    """Reset referrals_today_count for users whose reset_at date has passed.

    Called daily by cron so the 10-referrals-per-day cap resets at UTC midnight.
    """
    now = datetime.utcnow()
    today = now.date()
    
    result = await db.execute(
        update(User)
        .where(
            User.referrals_today_reset_at.is_not(None) &
            (User.referrals_today_reset_at < now)
        )
        .values(referrals_today_count=0, referrals_today_reset_at=now)
    )
    
    count = result.rowcount
    if count > 0:
        await db.commit()
        logger.info("Reset daily referral caps for %d users", count)
    
    return count


async def sync_hive_posts(db: AsyncSession, limit: int = 50) -> int:
    """Fetch new posts from the Hive blockchain and insert into content_catalog.

    This is a Phase 5 feature. Hive provides free, high-quality community
    content via its public API. Posts are inserted with status='hive' so
    the content router can filter them in the feed.
    
    Returns the number of new posts imported.
    """
    try:
        import httpx
        
        HIVE_API = "https://api.hive.blog"
        query = """
        query GetPosts($limit: Int!) {
          get_discussions_by_created(limit: $limit, tag: "pagepay") {
            title
            body
            author
            created
            url
          }
        }
        """
        
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                HIVE_API,
                json={"query": query, "variables": {"limit": limit}},
            )
            resp.raise_for_status()
            data = resp.json()
            posts = data.get("data", {}).get("get_discussions_by_created", [])
    except Exception as exc:
        logger.warning("Hive sync failed: %s", exc)
        return 0

    imported = 0
    for post in posts:
        source_url = f"https://hive.blog/{post.get('author', '')}/@{post.get('author', '')}/{post.get('url', '').split('/')[-1]}"
        existing = await db.execute(
            select(ContentCatalog).where(ContentCatalog.source_url == source_url)
        )
        if existing.scalar_one_or_none():
            continue

        db.add(
            ContentCatalog(
                title=post.get("title", "Untitled"),
                content_type="article",
                category="Hive",
                source_url=source_url,
                body_text=post.get("body", "")[:5000],
                author=post.get("author"),
                estimated_read_minutes=max(2, len(post.get("body", "")) // 1000),
                is_sponsored=False,
            )
        )
        imported += 1

    if imported:
        await db.commit()
    
    logger.info("Hive sync imported %d new posts", imported)
    return imported


async def run_once(
    gutendex_page: int = 1,
    gutendex_limit: int = 50,
    gnews_page: int = 1,
    gnews_limit: int = 50,
) -> dict:
    """Run a single re-import + slice + expiry pass. Returns a summary dict.

    Caller controls the pagination cursors so each invocation advances
    forward — by default we walk from page 1, but a real scheduler would
    persist the cursor (or just reset to 1 since the importer is
    idempotent).
    """
    summary: dict = {
        "gutendex_imported": 0,
        "gnews_imported": 0,
        "hive_imported": 0,
        "sliced": 0,
        "children_added": 0,
        "skipped_existing": 0,
        "subscriptions_expired": 0,
        "referral_caps_reset": 0,
    }

    async with AsyncSessionLocal() as db:
        # Import first so we have parents to slice.
        try:
            summary["gutendex_imported"] = await import_gutendex(
                db, limit=gutendex_limit, start_page=gutendex_page
            )
        except Exception as exc:
            # Network blip on Gutendex shouldn't kill the whole run.
            logger.warning("Gutendex import failed: %s", exc)

        try:
            summary["gnews_imported"] = await import_gnews(
                db, limit=gnews_limit, start_page=gnews_page
            )
        except Exception as exc:
            logger.warning("GNews import failed: %s", exc)

        # Slice anything that doesn't yet have children.
        try:
            slice_summary = await slice_all_books(db)
            summary["sliced"] = slice_summary.get("sliced", 0)
            summary["children_added"] = slice_summary.get("children_added", 0)
            summary["skipped_existing"] = slice_summary.get("skipped_existing", 0)
        except Exception as exc:
            logger.error("Slicing failed: %s", exc)
        
        # Expire any premium subscriptions past their end date.
        try:
            summary["subscriptions_expired"] = await expire_subscriptions(db)
        except Exception as exc:
            logger.error("Subscription expiry failed: %s", exc)

        # Reset daily referral counters for users whose reset_at has passed.
        try:
            summary["referral_caps_reset"] = await reset_daily_referral_caps(db)
        except Exception as exc:
            logger.error("Referral cap reset failed: %s", exc)

        # Sync new posts from Hive blockchain.
        try:
            summary["hive_imported"] = await sync_hive_posts(db, limit=50)
        except Exception as exc:
            logger.error("Hive sync failed: %s", exc)

    logger.info(
        "Cron run done: gutenberg=%d gnews=%d hive=%d sliced=%d children_added=%d subscriptions_expired=%d referral_caps_reset=%d",
        summary["gutendex_imported"],
        summary["gnews_imported"],
        summary["hive_imported"],
        summary["sliced"],
        summary["children_added"],
        summary["subscriptions_expired"],
        summary["referral_caps_reset"],
    )
    return summary


def main() -> None:
    """CLI entry: `python -m app.services.cron`."""
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run_once())


if __name__ == "__main__":
    main()
