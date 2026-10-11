"""Paid audio narration generation for study materials.

Turns a selected topic of a material into a spoken lesson script. This
is deliberately an **LLM pass**, not a text transformation: the brief is
a tutor explaining the topic to a student, which needs rephrasing,
analogies, spoken formulas, and signposted structure. Reading the source
blocks aloud — which is what the raw TTS path did — narrates page
numbers, OCR artifacts, and code.

Flow
----
1. `build_topic_source()` renders the blocks belonging to one topic into
   a compact text source for the model.
2. `generate_episode_script()` calls the AI router with
   `STUDY_NARRATION_SCRIPT` and returns the spoken script.
3. The caller synthesises speech from that script and persists the batch
   row, which freezes the wording so playback can always resume the
   exact lesson the user paid for.

There is no degraded fallback: if generation fails the caller reports
failure and refunds, rather than silently reading raw material.
"""

from __future__ import annotations

from app.ai.prompts import NARRATION_LEVEL_GUIDANCE, STUDY_NARRATION_SCRIPT
from app.config import settings
from app.services.audio_pricing import (
    DEFAULT_LEVEL,
    normalise_level,
    split_into_episodes,
)

#: Character budget per episode when splitting a long topic. Mirrors
#: `audio_episode_max_chars`; a topic above this becomes several episodes.
_CHARS_PER_EPISODE = 6000


def _clean(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.split()).strip()


def _get_blocks(parsed_structure: object) -> list[dict]:
    if not isinstance(parsed_structure, dict):
        return []
    blocks = parsed_structure.get("content_blocks")
    if not isinstance(blocks, list):
        return []
    return [b for b in blocks if isinstance(b, dict)]


def _get_topics(parsed_structure: object) -> list[dict]:
    if not isinstance(parsed_structure, dict):
        return []
    topics = parsed_structure.get("topics")
    if not isinstance(topics, list):
        return []
    return [t for t in topics if isinstance(t, dict)]


def _render_block(block: dict) -> str:
    """Render one block into plain source text for the model."""
    kind = _clean(block.get("type")).lower()

    if kind == "heading":
        return f"Section: {_clean(block.get('text'))}"
    if kind == "body":
        return _clean(block.get("text"))
    if kind in ("list", "numbered_list"):
        items = [_clean(v) for v in (block.get("items") or []) if isinstance(v, str)]
        return "List: " + "; ".join(_clean(i) for i in items if _clean(i))
    if kind in ("tip", "warning", "calculation"):
        label = _clean(block.get("label")) or kind
        text = _clean(block.get("text"))
        steps = [
            _clean(s) for s in (block.get("steps") or []) if isinstance(s, str)
        ]
        steps = [s for s in steps if s]
        body = " → ".join(steps) if steps else text
        return f"{label.capitalize()}: {body}" if body else ""
    if kind == "quote":
        return f"Quote: {_clean(block.get('text'))}"
    if kind == "formula":
        text = _clean(block.get("text"))
        description = _clean(block.get("description"))
        return f"Formula {text} — {description}" if description else f"Formula {text}"
    if kind == "table":
        headers = [_clean(h) for h in (block.get("headers") or []) if isinstance(h, str)]
        rows = block.get("rows") or []
        lines = ["Table: " + " | ".join(h for h in headers if h)]
        for row in rows:
            if isinstance(row, list):
                cells = [_clean(c) for c in row if isinstance(c, str)]
                lines.append("  " + " | ".join(c for c in cells if c))
        return "\n".join(lines)
    if kind == "code":
        # Code is source for a reader, not for a listener; the model
        # describes what it does instead of reciting syntax.
        return "Code example in " + (_clean(block.get("language")) or "code") + " (describe, do not recite)"
    return ""


def topic_count(parsed_structure: object) -> int:
    """Number of topics available, falling back to a single implicit topic."""
    topics = _get_topics(parsed_structure)
    return max(1, len(topics))


def topic_name(parsed_structure: object, topic_index: int) -> str:
    """Topic name for display, tolerant of missing structure."""
    topics = _get_topics(parsed_structure)
    if topics and 0 <= topic_index < len(topics):
        return _clean(topics[topic_index].get("name")) or f"Topic {topic_index + 1}"
    if not topics and topic_index == 0:
        return "Full material"
    return f"Topic {topic_index + 1}"


