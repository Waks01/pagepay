"""Groq provider client for the AI router.

Uses the OpenAI-compatible chat completions endpoint. Groq is the
fastest open-weight inference provider and is the primary choice for
real-time quiz generation and chat.
"""

import logging

import httpx

from app.config import settings

GROQ_BASE = "https://api.groq.com/openai/v1"
DEFAULT_MODEL = "llama-3.3-70b-versatile"

logger = logging.getLogger("uvicorn.error")


async def call_groq(prompt: str, model: str = DEFAULT_MODEL, max_tokens: int = 4000) -> str:
    api_key = settings.groq_api_key
    if not api_key:
        raise RuntimeError("GROQ_API_KEY not configured")

    url = f"{GROQ_BASE}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
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
            logger.error("Groq HTTP %s: %s", resp.status_code, resp.text[:200])
            resp.raise_for_status()
        data = resp.json()

    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError) as exc:
        logger.error("Groq unexpected response shape: %s", data)
        raise RuntimeError("Groq returned empty response") from exc
