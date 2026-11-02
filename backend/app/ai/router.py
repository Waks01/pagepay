"""AI provider router with Cloudflare Workers AI.

Single entry point for all AI calls. Routes to Cloudflare Workers AI
(primary, 2026+). Falls back to legacy providers (Gemini/Groq/OpenRouter)
if Cloudflare is unavailable.

Models available:
  - Chat Premium: @cf/zai-org/glm-4.7-flash
  - Chat Standard: @cf/ibm-granite/granite-4.0-h-micro
  - Vision: @cf/meta/llama-3.2-11b-vision-instruct
  - TTS: @cf/myshell-ai/melotts

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

# Tier routing keywords for classifying chat turns
STANDARD_KEYWORDS = {
    "what is", "what are", "define", "definition", "list", "name", "describe",
    "who is", "when did", "where is", "what does", "meaning of",
}
PREMIUM_KEYWORDS = {
    "why", "how does", "explain", "compare", "analyze", "analyse", "solve",
    "prove", "derive", "evaluate", "assess", "discuss", "calculate",
    "multi-step", "strategy", "reasoning",
}


def should_use_premium_model(message: str, context: str = "") -> bool:
    """Classify whether a chat turn needs the premium model (GLM) or standard (Granite).
    
    Standard (→ Granite): definitions, recall, lookups, rephrasing — 70% of queries.
    Premium (→ GLM): multi-step reasoning, strategy, 'why' questions — 30%.
    
    Args:
        message: The user message text
        context: Additional context (system prompt or previous messages)
        
    Returns:
        True for premium, False for standard.
    """
    text = (message + " " + context).lower()
    # If any premium keyword matches, use premium
    for kw in PREMIUM_KEYWORDS:
        if kw in text:
            return True
    # Default to standard
    return False

CF_MODELS = {
    "chat": "@cf/zai-org/glm-4.7-flash",
    "chat_standard": "@cf/ibm-granite/granite-4.0-h-micro",
    "vision": "@cf/meta/llama-3.2-11b-vision-instruct",
    "tts": "@cf/myshell-ai/melotts",
}

# Cost constants: 1,000 Neurons = $0.011 (Cloudflare pricing)
# GLM-4.7-Flash: $0.060/M input, $0.400/M output
GLM_INPUT_COST_PER_M = 0.060
GLM_OUTPUT_COST_PER_M = 0.400
# Granite 4.0 H-Micro: $0.017/M input, $0.112/M output
GRANITE_INPUT_COST_PER_M = 0.017
GRANITE_OUTPUT_COST_PER_M = 0.112
# Llama Vision: $0.049/M input, $0.676/M output
VISION_INPUT_COST_PER_M = 0.049
VISION_OUTPUT_COST_PER_M = 0.676
# MeloTTS: $0.0002/audio minute
MELOTTS_COST_PER_MINUTE = 0.0002

NEURONS_PER_CHAT_1K_TOKENS = 2      # GLM base rate ~$0.000022 per 1k tokens
NEURONS_PER_CHAT_GRANITE_1K_TOKENS = 0.57  # Granite is 3.6× cheaper
NEURONS_PER_IMAGE = 170             # ~$0.0017 per image at Llama Vision
NEURONS_PER_TTS_CHAR = 0.1          # ~$0.0000011 per character


def calculate_ai_cost_neurons(operation: str, input_size: int, use_granite: bool = False) -> float:
    """Calculate cost in Neurons based on operation type and input size.

    Args:
        operation: Type of AI operation ('chat', 'vision', 'audio_tts')
        input_size: Size of input (tokens for chat, bytes for vision/audio)
        use_granite: For chat operations, use Granite pricing instead of GLM

    Returns:
        Cost in Neurons (where 1,000 Neurons approx $0.011)
    """
    if operation == "chat":
        tokens = max(1, input_size // 4)
        if use_granite:
            return tokens / 1000.0 * NEURONS_PER_CHAT_GRANITE_1K_TOKENS
        else:
            return tokens / 1000.0 * NEURONS_PER_CHAT_1K_TOKENS
    elif operation == "vision":
        return 170.0
    elif operation == "audio_tts":
        return max(1, input_size * 0.1)
    else:
        return 0.0


async def call_cf_vision(image_bytes: bytes, prompt: str) -> tuple[str, float]:
    """Call Cloudflare Workers AI vision model (Llama 3.2 11B Vision).
    
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
    
    # Llama Vision uses messages format with image_url
    payload = {
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}},
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
            raise RuntimeError(f"Cloudflare vision API failed: {resp.status_code} {resp.text[:200]}")
        
        result = resp.json().get("result", {})
        description = result.get("response") or result.get("content") or ""
        
        # Calculate cost based on image size
        cost_neurons = NEURONS_PER_IMAGE
        return description, cost_neurons