def _match_topic_for_heading(heading_text: str, topics: list[dict]) -> int | None:
    """Which topic a heading block introduces, by name overlap.

    `SOW_PARSER` emits `content_blocks` in reading order and `topics`
    as a flat list, so the mapping between them is implicit. Headings
    are the natural boundary: a heading whose text matches a topic name
    starts that topic's section.
    """
    lowered = _clean(heading_text).lower()
    if not lowered:
        return None

    best_index: int | None = None
    best_score = 0
    for index, topic in enumerate(topics):
        candidates = [_clean(topic.get("name"))]
        for sub in topic.get("subtopics") or []:
            if isinstance(sub, str):
                candidates.append(_clean(sub))

        score = 0
        for candidate in candidates:
            if not candidate:
                continue
            if candidate.lower() == lowered:
                score += 100
            elif candidate.lower() in lowered or lowered in candidate.lower():
                score += 10
        if score > best_score:
            best_score = score
            best_index = index
    return best_index


def _assign_blocks_to_topics(blocks: list[dict], topics: list[dict]) -> list[list[dict]]:
    """Split ordered blocks into per-topic sections.

    Blocks are walked in reading order. A heading that matches a topic
    name starts a new section; everything else continues the current
    one. If no heading matches any topic (a flat document), blocks are
    distributed evenly so every topic still gets material.
    """
    count = max(1, len(topics))
    buckets: list[list[dict]] = [[] for _ in range(count)]

    current = 0
    matched_any = False
    for block in blocks:
        if _clean(block.get("type")).lower() == "heading":
            index = _match_topic_for_heading(block.get("text") or "", topics)
            if index is not None:
                current = index
                matched_any = True
        buckets[current].append(block)

    if not matched_any:
        # Flat document: split the blocks across topics in order.
        per_remainder = len(blocks) / count
        buckets = [[] for _ in range(count)]
        for position, block in enumerate(blocks):
            target = min(count - 1, int(position // per_remainder)) if per_remainder else 0
            buckets[target].append(block)

    return buckets


def build_episode_source(
    parsed_structure: object,
    topic_index: int,
    episode_index: int = 0,
    total_episodes: int = 1,
) -> str:
    """Source material for one *episode* of a topic.

    A long topic is delivered as several episodes rather than one file,
    so its blocks are split into contiguous, in-order slices — episode 1
    gets the first blocks, episode 2 the next, and so on. Without this
    every episode of a multi-episode topic would narrate the same text.
    """
    blocks = _get_blocks(parsed_structure)
    if not blocks:
        return ""

    topics = _get_topics(parsed_structure)
    if not topics:
        mine = blocks
    else:
        if not (0 <= topic_index < len(topics)):
            return ""
        mine = _assign_blocks_to_topics(blocks, topics)[topic_index]

    if not mine:
        return ""

    total_episodes = max(1, int(total_episodes))
    if total_episodes <= 1:
        return "\n\n".join(
            piece for piece in (_render_block(b) for b in mine) if piece
        )

    slice_blocks = _slice_blocks(mine, episode_index, total_episodes)
    return "\n\n".join(
        piece for piece in (_render_block(b) for b in slice_blocks) if piece
    )


def _slice_blocks(blocks: list[dict], episode_index: int, total_episodes: int) -> list[dict]:
    """Split a topic's blocks into `total_episodes` ordered slices."""
    count = len(blocks)
    if count == 0:
        return []

    if count <= total_episodes:
        # Fewer blocks than episodes: one block per episode, and the
        # final episode absorbs any surplus so nothing is dropped.
        if episode_index < count - 1:
            return [blocks[episode_index]]
        if episode_index == count - 1:
            return blocks[episode_index:]
        return []

    per_episode = count / total_episodes
    start = int(episode_index * per_episode)
    end = int((episode_index + 1) * per_episode)
    if episode_index == total_episodes - 1:
        end = count
    return blocks[start:max(end, start + 1)]


def topic_episode_plan(parsed_structure: object, topic_index: int) -> dict:
    """How many episodes a topic needs, capped by the content it has.

    The character count drives the split (5-10 minute episodes), but a
    topic with very few blocks must not be split into more episodes than
    there is content for — otherwise an episode lands with nothing to
    narrate and fails after being charged.
    """
    source = build_topic_source(parsed_structure, topic_index)
    blocks = _get_blocks(parsed_structure)
    topics = _get_topics(parsed_structure)

    if blocks and topics and 0 <= topic_index < len(topics):
        mine = _assign_blocks_to_topics(blocks, topics)[topic_index]
        block_count = len(mine)
    elif blocks:
        block_count = len(blocks)
    else:
        block_count = 0

    by_chars = episodes_for_topic(len(source))
    episodes = max(1, min(by_chars, block_count)) if block_count else by_chars

    return {
        "topic_index": topic_index,
        "topic_name": topic_name(parsed_structure, topic_index),
        "char_count": len(source),
        "block_count": block_count,
        "episodes": max(1, episodes),
    }


def build_topic_source(parsed_structure: object, topic_index: int) -> str:
    """Total source material for a topic, across all of its episodes."""
    return build_episode_source(parsed_structure, topic_index, 0, 1)


def build_narration_prompt(
    *,
    material_title: str,
    parsed_structure: object,
    topic_index: int,
    level: str | None = None,
    episode_index: int = 0,
    total_episodes: int = 1,
    target_words: int | None = None,
) -> tuple[str, str, int]:
    """Build the narration prompt for one episode.

    Returns (prompt, resolved_level, estimated_source_chars).
    """
    level = normalise_level(level)

    source = build_episode_source(
        parsed_structure, topic_index, episode_index, total_episodes
    )
    total = topic_count(parsed_structure)
    topics = _get_topics(parsed_structure)

    subtopics = ""
    if topics and 0 <= topic_index < len(topics):
        subs = topics[topic_index].get("subtopics") or []
        if isinstance(subs, list):
            subtopics = ", ".join(
                _clean(s) for s in subs if isinstance(s, str) and _clean(s)
            )

    if target_words is None:
        # Aim for a 5-10 minute episode, ~150 words per minute.
        target_words = 900
    prompt = STUDY_NARRATION_SCRIPT.format(
        material_title=material_title or "Study material",
        topic_index=topic_index + 1,
        topic_total=total,
        topic_name=topic_name(parsed_structure, topic_index),
        subtopics=subtopics or "—",
        education_level=level,
        level_guidance=NARRATION_LEVEL_GUIDANCE.get(level, ""),
        blocks_text=source or "(no structured content available)",
        target_words=target_words,
        episode_number=episode_index + 1,
        episode_count=max(1, total_episodes),
    )
    return prompt, level, len(source)


async def generate_episode_script(
    *,
    material_title: str,
    parsed_structure: object,
    topic_index: int,
    level: str | None = None,
    episode_index: int = 0,
    total_episodes: int = 1,
    max_chars: int | None = None,
) -> tuple[str, str, int]:
    """Generate the spoken script for one episode of a topic.

    Returns (script, level, char_count). Raises on failure so the caller
    can mark the batch failed and refund — no silent fallback to raw
    material.
    """
    from app.ai.router import route_ai

    level = normalise_level(level)
    target_words = 900
    if max_chars is None:
        max_chars = settings.audio_episode_max_chars

    prompt, level, source_chars = build_narration_prompt(
        material_title=material_title,
        parsed_structure=parsed_structure,
        topic_index=topic_index,
        level=level,
        episode_index=episode_index,
        total_episodes=total_episodes,
        target_words=target_words,
    )

    # A single topic that runs long becomes several episodes, so each
    # call produces roughly one episode's worth of narration.
    episodes = split_into_episodes(min(source_chars, max_chars))
    if episodes <= 1 and source_chars > settings.audio_episode_target_chars:
        episodes = 2

    result = await route_ai(
        prompt,
        task_type="heavy",
        max_tokens=4000,
    )
    script = _clean(result.get("response") or "")
    if not script:
        raise RuntimeError("Narration model returned an empty script")

    return script, level, len(script)


def episodes_for_topic(source_chars: int) -> int:
    """Episode count a topic of this length needs."""
    if source_chars <= 0:
        return 0
    return split_into_episodes(source_chars)


def default_level() -> str:
    """Level used when the client does not ask for one."""
    return DEFAULT_LEVEL


# ── Legacy raw-text TTS path ───────────────────────────────────────
# The episode flow above is the real product: it narrates, prices, and
# records. `POST /study/tts` still exists for the older direct-TTS
# callers, and this shim keeps them working by truncating whatever text
# they send. It is NOT a narration and should not be extended — migrate
# callers to the episode endpoints instead.


def build_narration(payload: dict, limit: int = 4000) -> str:
    """Resolve text for the legacy TTS endpoint, shaped then capped.

    Prefer `parsed_structure` when a caller sends it, otherwise fall
    back to the raw `text` field. Caps at `limit` characters.
    """
    structured = shape_legacy_source(payload.get("parsed_structure"))
    source = structured or " ".join(str(payload.get("text") or "").split())
    return source[:limit] if len(source) > limit else source


def shape_legacy_source(parsed_structure: object) -> str:
    """Flatten a parsed structure into plain text (no narration)."""
    blocks = _get_blocks(parsed_structure)
    if not blocks:
        return ""
    pieces: list[str] = []
    for block in blocks:
        text = _render_block(block)
        if text:
            pieces.append(text)
    return "\n\n".join(pieces)


def episode_char_cap() -> int:
    """Server-side character ceiling for one episode's narration."""
    return settings.audio_narration_max_chars


def episode_target_chars() -> int:
    """Character target used when splitting long topics into episodes."""
    return settings.audio_episode_target_chars


def episode_max_chars() -> int:
    """Hard character ceiling for a single episode's source material."""
    return settings.audio_episode_max_chars
