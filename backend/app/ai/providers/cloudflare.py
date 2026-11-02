"""Cloudflare Workers AI provider.

Single unified interface to Cloudflare's AI models:
  - Chat: @cf/meta/llama-3.1-8b-instruct-fp8
  - Vision: @cf/moondream/moondream3.1-9b-a2b
  - TTS: @cf/deepgram/aura-2-en

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
    "chat": "@cf/meta/llama-3.1-8b-instruct-fp8",
    "vision": "@cf/moondream/moondream3.1-9b-a2b",
    "tts": "@cf/deepgram/aura-2-en",
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
    """Call Cloudflare Workers AI vision model (Moondream 3.1).

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

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{CF_BASE_URL}/{CF_MODELS['vision']}",
            headers={"Authorization": f"Bearer {CF_AI_API_KEY}"},
            json={
                "prompt": prompt,
                "image": image_base64,
            },
        )
        if resp.status_code != 200:
            raise RuntimeError(
                f"Cloudflare vision API failed: {resp.status_code} {resp.text[:200]}"
            )

        result = resp.json().get("result", {})
        description = result.get("description") or result.get("response") or ""

        # Estimate input tokens (vision uses tokens, not chars)
        estimated_input_tokens = len(prompt) // 4 + 100  # 100 base for image

        return description, estimated_input_tokens


async def call_cf_tts(text: str, voice: str = "aura-2-en") -> Tuple[bytes, float]:
    """Call Cloudflare Workers AI TTS model (Deepgram Aura 2 English).

    Args:
        text: Text to convert to speech
        voice: Voice identifier (default "aura-2-en")

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
                "voice": voice,
            },
        )
        if resp.status_code != 200:
            raise RuntimeError(
                f"Cloudflare TTS API failed: {resp.status_code} {resp.text[:200]}"
            )

        audio_bytes = resp.content

        # Estimate duration: ~3 chars per second of audio
        # (typical human speech rate is ~150 words/min = ~12.5 chars/sec,
        # so 3 chars/sec is conservative for synthesis)
        duration_seconds = max(0.5, len(text) / 3.0)

        return audio_bytes, duration_seconds
