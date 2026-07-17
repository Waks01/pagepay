"""OpenRouter provider client for the AI router.

OpenRouter provides a single API key that fronts multiple open-weight
models. It is the designated failover when Gemini and Groq are both
saturated. We default to DeepSeek Chat (free tier) but any model
available on the key works.
"""

import logging

import httpx

from app.config import settings

OPENROUTER_BASE = "https://openrouter.ai/api/v1"
DEFAULT_MODEL = "deepseek/deepseek-chat:free"

logger = logging.getLogger("uvicorn.error")


async def call_openrouter(prompt: str, model: str = DEFAULT_MODEL, max_tokens: int = 4000) -> str:
    api_key = settings.openrouter_api_key
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY not configured")

    url = f"{OPENROUTER_BASE}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://pagepay.ng",
        "X-Title": "PagePay Study",
    }
    body = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "temperature": 0.3,
    }

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(url, headers=headers, json=body)
        if resp.status_code != 200:
            logger.error("OpenRouter HTTP %s: %s", resp.status_code, resp.text[:200])
            resp.raise_for_status()
        data = resp.json()

    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError) as exc:
        logger.error("OpenRouter unexpected response shape: %s", data)
        raise RuntimeError("OpenRouter returned empty response") from exc
