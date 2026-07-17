from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import httpx
from app.models import ContentCatalog
from app.config import settings
from app.services.content.slicing import slice_and_persist


async def import_gutendex(
    db: AsyncSession, limit: int = 50, start_page: int = 1
) -> int:
    """Pull books from Gutendex and persist any we don't already have.

    Pagination: Gutendex returns 32 books per page. `start_page` is
    1-indexed; pass 2 on the next run to fetch the next batch without
    re-walking the first page. Re-imports are idempotent (we skip any
    source_url that's already in the catalog), so it's safe to call
    with start_page=1 again — we'll just no-op.

    After commits, every newly-imported parent work is run through the
    slicer so it lands as 1-minute child reads. Books below
    NO_SLICE_THRESHOLD_CHARS become a single child (a 500-char blurb
    sliced in two is a 250-char fragment no one reads). Books above
    the absolute hard cap are still sliced, with each slice capped at
    ABSOLUTE_MAX_CHARS even if that lands mid-sentence.
    """
    url = f"{settings.gutendex_base_url}/books"
    params: dict[str, int | str] = {"copyright": "false", "limit": min(limit, 32)}
    headers = {"User-Agent": "PagePay/1.0 (+https://pagepay.app)"}
    imported_parents: list[ContentCatalog] = []
    MAX_BODY_BYTES = 60_000

    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        page = start_page
        while len(imported_parents) < limit:
            page_params = {**params, "page": page}
            try:
                resp = await client.get(url, params=page_params, headers=headers)
                resp.raise_for_status()
            except httpx.HTTPStatusError as exc:
                import logging
                logging.getLogger("uvicorn.error").warning(
                    "Gutendex import failed on page %s: %s", page, exc
                )
                break
            data = resp.json()
            page_added = 0
            for item in data.get("results", []):
                formats = item.get("formats", {})
                source_url = (
                    formats.get("text/plain; charset=utf-8")
                    or formats.get("text/plain")
                )
                if not source_url:
                    continue

                exists = await db.execute(
                    select(ContentCatalog).where(ContentCatalog.source_url == source_url)
                )
                if exists.scalar_one_or_none():
                    continue

                title = item.get("title", "Untitled")
                authors = ", ".join(a.get("name", "") for a in item.get("authors", []))
                category = ", ".join(item.get("bookshelves", [])[:2]) or "fiction"
                body_text = None

                try:
                    txt_resp = await client.get(source_url, timeout=20, follow_redirects=True)
                    txt_resp.raise_for_status()
                    raw = txt_resp.content
                    if len(raw) > MAX_BODY_BYTES:
                        raw = raw[:MAX_BODY_BYTES]
                    body_text = raw.decode("utf-8", errors="replace")
                except Exception:
                    continue

                parent = ContentCatalog(
                    title=title,
                    content_type="book",
                    category=category,
                    source_url=source_url,
                    body_text=body_text,
                    author=authors,
                )
                db.add(parent)
                await db.flush()
                imported_parents.append(parent)
                page_added += 1
                if len(imported_parents) >= limit:
                    break
            if not data.get("next") or page_added == 0:
                break
            page += 1

            # Commit after each page so partial progress survives failures.
            await db.commit()

    # Slice every freshly-imported parent outside the import loop so a
    # slicing failure on one book doesn't roll back the import of the others.
    sliced = 0
    for parent in imported_parents:
        try:
            n = await slice_and_persist(db, parent)
            if n > 0:
                sliced += 1
        except Exception as exc:  # noqa: BLE001
            import logging
            logging.getLogger("uvicorn.error").warning(
                "Slicing failed for parent %s: %s", getattr(parent, "id", None), exc,
            )
    return len(imported_parents)
