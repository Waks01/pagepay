"""Splitting a long document so it can be parsed in pieces.

The parser prompt asks for the *whole* document's structure and is
given a fixed output budget. For a long document those two cannot both
be true: a twenty-page syllabus does not fit in one response, and the
model that runs out of tokens mid-object produces JSON that cannot be
parsed. Retrying does not help, because the document does not fit.

So the document is split, each piece is parsed on its own with a
budget that fits it, and the pieces are joined back together. The join
is done in Python, not by another model call: the blocks are already
structured, and re-emitting them through a model would put them back
in the same budget problem that chunking was meant to solve.
"""

from __future__ import annotations

import re

# A chunk is closed once it passes this size, and a chunk is never
# allowed to exceed the hard maximum. The target is generous enough
# that a chunk's blocks fit comfortably in one response.
DEFAULT_TARGET_CHARS = 5000
DEFAULT_MAX_CHARS = 8000

# Paragraph breaks, then line breaks, then sentence ends. Splitting
# prefers the earliest of these so a chunk ends where the author
# intended a break to be.
_PARAGRAPH_SPLIT = re.compile(r"\n\s*\n")
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?:;])\s+")


def _split_long_paragraph(paragraph: str, max_chars: int) -> list[str]:
    """Break one oversized paragraph into sentence-aligned pieces."""
    sentences = _SENTENCE_SPLIT.split(paragraph)
    pieces: list[str] = []
    current = ""
    for sentence in sentences:
        if not sentence:
            continue
        if current and len(current) + len(sentence) + 1 > max_chars:
            pieces.append(current)
            current = sentence
        else:
            current = f"{current} {sentence}".strip() if current else sentence
    if current:
        pieces.append(current)
    return pieces or [paragraph]


def chunk_text(
    text: str,
    *,
    target_chars: int = DEFAULT_TARGET_CHARS,
    max_chars: int = DEFAULT_MAX_CHARS,
) -> list[str]:
    """Split a document into chunks that each fit one model response.

    The split is made at paragraph boundaries where possible, then at
    sentence boundaries inside an oversized paragraph. A table, a code
    listing or a figure note is a run of consecutive lines, so it
    stays whole unless it is on its own larger than the maximum.
    """
    if not text or not text.strip():
        return []

    paragraphs = [p for p in _PARAGRAPH_SPLIT.split(text) if p.strip()]

    chunks: list[str] = []
    current = ""
    for paragraph in paragraphs:
        if len(paragraph) > max_chars:
            if current:
                chunks.append(current)
                current = ""
            chunks.extend(_split_long_paragraph(paragraph, max_chars))
            continue

        candidate = f"{current}\n\n{paragraph}" if current else paragraph
        if len(candidate) <= max_chars:
            current = candidate
            # Close the chunk once it is big enough, so a document of
            # thirty short paragraphs does not become one chunk.
            if len(current) >= target_chars:
                chunks.append(current)
                current = ""
        else:
            if current:
                chunks.append(current)
            current = paragraph

    if current:
        chunks.append(current)

    return [c for c in chunks if c.strip()]


def _topic_key(name: str) -> str:
    """A comparable key for a topic name.

    Two chunks that talk about "Light Energy" and "light energy" are
    talking about the same thing.
    """
    return re.sub(r"[^a-z0-9]+", " ", (name or "").lower()).strip()


def merge_chunk_results(results: list[dict]) -> dict:
    """Join the parsed chunks back into one structure.

    The blocks are concatenated in chunk order — they were read in
    order, so they stay in order. The topics are merged by name: the
    same subject can appear in two chunks, and the student should see
    it once, with everything under it.
    """
    merged_topics: list[dict] = []
    by_key: dict[str, dict] = {}
    blocks: list[dict] = []
    titles: list[str] = []

    for result in results:
        if not isinstance(result, dict):
            continue

        title = (result.get("title") or "").strip()
        if title:
            titles.append(title)

        chunk_blocks = result.get("content_blocks")
        if isinstance(chunk_blocks, list):
            blocks.extend(b for b in chunk_blocks if isinstance(b, dict))

        chunk_topics = result.get("topics")
        if not isinstance(chunk_topics, list):
            continue
        for topic in chunk_topics:
            if not isinstance(topic, dict):
                continue
            name = (topic.get("name") or "").strip()
            if not name:
                continue
            key = _topic_key(name)
            existing = by_key.get(key)
            if existing is None:
                fresh = {
                    "name": name,
                    "subtopics": list(topic.get("subtopics") or []),
                    "key_concepts": list(topic.get("key_concepts") or []),
                }
                by_key[key] = fresh
                merged_topics.append(fresh)
                continue
            for field in ("subtopics", "key_concepts"):
                seen = {str(v).strip().lower() for v in existing[field]}
                for value in topic.get(field) or []:
                    marker = str(value).strip().lower()
                    if marker and marker not in seen:
                        existing[field].append(value)
                        seen.add(marker)

    # The title of the first chunk is the document's title: the first
    # chunk is the beginning of the document, and its title is the one
    # the author put at the top.
    title = titles[0] if titles else ""

    return {
        "title": title,
        "topics": merged_topics,
        "content_blocks": blocks,
    }


def needs_chunking(
    text: str,
    *,
    target_chars: int = DEFAULT_TARGET_CHARS,
) -> bool:
    """True when the document is too big to parse in one response."""
    return len(text or "") > target_chars
