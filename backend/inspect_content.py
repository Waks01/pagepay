import asyncio
from sqlalchemy import select, func
from app.database import SessionLocal
from app.models import ContentCatalog


async def main():
    async with SessionLocal() as s:
        rows = (await s.execute(
            select(
                ContentCatalog.id,
                ContentCatalog.title,
                func.length(ContentCatalog.body_text),
                ContentCatalog.estimated_read_minutes,
            )
            .where(ContentCatalog.content_type == "book")
            .order_by(ContentCatalog.id)
        )).all()
        for r in rows:
            print(f"id={r.id} title={r.title[:60]!r} len={r[2]} min={r.estimated_read_minutes}")
        print("---")
        news = (await s.execute(
            select(func.count(ContentCatalog.id)).where(ContentCatalog.content_type == "news")
        )).scalar()
        print("news count:", news)


asyncio.run(main())