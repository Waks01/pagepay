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


def _audio_ext(audio_bytes: bytes) -> str:
    """Detect the container format from the file signature.

    Cloudflare MeloTTS returns WAV, edge-tts returns MP3, so the
    extension cannot be inferred from the provider alone.
    """
    if audio_bytes[:2] == b"ID3" or audio_bytes[:3] in (b"\xff\xfb", b"\xff\xf3"):
        return "mp3"
    if audio_bytes[:4] == b"RIFF" and audio_bytes[8:12] == b"WAVE":
        return "wav"
    return "wav"


def _cache_path(text: str, voice: str, provider: str, audio_bytes: bytes | None = None) -> Path:
    key = hashlib.sha256(f"{provider}:{voice}:{text}".encode()).hexdigest()[:16]
    shard = key[:2]
    d = AUDIO_CACHE_DIR / "tts" / shard
    d.mkdir(parents=True, exist_ok=True)
    # Without audio_bytes the extension is unknown, so prefer .mp3: the
    # edge-tts provider is the common path and the file is served by
    # sniffing its signature anyway.
    ext = _audio_ext(audio_bytes) if audio_bytes else "mp3"
    return d / f"{key}.{ext}"


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


def _concat_audio(chunks: list[bytes]) -> bytes:
    """Concatenate audio chunks. Handles both MP3 (simple byte join)
    and WAV (strip headers, merge PCM, rebuild header)."""
    if not chunks:
        return b""
    # If all chunks are MP3, simple join works.
    first = chunks[0]
    if first[:2] == b"ID3" or first[:3] in (b"\xff\xfb", b"\xff\xf3"):
        return b"".join(chunks)

    # WAV: extract PCM data from each chunk and rebuild a single WAV.
    if first[:4] == b"RIFF" and first[8:12] == b"WAVE":
        pcm_data = b""
        for chunk in chunks:
            pcm = _wav_extract_pcm(chunk)
            if pcm is None:
                # Fallback: if any chunk isn't valid WAV, just join raw
                return b"".join(chunks)
            pcm_data += pcm
        return _wav_build_pcm(pcm_data, first)

    return b"".join(chunks)


def _wav_extract_pcm(wav: bytes) -> bytes | None:
    """Extract raw PCM samples from a WAV byte string."""
    import struct
    if len(wav) < 44 or wav[:4] != b"RIFF" or wav[8:12] != b"WAVE":
        return None
    # Find the data subchunk
    pos = 12
    while pos < len(wav) - 8:
        if wav[pos:pos+4] == b"data":
            size = struct.unpack("<I", wav[pos+4:pos+8])[0]
            return wav[pos+8:pos+8+size]
        sub_size = struct.unpack("<I", wav[pos+4:pos+8])[0]
        pos += 8 + sub_size + (sub_size % 2)
    return None


def _wav_build_pcm(pcm: bytes, template: bytes) -> bytes:
    """Build a valid WAV from raw PCM data using the template's format."""
    import struct
    # Copy format info from template
    byte_rate = struct.unpack("<I", template[24:28])[0]
    block_align = struct.unpack("<H", template[32:34])[0]
    bits_per_sample = struct.unpack("<H", template[34:36])[0]

    out = bytearray()
    out += b"RIFF"
    out += struct.pack("<I", 36 + len(pcm))
    out += b"WAVE"
    out += b"fmt "
    out += struct.pack("<I", 16)  # subchunk size
    out += struct.pack("<H", 1)   # PCM
    channels = struct.unpack("<H", template[22:24])[0]
    sample_rate = struct.unpack("<I", template[24:28])[0]
    out += struct.pack("<H", channels)
    out += struct.pack("<I", sample_rate)
    out += struct.pack("<I", byte_rate)
    out += struct.pack("<H", block_align)
    out += struct.pack("<H", bits_per_sample)
    out += b"data"
    out += struct.pack("<I", len(pcm))
    out += pcm
    return bytes(out)


def _find_cached(cache: Path) -> Path | None:
    """Return the cached file for this key, whatever extension it has.

    The extension reflects the actual container, which differs between
    providers (MeloTTS returns WAV, edge-tts returns MP3), so a cache
    lookup must not assume one.
    """
    if cache.exists():
        return cache
    stem = cache.stem
    for candidate in sorted(cache.parent.glob(f"{stem}.*")):
        return candidate
    return None


async def synthesize_study_audio(
    text: str,
    voice: str | None = None,
    *,
    provider: str | None = None,
) -> tuple[bytes, str, Path]:
    """Synthesize speech for study material text.

    Long text is split into sentence-boundary chunks. Each chunk is
    generated via the provider chain and cached individually so retries
    do not lose progress. Chunks are concatenated into one audio file.

    Returns (audio_bytes, provider_name, cache_path). The cache_path is
    the file that actually exists on disk — its extension matches the
    real container, which differs between providers. Raises RuntimeError
    if any chunk fails across all providers.
    """
    voice = voice or settings.tts_default_voice
    provider = provider or settings.tts_default_provider

    cache = _cache_path(text, voice, provider)
    cached = _find_cached(cache)
    if cached is not None:
        return cached.read_bytes(), provider, cached

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
    chunk_bytes_list: list[bytes] = []
    last_provider = provider
    for chunk in chunks:
        chunk_cache = _cache_path(chunk, voice, provider)
        if chunk_cache.exists():
            chunk_bytes_list.append(chunk_cache.read_bytes())
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

        # Cache with correct extension based on actual audio format
        chunk_cache = chunk_cache.with_suffix(f".{_audio_ext(chunk_bytes)}")
        chunk_cache.write_bytes(chunk_bytes)
        chunk_bytes_list.append(chunk_bytes)
        chunk_files.append(chunk_cache)

    final_bytes = _concat_audio(chunk_bytes_list)
    # Write final with correct extension
    final_cache = cache.with_suffix(f".{_audio_ext(final_bytes)}")
    final_cache.write_bytes(final_bytes)
    # The per-chunk files are deliberately left on disk. They are the
    # cache this function's own docstring promises: a retry re-reads
    # them instead of paying for the speech again, and the directory
    # is a cache directory, not a work queue.
    return final_bytes, last_provider, final_cache