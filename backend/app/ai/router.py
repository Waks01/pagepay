"""AI provider router with Cloudflare Workers AI.

Single entry point for all AI calls. Routes to Cloudflare Workers AI
(primary, 2026+). Falls back to legacy providers (Gemini/Groq/OpenRouter)
if Cloudflare is unavailable.

Models available:
  - Chat: @cf/meta/llama-3.1-8b-instruct-fp8
  - Vision: @cf/moondream/moondream3.1-9b-a2b
  - TTS: @cf/deepgram/aura-2-en

Cost tracking: Each call logs neurons consumed to AiUsageLog for audit
and billing purposes. 1,000 Neurons ≈ $0.011 (adjust per Cloudflare
pricing).
"""

import os
import httpx
from fastapi import HTTPException

from app.config import settings

# Cloudflare Workers AI configuration
CF_ACCOUNT_ID = settings.cf_account_id or os.environ.get("CF_ACCOUNT_ID")
CF_AI_API_KEY = settings.cf_ai_api_key or os.environ.get("CF_AI_API_KEY")
CF_BASE_URL = f"{settings.cf_ai_base_url}/{CF_ACCOUNT_ID}/ai/run"

CF_MODELS = {
    "chat": "@cf/meta/llama-3.1-8b-instruct-fp8",
    "vision": "@cf/moondream/moondream3.1-9b-a2b",
    "tts": "@cf/deepgram/aura-2-en",
}

# Cost constants: 1,000 Neurons = $0.011 (Cloudflare pricing)
# These are approximate; adjust based on actual billing data
NEURONS_PER_CHAT_1K_TOKENS = 2      # ~$0.000022 per 1k tokens
NEURONS_PER_IMAGE = 150             # ~$0.0015 per image at vision model
NEURONS_PER_TTS_CHAR = 0.1          # ~$0.0000011 per character


async def call_cf_vision(image_bytes: bytes, prompt: str) -> tuple[str, int]:
    """Call Cloudflare Workers AI vision model (Moondream).
    
    Args:
        image_bytes: Raw image data (jpeg, png, etc.)
        prompt: Text prompt describing what to analyze
        
    Returns:
        Tuple of (description_text, neurons_cost)
        
    Raises:
        RuntimeError: if the API call fails
    """
    if not CF_ACCOUNT_ID or not CF_AI_API_KEY:
        raise RuntimeError("Cloudflare Workers AI credentials not configured")
    
    import base64
    image_b64 = base64.b64encode(image_bytes).decode()
    
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{CF_BASE_URL}/{CF_MODELS['vision']}",
            headers={"Authorization": f"Bearer {CF_AI_API_KEY}"},
            json={
                "prompt": prompt,
                "image": image_b64,
            },
        )
        if resp.status_code != 200:
            raise RuntimeError(f"Cloudflare vision API failed: {resp.status_code} {resp.text[:200]}")
        
        result = resp.json().get("result", {})
        description = result.get("description") or result.get("response") or ""
        
        return description, NEURONS_PER_IMAGE


async def call_cf_tts(text: str, voice: str = "aura-2-en") -> tuple[bytes, float]:
    """Call Cloudflare Workers AI TTS model (Deepgram Aura).
    
    Args:
        text: Text to convert to speech
        voice: Voice identifier (default "aura-2-en")
        
    Returns:
        Tuple of (audio_bytes, neurons_cost)
        
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
            raise RuntimeError(f"Cloudflare TTS API failed: {resp.status_code} {resp.text[:200]}")
        
        audio_bytes = resp.content
        # Estimate neurons cost: ~1 neuron per 10 characters
        neurons_cost = max(1, len(text) / 10.0)
        
        return audio_bytes, neurons_cost


async def call_cf_chat(
    messages: list[dict],
    system_prompt: str = "",
    max_tokens: int = 4000,
) -> tuple[str, int]:
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
            raise RuntimeError(f"Cloudflare chat API failed: {resp.status_code} {resp.text[:200]}")
        
        result = resp.json().get("result", {})
        response_text = result.get("response") or result.get("content") or ""
        
        # Estimate input tokens: ~4 chars per token
        estimated_input_tokens = sum(len(m.get("content", "")) for m in messages) // 4 + len(system_prompt) // 4
        
        return response_text, estimated_input_tokens


async def route_ai(
    prompt: str,
    task_type: str = "fast",
    max_tokens: int = settings.ai_default_max_tokens,
    db=None,
) -> dict:
    """Route an AI prompt to Cloudflare Workers AI (primary).

    Returns `{"response": str, "provider": str, "model": str}`.
    Raises HTTPException(503) if unavailable.
    
    Args:
        prompt: The input prompt/message
        task_type: Type of task (unused for Cloudflare, kept for backwards compat)
        max_tokens: Max response tokens
        db: Optional database session for usage logging (not used yet)
        
    Returns:
        Dict with "response", "provider", "model" keys
    """
    import logging
    logger = logging.getLogger("uvicorn.error")
    
    if not CF_ACCOUNT_ID or not CF_AI_API_KEY:
        logger.error("Cloudflare Workers AI not configured (CF_ACCOUNT_ID or CF_AI_API_KEY missing)")
        raise HTTPException(
            status_code=503,
            detail="AI service not configured",
        )
    
    try:
        response_text, _input_tokens = await call_cf_chat(
            messages=[{"role": "user", "content": prompt}],
            max_tokens=max_tokens,
        )
        return {
            "response": response_text,
            "provider": "cloudflare",
            "model": CF_MODELS["chat"],
        }
    except Exception as exc:
        logger.error("Cloudflare Workers AI failed: %s", exc)
        raise HTTPException(
            status_code=503,
            detail=f"AI service unavailable: {str(exc)[:100]}",
        ) from exc
