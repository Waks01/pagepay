"""Public AI route endpoint.

Single entry point for all AI calls from the frontend or other services.
Wraps `app.ai.router.route_ai` in a proper FastAPI endpoint with
auth, rate limiting, and request validation.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.router import route_ai
from app.database import get_db
from app.routers.auth import get_current_user
from app.schemas import AiRouteRequest, AiRouteResponse

logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/ai", tags=["ai"])


@router.post("/route", response_model=AiRouteResponse)
async def ai_route(
    payload: AiRouteRequest,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Route an AI prompt to the best available provider.

    Requires authentication. The `task_type` hint selects the provider
    priority list: `heavy` prefers Gemini, `fast`/`chat` prefer Groq.
    On provider failure the circuit breaker opens and the router falls
    through to the next candidate. Returns 503 if every provider is
    unavailable.
    """
    try:
        result = await route_ai(
            prompt=payload.prompt,
            task_type=payload.task_type,
            max_tokens=payload.max_tokens,
            db=db,
        )
        return AiRouteResponse(
            response=result["response"],
            provider=result["provider"],
            model=result["model"],
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("AI route failed: %s", exc)
        raise HTTPException(status_code=503, detail="AI service unavailable") from exc
