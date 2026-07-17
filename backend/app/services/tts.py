"""TTS audio generation for v3 Listen mode.

Per v3 §3.3, Listen mode narrates reading units with pre-rendered
MP3 files. The audio is generated server-side with `edge-tts` (free,
decent quality) in a batch job. The first unit of any work is free;
units 2+ require premium.

This module provides:
  - generate_audio_for_unit(): one-time generation per unit
  - batch_generate_audio_for_work(): batch job for all units in a work
  - Audio files stored at: {audio_cache_dir}/units/{unit_id}.mp3

The audio endpoint is GET /api/v1/content/audio/{unit_id}.mp3
(in routers/audio.py). Public, cached 30 days, same pattern as
the image proxy.

Voice selection: en-US-AriaNeural (Microsoft Edge TTS).
Neutral, clear, works for education content. Regional variants
(en-NG) exist but as of 2026-07 have worse prosody.

Why edge-tts and not Google Cloud TTS:
  - Free, no API key required
  - Quality sufficient for MVP
  - 200+ voices across 40+ languages (future i18n ready)
  - Can upgrade to paid TTS (ElevenLabs, OpenAI) when we hit
    Listen mode premium revenue targets (v3 §8 metrics)
"""

import asyncio
import hashlib
import logging
from pathlib import Path

import edge_tts
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import ContentCatalog, ReadingUnit

logger = logging.getLogger("uvicorn.error")

# Voice config per v3 §3.3 + Appendix C.
# The en-US-AriaNeural voice is a balanced choice for education:
# clear diction, neutral accent, good prosody for long-form prose.
# Regional variants (en-NG-AbeoNeural, en-NG-EzinneNeural) exist
# but as of edge-tts 6.1.18 have rougher prosody and occasional
# mispronunciation on technical terms. Revisit when Microsoft
# ships the next Edge TTS model update.
DEFAULT_VOICE = "en-US-AriaNeural"

# Rate +0% (normal speed). The client's player UI offers 0.75x / 1x /
# 1.25x / 1.5x controls; we don't pre-render at multiple speeds.
SPEECH_RATE = "+0%"


def _audio_cache_dir() -> Path:
    """Return the audio cache root. Creates it if missing."""
    d = Path(settings.audio_cache_dir)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _audio_path_for_unit(unit_id: int) -> Path:
    """Map a unit_id to the on-disk audio file path.

    v3 §2.3 image proxy uses a 2-level hash to split files across
    directories. Audio is simpler: unit IDs are sequential ints, so
    we split by the last 2 digits (units/00/100.mp3, units/01/101.mp3).
    Keeps any one dir under ~10k files for a 1M-unit catalog.
    """
    shard = f"{unit_id % 100:02d}"
    units_dir = _audio_cache_dir() / "units" / shard
    units_dir.mkdir(parents=True, exist_ok=True)
    return units_dir / f"{unit_id}.mp3"


async def generate_audio_for_unit(
    unit_id: int,
    text: str,
    *,
    voice: str = DEFAULT_VOICE,
    rate: str = SPEECH_RATE,
    force: bool = False,
) -> Path:
    """Generate TTS audio for a single unit and return the file path.

    Args:
        unit_id: the reading_units.id
        text: the body text to narrate. Sentinels ([[IMG:...]],
            Caption: ..., [TABLE START]..., [[EQ:...]]) are stripped
            before generation — the listener doesn't benefit from
            "caption colon figure three point one shows...".
        voice: edge-tts voice name (default: en-US-AriaNeural)
        rate: speech rate string (default: +0% = normal)
        force: if True, regenerate even if the file exists

    Returns:
        Path to the generated .mp3 file

    Raises:
        RuntimeError: if edge-tts generation fails
    """
    path = _audio_path_for_unit(unit_id)
    if path.exists() and not force:
        logger.debug(f"TTS audio already exists: unit {unit_id} -> {path}")
        return path

    # Strip v3 reader sentinels. The listen mode plays the prose
    # without the visual layers. We keep "Caption:" text because
    # it's already plain prose (the caption is the figure's
    # description), but we drop the markers that only make sense
    # in visual reading.
    cleaned = text
    # [[IMG:src|alt]] → keep alt text if it exists, otherwise drop
    import re
    img_re = re.compile(r"\[\[IMG:[^|]*\|([^\]]*)\]\]")
    cleaned = img_re.sub(lambda m: m.group(1).strip() or "", cleaned)
    # [TABLE START]...[TABLE END] → drop entirely (tables are visual)
    cleaned = re.sub(r"\[TABLE START\].*?\[TABLE END\]", "", cleaned, flags=re.DOTALL)
    # [[EQ:...]] → drop (equations are visual)
    cleaned = re.sub(r"\[\[EQ:[^\]]*\]\]", "", cleaned)
    # Multiple blank lines → single blank line
    cleaned = re.sub(r"\n\n+", "\n\n", cleaned)
    cleaned = cleaned.strip()

    if not cleaned:
        # Edge case: a slice with only images/tables/equations has
        # no prose. Generate a 1-second silent placeholder so the
        # endpoint doesn't 404. The player will skip it.
        logger.warning(f"TTS unit {unit_id} has no prose content after sentinel strip. Generating silent placeholder.")
        # edge-tts can't generate silence directly; we write a
        # minimal MP3 header manually. 1s at 16kHz mono is ~2KB.
        # Or we use edge-tts with a single period, which is ~4KB.
        cleaned = "."

    logger.info(f"Generating TTS audio: unit {unit_id} ({len(cleaned)} chars)")
    try:
        communicate = edge_tts.Communicate(cleaned, voice=voice, rate=rate)
        await communicate.save(str(path))
    except Exception as e:
        logger.error(f"TTS generation failed for unit {unit_id}: {e}")
        path.unlink(missing_ok=True)
        raise RuntimeError(f"TTS generation failed: {e}") from e

    logger.info(f"TTS audio generated: unit {unit_id} -> {path} ({path.stat().st_size} bytes)")
    return path


