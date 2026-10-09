import asyncio
from app.database import AsyncSessionLocal
from app.models import StudyMaterial
from sqlalchemy import select

async def main():
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(StudyMaterial))
        materials = result.scalars().all()
        print(f"Total materials: {len(materials)}")

asyncio.run(main())
