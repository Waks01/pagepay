"""TTS service for study audio using Cloudflare Workers AI.

Single provider: @cf/myshell-ai/melotts
Returns raw MP3 bytes and duration for cost calculation.
Cache key = SHA256(text + voice), so the same request hits disk on repeat reads.
"""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path

from app.ai.router import call_cf_tts
from app.config import settings

logger = logging.getLogger("uvicorn.error")

AUDIO_CACHE_DIR = Path(settings.audio_cache_dir)
AUDIO_CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _cache_path(text: str, voice: str) -> Path:
    """Generate cache path for TTS audio."""
    key = hashlib.sha256(f"cloudflare:{voice}:{text}".encode()).hexdigest()[:16]
    shard = key[:2]
    d = AUDIO_CACHE_DIR / "tts" / shard
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{key}.mp3"


async def synthesize_study_audio(
    text: str,
    voice: str | None = None,
    *,
    provider: str | None = None,
) -> tuple[bytes, str, float]:
    """Synthesize speech for study material text using Cloudflare Workers AI.

    Args:
        text: Text to convert to speech
        voice: Voice identifier (unused, kept for backwards compatibility)
        provider: Provider name (unused, always Cloudflare)

    Returns:
        Tuple of (audio_bytes, provider_name, duration_seconds)

    Raises:
        RuntimeError: if Cloudflare TTS fails
    """
    # Ignore voice and provider params, always use Cloudflare
    # Keep the signature for backwards compatibility with calling code

    cache = _cache_path(text, "melotts")
    if cache.exists():
        # Return cached audio with estimated duration
        audio_bytes = cache.read_bytes()
        # Estimate duration from text length (conservative: 3 chars/sec)
        duration = max(0.5, len(text) / 3.0)
        return audio_bytes, "cloudflare", duration

    try:
        audio_bytes, duration_seconds = await call_cf_tts(text, voice="melotts")
        cache.write_bytes(audio_bytes)
        logger.info(
            "[TTS] Generated audio via Cloudflare: text_len=%d, duration=%.2f",
            len(text),
            duration_seconds,
        )
        return audio_bytes, "cloudflare", duration_seconds
    except Exception as exc:
        logger.error("Cloudflare TTS failed: %s", exc)
        raise RuntimeError(f"Cloudflare Workers AI TTS failed: {str(exc)[:100]}") from exc