async def batch_generate_audio_for_work(
    db: AsyncSession,
    work_id: int,
    *,
    voice: str = DEFAULT_VOICE,
    rate: str = SPEECH_RATE,
    force: bool = False,
    concurrency: int = 5,
) -> int:
    """Batch-generate TTS audio for all units in a work.

    Args:
        db: async database session
        work_id: content_catalog.id (parent work)
        voice: edge-tts voice name
        rate: speech rate
        force: regenerate existing files
        concurrency: max parallel TTS tasks (default 5 to avoid
            overwhelming edge-tts with 100+ simultaneous requests)

    Returns:
        Number of units processed

    This is the batch job called by a cron or admin endpoint. For
    the 12-book OpenStax curriculum (~800 units), this runs in ~30-50
    minutes on a single vCPU with concurrency=5. The bottleneck is
    edge-tts upstream latency, not CPU. Bumping concurrency to 10+
    risks rate-limits from Microsoft.

    The job is idempotent: rerun anytime, existing files are skipped
    unless `force=True`.
    """
    # Fetch all units for this work (slices → units)
    stmt = (
        select(ReadingUnit)
        .join(ContentCatalog, ContentCatalog.id == ReadingUnit.slice_id)
        .where(ContentCatalog.parent_work_id == work_id)
        .order_by(ReadingUnit.unit_order)
    )
    result = await db.execute(stmt)
    units = result.scalars().all()

    if not units:
        logger.warning(f"batch_generate_audio_for_work: work {work_id} has no units")
        return 0

    logger.info(f"Batch TTS: work {work_id} has {len(units)} units. Concurrency={concurrency}")

    # Semaphore-controlled parallel generation
    semaphore = asyncio.Semaphore(concurrency)

    async def _gen_one(unit: ReadingUnit) -> None:
        async with semaphore:
            try:
                await generate_audio_for_unit(
                    unit.id,
                    unit.body_text,
                    voice=voice,
                    rate=rate,
                    force=force,
                )
            except Exception as e:
                logger.error(f"batch_generate_audio_for_work: unit {unit.id} failed: {e}")

    tasks = [_gen_one(u) for u in units]
    await asyncio.gather(*tasks, return_exceptions=True)

    logger.info(f"Batch TTS complete: work {work_id}, {len(units)} units")
    return len(units)


async def batch_generate_audio_for_all_works(
    db: AsyncSession,
    *,
    voice: str = DEFAULT_VOICE,
    rate: str = SPEECH_RATE,
    force: bool = False,
    concurrency: int = 5,
) -> int:
    """Batch-generate TTS audio for ALL works in the catalog.

    This is the one-time job run after v3 §3.3 ships to pre-populate
    audio for the existing OpenStax curriculum. Takes ~1-2 hours for
    the full catalog (12 books, ~800 units).

    Returns:
        Total number of units processed
    """
    # Fetch all parent works (where parent_work_id IS NULL)
    stmt = select(ContentCatalog.id).where(ContentCatalog.parent_work_id.is_(None))
    result = await db.execute(stmt)
    work_ids = [row[0] for row in result.all()]

    logger.info(f"Batch TTS for all works: {len(work_ids)} works")
    total = 0
    for work_id in work_ids:
        count = await batch_generate_audio_for_work(
            db, work_id, voice=voice, rate=rate, force=force, concurrency=concurrency
        )
        total += count

    logger.info(f"Batch TTS complete for all works: {total} units")
    return total
