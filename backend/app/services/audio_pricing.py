"""Pricing for paid audio narration episodes.

Cost is metered on **output** characters, because that is the quantity
that actually consumes tokens: a deeper explanation level produces a
longer script from the same source material.

    cost = base_sv(level) + ceil(chars / char_step) * rate_sv(level)

Levels are ordered cheapest to most expensive — `primary` keeps
explanations short and analogy-driven, `research` is wide-ranging prose.
All figures come from ``settings`` so they can be tuned without a code
change, and the character cap is a hard server-side limit: a single
request can never exceed it regardless of what the client asks for.
"""

from __future__ import annotations

import math

from app.config import settings

VALID_LEVELS = ("primary", "secondary", "tertiary", "research")
DEFAULT_LEVEL = "secondary"

#: Rough speaking rate used to turn characters into an estimate of audio
#: length. English narrative averages ~150 words per minute, and a word
#: is ~6 characters including the trailing space.
CHARS_PER_SPOKEN_WORD = 6
WORDS_PER_MINUTE = 150

#: A narration expands on its source: the model explains, gives examples,
#: and recaps rather than compressing. These bounds shape the estimate of
#: what the user will actually HEAR, which is not the same as the amount
#: of source material that was priced.
MIN_OUTPUT_CHARS = 600
MAX_OUTPUT_CHARS = 5400  # ~360s, the top of the 5-10 minute target


def estimate_output_chars(source_chars: int) -> int:
    """Estimate the narration script length a topic will produce.

    Priced on source characters (that is what consumes tokens), but the
    user is shown how long the audio will be, which follows the
    generated script — so the two must be estimated separately.
    """
    if source_chars <= 0:
        return 0
    return int(min(MAX_OUTPUT_CHARS, max(MIN_OUTPUT_CHARS, source_chars * 2)))


def billing_chars(source_chars: int, episodes: int = 1) -> int:
    """Characters a request should actually be billed for.

    One episode is generated with a fixed target of ~900 words no matter
    how much source it draws on, so the cost driver is
    `episodes × the per-episode output cap`. `estimate_output_chars`
    alone caps at that figure for the whole topic, which under-billed any
    topic long enough to split — a 20k-char topic generates 2+ episodes
    of script but billed for one.

    A single episode keeps the estimate-based figure (bounded below by
    MIN_OUTPUT_CHARS) so a short topic is not charged for a cap it never
    reaches.
    """
    if source_chars <= 0:
        return 0
    episodes = max(1, int(episodes))
    if episodes <= 1:
        return estimate_output_chars(source_chars)
    return episodes * MAX_OUTPUT_CHARS


def estimate_episode_seconds(source_chars: int) -> int:
    """Estimated audio length for one episode of a topic."""
    return estimate_duration_seconds(estimate_output_chars(source_chars))


def normalise_level(level: str | None) -> str:
    """Clamp a client-supplied level to a known value."""
    if isinstance(level, str) and level in VALID_LEVELS:
        return level
    return DEFAULT_LEVEL


def estimate_duration_seconds(char_count: int) -> int:
    """Convert a character count into an estimated spoken duration."""
    if char_count <= 0:
        return 0
    words = char_count / CHARS_PER_SPOKEN_WORD
    return int(round((words / WORDS_PER_MINUTE) * 60))


def quote_cost(level: str | None, char_count: int) -> int:
    """Service credits needed to narrate `char_count` characters at `level`.

    Returns 0 for nothing to narrate so an empty request never charges.
    """
    level = normalise_level(level)
    if char_count <= 0:
        return 0

    base = settings.audio_narration_base_sv.get(level, 10)
    rate = settings.audio_narration_rate_sv.get(level, 4)
    steps = math.ceil(char_count / settings.audio_narration_char_step)
    return int(base + (steps * rate))


def quote_detailed(level: str | None, char_count: int) -> dict:
    """Breakdown a client can show the user before they commit.

    The user sees exactly this number, and it is the number charged, so
    what was quoted is what is paid.
    """
    level = normalise_level(level)
    step = settings.audio_narration_char_step
    base = settings.audio_narration_base_sv.get(level, 10)
    rate = settings.audio_narration_rate_sv.get(level, 4)
    steps = math.ceil(char_count / step) if char_count > 0 else 0
    total = int(base + (steps * rate)) if char_count > 0 else 0
    return {
        "level": level,
        "char_count": char_count,
        "base_sv": base,
        "rate_sv": rate,
        "char_step": step,
        "steps": steps,
        "cost_sv": total,
        "estimated_seconds": estimate_episode_seconds(char_count),
        "episodes": split_into_episodes(char_count),
    }


def split_into_episodes(char_count: int) -> int:
    """How many episodes a topic of this length needs.

    Topics are delivered as 5-10 minute episodes rather than one long
    file, so a long topic splits into sequential episodes.
    """
    if char_count <= 0:
        return 0
    target = max(1, settings.audio_episode_target_chars)
    max_chars = max(target, settings.audio_episode_max_chars)
    if char_count <= target:
        return 1
    return int(math.ceil(char_count / max_chars))


def max_chars_per_request() -> int:
    """Hard ceiling on narratable characters for a single request."""
    return settings.audio_narration_max_chars
