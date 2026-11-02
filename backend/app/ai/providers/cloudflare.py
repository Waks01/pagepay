"""Cloudflare Workers AI provider.

Single unified interface to Cloudflare's AI models:
  - Chat Premium: @cf/zai-org/glm-4.7-flash
  - Chat Standard: @cf/ibm-granite/granite-4.0-h-micro
  - Vision: @cf/meta/llama-3.2-11b-vision-instruct
  - TTS: @cf/myshell-ai/melotts

All functions are async and return typed tuples for cost accounting.
"""

import base64
import logging
import os
from typing import Tuple

import httpx

from app.config import settings

logger = logging.getLogger("uvicorn.error")

# Cloudflare Workers AI configuration
CF_ACCOUNT_ID = settings.cf_account_id or os.environ.get("CF_ACCOUNT_ID")
CF_AI_API_KEY = settings.cf_ai_api_key or os.environ.get("CF_AI_API_KEY")
CF_BASE_URL = f"{settings.cf_ai_base_url}/{CF_ACCOUNT_ID}/ai/run"

CF_MODELS = {
    "chat": "@cf/zai-org/glm-4.7-flash",
    "chat_standard": "@cf/ibm-granite/granite-4.0-h-micro",
    "vision": "@cf/meta/llama-3.2-11b-vision-instruct",
    "tts": "@cf/myshell-ai/melotts",
}


async def call_cf_chat(
    messages: list[dict],
    system_prompt: str = "",
    max_tokens: int = 4000,
) -> Tuple[str, int]:
    """Call Cloudflare Workers AI chat model (Llama 3.1 8B).

    Args:
        messages: List of message dicts with "role" and "content"
        system_prompt: Optional system prompt
        max_tokens: Maximum tokens in response

    Returns:
        Tuple of (response_text, estimated_input_tokens)

    Raises:
        RuntimeError: if the API call fails
    """
    if not CF_ACCOUNT_ID or not CF_AI_API_KEY:
        raise RuntimeError("Cloudflare Workers AI credentials not configured")

    payload = {
        "messages": messages,
        "max_tokens": max_tokens,
    }

    if system_prompt:
        payload["system"] = system_prompt

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{CF_BASE_URL}/{CF_MODELS['chat']}",
            headers={"Authorization": f"Bearer {CF_AI_API_KEY}"},
            json=payload,
        )
        if resp.status_code != 200:
            raise RuntimeError(
                f"Cloudflare chat API failed: {resp.status_code} {resp.text[:200]}"
            )

        result = resp.json().get("result", {})
        response_text = result.get("response") or result.get("content") or ""

        # Estimate input tokens: ~4 chars per token
        estimated_input_tokens = (
            sum(len(m.get("content", "")) for m in messages) // 4
            + len(system_prompt) // 4
        )

        return response_text, estimated_input_tokens


async def call_cf_vision(image_base64: str, prompt: str) -> Tuple[str, int]:
    """Call Cloudflare Workers AI vision model (Llama 3.2 11B Vision).

    Args:
        image_base64: Base64-encoded image data (no data: prefix)
        prompt: Text prompt describing what to analyze

    Returns:
        Tuple of (extracted_text, estimated_input_tokens)

    Raises:
        RuntimeError: if the API call fails
    """
    if not CF_ACCOUNT_ID or not CF_AI_API_KEY:
        raise RuntimeError("Cloudflare Workers AI credentials not configured")

    # Llama Vision uses messages format with image_url
    payload = {
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"}},
                    {"type": "text", "text": prompt},
                ]
            }
        ]
    }

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{CF_BASE_URL}/{CF_MODELS['vision']}",
            headers={"Authorization": f"Bearer {CF_AI_API_KEY}"},
            json=payload,
        )
        if resp.status_code != 200:
            raise RuntimeError(
                f"Cloudflare vision API failed: {resp.status_code} {resp.text[:200]}"
            )

        result = resp.json().get("result", {})
        description = result.get("response") or result.get("content") or ""

        # Estimate input tokens (vision uses tokens, not chars)
        estimated_input_tokens = len(prompt) // 4 + 100  # 100 base for image

        return description, estimated_input_tokens


async def call_cf_tts(text: str, voice: str = "melotts") -> Tuple[bytes, float]:
    """Call Cloudflare Workers AI TTS model (MeloTTS).

    Args:
        text: Text to convert to speech
        voice: Voice identifier (kept for backwards compatibility, ignored for MeloTTS)

    Returns:
        Tuple of (audio_bytes, duration_seconds)

    Raises:
        RuntimeError: if the API call fails
    """
    if not CF_ACCOUNT_ID or not CF_AI_API_KEY:
        raise RuntimeError("Cloudflare Workers AI credentials not configured")

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{CF_BASE_URL}/{CF_MODELS['tts']}",
            headers={"Authorization": f"Bearer {CF_AI_API_KEY}"},
            json={
                "text": text,
            },
        )
        if resp.status_code != 200:
            raise RuntimeError(
                f"Cloudflare TTS API failed: {resp.status_code} {resp.text[:200]}"
            )

        audio_bytes = resp.content

        # Estimate duration: ~150 words/min, ~5 chars/word
        duration_seconds = max(0.5, len(text) / (150 * 5 / 60))

        return audio_bytes, duration_seconds
