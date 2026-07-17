from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import httpx
from app.models import ContentCatalog
from app.config import settings
from app.services.content.slicing import slice_and_persist


async def import_gnews(
    db: AsyncSession, limit: int = 50, start_page: int = 1
) -> int:
    """Pull top headlines from GNews and persist any we don't already have.

    GNews caps `max` at 10 per request, so we paginate by `start_page`.
    Each page is 10 articles; `limit` controls the cap on inserted rows
    (not on the number of pages walked). Caller is expected to advance
    start_page on each scheduled run so the catalog grows over time.

    Every freshly-imported article is run through the slicer, same as
    books. News articles are usually short (~500 chars), so most end up
    as a single child slice. The slicer's NO_SLICE_THRESHOLD_CHARS keeps
    them unsplit rather than fragmenting a coherent article.
    """
    if not settings.gnews_api_key:
        return 0

    url = "https://gnews.io/api/v4/top-headlines"
    imported_parents: list[ContentCatalog] = []
    page = start_page

    async with httpx.AsyncClient(timeout=30) as client:
        while len(imported_parents) < limit:
            params = {
                "token": settings.gnews_api_key,
                "lang": "en",
                "max": 10,
                "page": page,
            }
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
            articles = data.get("articles", [])
            if not articles:
                break

            page_added = 0
            for art in articles:
                if len(imported_parents) >= limit:
                    break
                source_url = art.get("url")
                if not source_url:
                    continue

                exists = await db.execute(
                    select(ContentCatalog).where(ContentCatalog.source_url == source_url)
                )
                if exists.scalar_one_or_none():
                    continue

                title = art.get("title", "Untitled")
                content = art.get("content") or art.get("description") or ""
                category = art.get("source", {}).get("name", "news")
                published = art.get("publishedAt", "")

                parent = ContentCatalog(
                    title=title,
                    content_type="article",
                    category=category,
                    source_url=source_url,
                    body_text=f"{content}\n\nPublished: {published}",
                    author=art.get("source", {}).get("name"),
                )
                db.add(parent)
                await db.flush()
                imported_parents.append(parent)
                page_added += 1
            # If a full page produced zero new rows, the catalog is up to
            # date for this run — bail rather than spin forever.
            if page_added == 0:
                break
            page += 1

    await db.commit()

    # Slice every freshly-imported article. Errors are caught per-parent
    # so one bad article doesn't undo the whole batch.
    import logging
    log = logging.getLogger("uvicorn.error")
    for parent in imported_parents:
        try:
            await slice_and_persist(db, parent)
        except Exception as exc:  # noqa: BLE001
            log.warning("Slicing failed for news article %s: %s", getattr(parent, "id", None), exc)
    return len(imported_parents)