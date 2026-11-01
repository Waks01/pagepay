"""Hybrid TTS service for on-demand study audio.

Provider chain (first success wins):
  1. NVIDIA Magpie TTS Multilingual (free prototype tier)
  2. OpenRouter TTS endpoint (free :free models)
  3. Gemini 3.1 Flash TTS Preview (free tier)
  4. edge-tts (Microsoft, no key required)

All providers return raw MP3 bytes. The caller writes them to disk or
streams them back to the client. Cache key = SHA256(text + voice +
provider), so the same request hits disk on repeat reads.
"""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path

import httpx
import edge_tts

from app.config import settings

logger = logging.getLogger("uvicorn.error")

AUDIO_CACHE_DIR = Path(settings.audio_cache_dir)
AUDIO_CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _cache_path(text: str, voice: str, provider: str) -> Path:
    key = hashlib.sha256(f"{provider}:{voice}:{text}".encode()).hexdigest()[:16]
    shard = key[:2]
    d = AUDIO_CACHE_DIR / "tts" / shard
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{key}.mp3"


async def _tts_nvidia(text: str, voice: str) -> bytes | None:
    if not settings.nvidia_nim_api_key:
        return None
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                settings.nvidia_nim_tts_url,
                headers={
                    "Authorization": f"Bearer {settings.nvidia_nim_api_key}",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                data={
                    "text": text,
                    "voice": voice,
                    "language_code": "en-US",
                    "stream": "false",
                },
            )
            if resp.status_code == 200 and resp.headers.get("content-type", "").startswith("audio"):
                return resp.content
            logger.warning("NVIDIA TTS failed: %s %s", resp.status_code, resp.text[:200])
    except Exception as exc:
        logger.warning("NVIDIA TTS error: %s", exc)
    return None


async def _tts_openrouter(text: str, voice: str) -> bytes | None:
    if not settings.openrouter_api_key:
        return None
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://openrouter.ai/api/v1/audio/speech",
                headers={
                    "Authorization": f"Bearer {settings.openrouter_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "openai/gpt-4o-mini-tts-2025-12-15",
                    "input": text,
                    "voice": voice,
                    "response_format": "mp3",
                },
            )
            if resp.status_code == 200 and resp.headers.get("content-type", "").startswith("audio"):
                return resp.content
            logger.warning("OpenRouter TTS failed: %s %s", resp.status_code, resp.text[:200])
    except Exception as exc:
        logger.warning("OpenRouter TTS error: %s", exc)
    return None


async def _tts_gemini(text: str, voice: str) -> bytes | None:
    if not settings.gemini_api_key:
        return None
    try:
        payload = {
            "model": "gemini-3.1-flash-tts-preview",
            "input": text,
            "response_format": {"type": "audio"},
            "generation_config": {
                "speech_config": [{"voice": voice}]
            },
        }
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent",
                headers={
                    "x-goog-api-key": settings.gemini_api_key,
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            if resp.status_code == 200:
                data = resp.json()
                parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
                for part in parts:
                    inline = part.get("inlineData") or part.get("inline_data")
                    if inline and inline.get("mimeType", "").startswith("audio"):
                        import base64
                        return base64.b64decode(inline["data"])
            logger.warning("Gemini TTS failed: %s %s", resp.status_code, resp.text[:200])
    except Exception as exc:
        logger.warning("Gemini TTS error: %s", exc)
    return None


async def _tts_edge(text: str, voice: str) -> bytes | None:
    try:
        path = AUDIO_CACHE_DIR / f"edge_{hashlib.md5((voice + text).encode()).hexdigest()[:12]}.mp3"
        communicate = edge_tts.Communicate(text, voice=voice, rate=settings.tts_default_rate)
        await communicate.save(str(path))
        return path.read_bytes()
    except Exception as exc:
        logger.warning("edge-tts error: %s", exc)
        return None


async def synthesize_study_audio(
    text: str,
    voice: str | None = None,
    *,
    provider: str | None = None,
) -> tuple[bytes, str]:
    """Synthesize speech for study material text.

    Returns (audio_bytes, provider_name). Raises RuntimeError if all
    providers fail.
    """
    voice = voice or settings.tts_default_voice
    provider = provider or settings.tts_default_provider

    cache = _cache_path(text, voice, provider)
    if cache.exists():
        return cache.read_bytes(), provider

    providers = {
        "nvidia": lambda: _tts_nvidia(text, voice),
        "openrouter": lambda: _tts_openrouter(text, voice),
        "gemini": lambda: _tts_gemini(text, voice),
        "edge": lambda: _tts_edge(text, voice),
    }

    ordered = [k for k in ("nvidia", "openrouter", "gemini", "edge") if k in providers]
    if provider in providers and provider not in ordered:
        ordered.insert(0, provider)

    last_err = None
    for name in ordered:
        fn = providers[name]
        try:
            audio = await fn()
            if audio:
                cache.write_bytes(audio)
                return audio, name
        except Exception as exc:
            last_err = exc
            logger.warning("TTS provider %s failed: %s", name, exc)

    raise RuntimeError(f"All TTS providers failed. Last error: {last_err}")
