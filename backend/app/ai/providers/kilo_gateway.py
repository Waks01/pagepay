"""Kilo Gateway provider client for the AI router.

Kilo Gateway provides a unified OpenAI-compatible API to access hundreds
of AI models through a single endpoint. This provider uses dynamic
free-model selection to avoid rate limits and model-rotation failures.
"""

import logging

import httpx

from app.ai.free_model_selector import free_model_selector
from app.config import settings

logger = logging.getLogger("uvicorn.error")


async def call_kilo_gateway(
    prompt: str,
    model: str | None = None,
    max_tokens: int = 4000,
    prefer_vision: bool = True,
    pin_model: str | None = None,
) -> str:
    """Call Kilo Gateway with dynamic free-model selection.

    Args:
        prompt: The prompt to send.
        model: Optional specific model override. If None, selects from free pool.
        max_tokens: Maximum tokens to generate.
        prefer_vision: If True, prefer vision-capable free models.

    Returns:
        The model's response text.
    """
    api_key = settings.kilo_api_key
    if not api_key:
        raise RuntimeError("KILO_API_KEY not configured")

    base_url = settings.kilo_gateway_base_url
    selected_model = model or await free_model_selector.get_next_model(
        prefer_vision=prefer_vision,
        pin_model=pin_model,
    )

    url = f"{base_url}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": selected_model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "temperature": 0.3,
    }

    logger.info("Calling Kilo Gateway with model: %s", selected_model)

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(url, headers=headers, json=body)
        if resp.status_code != 200:
            logger.error("Kilo Gateway HTTP %s: %s", resp.status_code, resp.text[:500])
            resp.raise_for_status()
        data = resp.json()

    try:
        content = data["choices"][0]["message"]["content"]
        if content is None:
            # Some reasoning models return content in reasoning field
            reasoning = data["choices"][0]["message"].get("reasoning")
            if reasoning:
                logger.debug("Model returned reasoning instead of content, using reasoning")
                content = reasoning
        return content or ""
    except (KeyError, IndexError) as exc:
        logger.error("Kilo Gateway unexpected response shape: %s", data)
        raise RuntimeError("Kilo Gateway returned empty response") from exc
