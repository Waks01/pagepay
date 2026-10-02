"""AI provider router with dynamic free-model selection.

Routes all AI calls through Kilo Gateway, selecting from the pool of
available free models. Prefers vision-capable models for document
processing tasks. Falls back through the free pool on failure.

The free model list is refreshed periodically from Kilo Gateway's
/models endpoint to handle model rotation.
"""

from fastapi import HTTPException

from app.ai.circuit_breaker import get_circuit_open, mark_failed, mark_success
from app.ai.free_model_selector import free_model_selector
from app.ai.providers.kilo_gateway import call_kilo_gateway
from app.config import settings


async def route_ai(
    prompt: str,
    task_type: str = "fast",
    max_tokens: int = settings.ai_default_max_tokens,
    db=None,
    prefer_vision: bool = True,
) -> dict:
    pin_model = settings.kilo_default_model
    selected_model = await free_model_selector.get_next_model(
        prefer_vision=prefer_vision,
        pin_model=pin_model,
    )

    try:
        text = await call_kilo_gateway(
            prompt,
            model=selected_model,
            max_tokens=max_tokens,
            prefer_vision=prefer_vision,
            pin_model=pin_model,
        )
        if db is not None:
            await mark_success(db, "kilo")
        return {"response": text, "provider": "kilo", "model": selected_model}
    except Exception as exc:
        if db is not None:
            await mark_failed(db, "kilo")
        raise HTTPException(
            status_code=503,
            detail=f"Kilo Gateway unavailable. Error: {exc}",
        )
