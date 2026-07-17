"""AI provider router with circuit breaker.

Single entry point for all AI calls. Priority logic:
  - task_type=heavy  → Gemini (1M ctx) then OpenRouter
  - task_type=fast   → Groq (speed) then OpenRouter
  - task_type=chat   → Groq then OpenRouter
  - any              → all non-open providers in priority order

On provider failure the circuit breaker marks it and the router
falls through to the next candidate. If every candidate is exhausted
the endpoint returns 503.
"""

from fastapi import HTTPException

from app.ai.circuit_breaker import get_circuit_open, mark_failed, mark_success
from app.ai.providers.gemini import call_gemini
from app.ai.providers.groq import call_groq
from app.ai.providers.openrouter import call_openrouter

# Ordered provider registry. Order = fallback priority.
PROVIDERS = [
    {
        "name": "gemini",
        "model": "gemini-2.5-flash",
        "try": call_gemini,
        "task_types": {"heavy", "chat", "fast"},
    },
    {
        "name": "groq",
        "model": "llama-3.3-70b-versatile",
        "try": call_groq,
        "task_types": {"fast", "chat"},
    },
    {
        "name": "openrouter",
        "model": "deepseek/deepseek-chat:free",
        "try": call_openrouter,
        "task_types": {"heavy", "fast", "chat"},
    },
]


async def route_ai(
    prompt: str,
    task_type: str = "fast",
    max_tokens: int = 4000,
    db=None,
) -> dict:
    """Route an AI prompt to the best available provider.

    Returns `{"response": str, "provider": str, "model": str}`.
    Raises HTTPException(503) if every provider is unavailable.
    """
    open_circuits = await get_circuit_open(db) if db is not None else []

    candidates = [
        p for p in PROVIDERS
        if p["name"] not in open_circuits and task_type in p["task_types"]
    ]
    # Fallback: if no provider lists this task_type, try all non-open.
    if not candidates:
        candidates = [p for p in PROVIDERS if p["name"] not in open_circuits]

    last_error: Exception | None = None
    for provider in candidates:
        try:
            text = await provider["try"](prompt, provider["model"], max_tokens)
            if db is not None:
                await mark_success(db, provider["name"])
            return {"response": text, "provider": provider["name"], "model": provider["model"]}
        except Exception as exc:
            last_error = exc
            if db is not None:
                await mark_failed(db, provider["name"])
            import logging
            logging.getLogger("uvicorn.error").warning(
                "AI provider %s failed: %s", provider["name"], exc
            )
            continue

    raise HTTPException(
        status_code=503,
        detail=f"All AI providers unavailable. Last error: {last_error}",
    )