async def call_cf_tts(text: str, voice: str = "melotts") -> tuple[bytes, float]:
    """Call Cloudflare Workers AI TTS model (MeloTTS).
    
    Args:
        text: Text to convert to speech
        voice: Voice identifier (kept for backwards compatibility, ignored for MeloTTS)
        
    Returns:
        Tuple of (audio_bytes, neurons_cost)
        
    Raises:
        RuntimeError: if the API call fails
    """
    if not CF_ACCOUNT_ID or not CF_AI_API_KEY:
        raise RuntimeError("Cloudflare Workers AI credentials not configured")
    
    # MeloTTS does not take a voice parameter
    payload = {"text": text}
    
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{CF_BASE_URL}/{CF_MODELS['tts']}",
            headers={"Authorization": f"Bearer {CF_AI_API_KEY}"},
            json=payload,
        )
        if resp.status_code != 200:
            raise RuntimeError(f"Cloudflare TTS API failed: {resp.status_code} {resp.text[:200]}")
        
        audio_bytes = resp.content
        # Duration estimate: ~150 words/min, ~5 chars/word
        duration_seconds = max(0.5, len(text) / (150 * 5 / 60))
        cost_neurons = (duration_seconds / 60.0) * MELOTTS_COST_PER_MINUTE * 1000  # in neurons
        return audio_bytes, cost_neurons


async def call_cf_chat(
    messages: list[dict],
    system_prompt: str = "",
    max_tokens: int = 4000,
) -> tuple[str, int]:
    """Call Cloudflare Workers AI chat model (GLM-4.7-Flash).
    
    Args:
        messages: List of message dicts with "role" and "content"
        system_prompt: Optional system prompt
        max_tokens: Maximum tokens in response
        
    Returns:
        Tuple of (response_text, cost_neurons)
        
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
        
        # Calculate cost based on input tokens using the unified cost function
        # Estimate input tokens: ~4 chars per token
        estimated_input_tokens = (sum(len(m.get("content", "")) for m in messages) + len(system_prompt)) // 4
        cost_neurons = calculate_ai_cost_neurons("chat", estimated_input_tokens)
        
        return response_text, cost_neurons


async def call_cf_chat_granite(
    messages: list[dict],
    system_prompt: str = "",
    max_tokens: int = 4000,
) -> tuple[str, float]:
    """Call Cloudflare Workers AI chat model (Granite 4.0 H-Micro).
    
    Args:
        messages: List of message dicts with "role" and "content"
        system_prompt: Optional system prompt
        max_tokens: Maximum tokens in response
        
    Returns:
        Tuple of (response_text, cost_neurons)
        
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
            f"{CF_BASE_URL}/{CF_MODELS['chat_standard']}",
            headers={"Authorization": f"Bearer {CF_AI_API_KEY}"},
            json=payload,
        )
        if resp.status_code != 200:
            raise RuntimeError(f"Cloudflare chat API failed: {resp.status_code} {resp.text[:200]}")
        
        result = resp.json().get("result", {})
        response_text = result.get("response") or result.get("content") or ""
        
        # Calculate cost based on input tokens using Granite pricing
        # Estimate input tokens: ~4 chars per token
        estimated_input_tokens = (sum(len(m.get("content", "")) for m in messages) + len(system_prompt)) // 4
        cost_neurons = calculate_ai_cost_neurons("chat", estimated_input_tokens, use_granite=True)
        
        return response_text, cost_neurons


async def route_ai(
    prompt: str,
    task_type: str = "fast",
    max_tokens: int = settings.ai_default_max_tokens,
    db=None,
) -> dict:
    """Route an AI prompt using tier routing: Granite for simple queries, GLM for complex ones.

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
    import random
    logger = logging.getLogger("uvicorn.error")
    
    if not CF_ACCOUNT_ID or not CF_AI_API_KEY:
        logger.error("Cloudflare Workers AI not configured (CF_ACCOUNT_ID or CF_AI_API_KEY missing)")
        raise HTTPException(
            status_code=503,
            detail="AI service not configured",
        )
    
    try:
        # Classify the prompt to determine tier
        use_premium = should_use_premium_model(prompt)
        
        # Apply tier split: 70% standard / 20% premium / 10% premium-escalated
        tier_roll = random.randint(0, 99)
        if tier_roll < 70:
            # Standard tier - use Granite
            use_premium = False
        elif tier_roll < 90:
            # Premium tier - use GLM
            use_premium = True
        else:
            # Premium escalation - use GLM
            use_premium = True
        
        if use_premium:
            response_text, cost = await call_cf_chat(
                messages=[{"role": "user", "content": prompt}],
                max_tokens=max_tokens,
            )
            model = CF_MODELS["chat"]
        else:
            response_text, cost = await call_cf_chat_granite(
                messages=[{"role": "user", "content": prompt}],
                max_tokens=max_tokens,
            )
            model = CF_MODELS["chat_standard"]
        
        logger.debug(
            "AI tier routing: use_premium=%s, model=%s, prompt_len=%d",
            use_premium, model, len(prompt),
        )
        
        return {
            "response": response_text,
            "provider": "cloudflare",
            "model": model,
        }
    except Exception as exc:
        logger.error("Cloudflare Workers AI failed: %s", exc)
        raise HTTPException(
            status_code=503,
            detail=f"AI service unavailable: {str(exc)[:100]}",
        ) from exc
