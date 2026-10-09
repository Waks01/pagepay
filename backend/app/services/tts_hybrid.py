"""Hybrid TTS service for on-demand study audio.

Provider chain (first success wins):
  1. Cloudflare Workers AI MeloTTS (free/pay-as-you-go)
  2. edge-tts (Microsoft, no key required)

Long text is split into sentence-boundary chunks (~1500 chars each).
Each chunk is cached separately so a retry does not lose progress.
Failed chunks are retried with the next provider in the chain; if all
providers fail for one chunk, synthesis stops and raises an error.
Chunks are concatenated into one MP3 before returning.
"""

from __future__ import annotations

import hashlib
import logging
import re
from pathlib import Path

import httpx
import edge_tts

from app.config import settings

logger = logging.getLogger("uvicorn.error")

AUDIO_CACHE_DIR = Path(settings.audio_cache_dir)
AUDIO_CACHE_DIR.mkdir(parents=True, exist_ok=True)

TTS_CHUNK_TARGET_CHARS = 1500
TTS_CHUNK_MAX_CHARS = 2000


def _cache_path(text: str, voice: str, provider: str) -> Path:
    key = hashlib.sha256(f"{provider}:{voice}:{text}".encode()).hexdigest()[:16]
    shard = key[:2]
    d = AUDIO_CACHE_DIR / "tts" / shard
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{key}.mp3"


def _chunk_text(text: str) -> list[str]:
    if len(text) <= TTS_CHUNK_TARGET_CHARS:
        return [text]

    sentences = re.split(r"(?<=[.!?])\s+", text)
    chunks: list[str] = []
    current = ""
    for sentence in sentences:
        if len(current) + len(sentence) + 1 > TTS_CHUNK_MAX_CHARS and current:
            chunks.append(current.strip())
            current = sentence
        else:
            current = f"{current} {sentence}".strip()
        if len(current) >= TTS_CHUNK_TARGET_CHARS:
            chunks.append(current.strip())
            current = ""
    if current:
        chunks.append(current.strip())
    return [c for c in chunks if c]


async def _tts_cloudflare(text: str, voice: str) -> bytes | None:
    if not settings.cloudflare_account_id or not settings.cloudflare_api_token:
        return None
    try:
        url = (
            f"https://api.cloudflare.com/client/v4/accounts/"
            f"{settings.cloudflare_account_id}/ai/run/@cf/myshell-ai/melotts"
        )
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                url,
                headers={
                    "Authorization": f"Bearer {settings.cloudflare_api_token}",
                    "Content-Type": "application/json",
                },
                json={"prompt": text},
            )
            if resp.status_code != 200:
                logger.warning("Cloudflare TTS failed: %s %s", resp.status_code, resp.text[:200])
                return None
            data = resp.json()
            audio_b64 = data.get("result", {}).get("audio", "")
            if not audio_b64:
                logger.warning("Cloudflare TTS returned no audio: %s", resp.text[:200])
                return None
            import base64
            return base64.b64decode(audio_b64)
    except Exception as exc:
        logger.warning("Cloudflare TTS error: %s", exc)
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

    Long text is split into sentence-boundary chunks. Each chunk is
    generated via the provider chain and cached individually so retries
    do not lose progress. Chunks are concatenated into one MP3.

    Returns (audio_bytes, provider_name). Raises RuntimeError if any
    chunk fails across all providers.
    """
    voice = voice or settings.tts_default_voice
    provider = provider or settings.tts_default_provider

    cache = _cache_path(text, voice, provider)
    if cache.exists():
        return cache.read_bytes(), provider

    chunks = _chunk_text(text)
    if not chunks:
        raise RuntimeError("Empty text after chunking")

    providers = {
        "cloudflare": _tts_cloudflare,
        "edge": _tts_edge,
    }

    ordered = [k for k in ("cloudflare", "edge") if k in providers]
    if provider in providers and provider not in ordered:
        ordered.insert(0, provider)

    chunk_files: list[Path] = []
    last_provider = provider
    try:
        for chunk in chunks:
            chunk_cache = _cache_path(chunk, voice, provider)
            if chunk_cache.exists():
                chunk_files.append(chunk_cache)
                continue

            chunk_bytes = None
            for name in ordered:
                try:
                    chunk_bytes = await providers[name](chunk, voice)
                    if chunk_bytes:
                        last_provider = name
                        break
                except Exception as exc:
                    logger.warning("TTS provider %s failed for chunk: %s", name, exc)

            if chunk_bytes is None:
                raise RuntimeError(f"TTS failed for chunk: {chunk[:80]}...")

            chunk_cache.write_bytes(chunk_bytes)
            chunk_files.append(chunk_cache)

        final_bytes = b"".join(p.read_bytes() for p in chunk_files)
        cache.write_bytes(final_bytes)
        return final_bytes, last_provider
    finally:
        for path in chunk_files:
            try:
                if path.exists() and path != cache:
                    path.unlink()
            except OSError:
                pass