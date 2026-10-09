import asyncio
from app.database import AsyncSessionLocal
from app.models import StudyMaterial
from sqlalchemy import select

async def main():
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(StudyMaterial))
        materials = result.scalars().all()
        for m in materials:
            parsed = m.parsed_structure or 'NULL'
            has_blocks = parsed != 'NULL' and 'content_blocks' in parsed
            print(f"ID: {m.id}, Title: {m.title[:50]}, Has blocks: {has_blocks}")

asyncio.run(main())
