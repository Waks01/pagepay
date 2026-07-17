"""Gemini provider client for the AI router.

Uses the Google AI Studio REST API (no official Python SDK required).
Auth is via `?key=` query param. Returns the text of the first
candidate part.
"""

import logging

import httpx

from app.config import settings

logger = logging.getLogger("uvicorn.error")

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
DEFAULT_MODEL = "gemini-2.5-flash"


async def call_gemini(prompt: str, model: str = DEFAULT_MODEL, max_tokens: int = 4000) -> str:
    api_key = settings.gemini_api_key
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not configured")

    url = f"{GEMINI_BASE}/models/{model}:generateContent"
    params = {"key": api_key}
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "maxOutputTokens": max_tokens,
            "temperature": 0.3,
        },
    }

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(url, params=params, json=body)
        if resp.status_code != 200:
            logger.error("Gemini HTTP %s: %s", resp.status_code, resp.text[:200])
            resp.raise_for_status()
        data = resp.json()

    try:
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError) as exc:
        logger.error("Gemini unexpected response shape: %s", data)
        raise RuntimeError("Gemini returned empty response") from exc
