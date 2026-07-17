from fastapi import APIRouter
from sqlalchemy import text
from app.database import engine
import logging

router = APIRouter(tags=["health"])
logger = logging.getLogger("uvicorn.error")


@router.get("/health")
async def health():
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return {"status": "ok", "db": True}
    except Exception as exc:
        logger.error("Health check failed: %s", exc)
        return {"status": "error", "db": False}
