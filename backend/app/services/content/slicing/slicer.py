"""Slice long-form content into ~2-minute reads.

Background
----------
A user opens the app to read for a few minutes and earn a little. They will
not open a 45-minute book. So books and long articles are pre-split into
short reads at import time. Each slice is its own row in `content_catalog`
with a `parent_work_id` linking back to the original source row.

Why 2 minutes (not 1, not 5)
----------------------------
- 1 minute is below the floor of meaningful reading — too short to feel like
  "I read something" and too short to host a banner ad cluster with dignity.
- 5 minutes crosses the threshold where the user feels committed. We want
  them to feel "I have a minute, I'll do one more."
- 2 minutes is the sweet spot: ~400 words, ~2,000 chars, ~5 short paragraphs.
  It fits a small phone screen with a bottom banner without dominating it.

How the slicing works
---------------------
1. Strip Project Gutenberg licensing boilerplate (the *START OF*/END OF
   markers). Their bodies are mostly legalese we don't want to bill users
   for reading.
2. Strip the Table of Contents block. Gutenberg TOCs are a hundred lines of
   "CHAPTER I." with no prose. They look like text but read like noise.
3. Split into ~2,000-char windows, snapping to the nearest paragraph break
   so we don't end a slice mid-sentence. The last slice absorbs the
   remainder (smaller is fine; it still pays).
4. Emit one row per slice with `parent_work_id`, `read_order`, and
   `total_slices` set.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, update
from app.models import ContentCatalog

# Slice size. Each slice is **3,000 characters** and is labeled as a
# **1-minute** read in the UI. Slice size and minute label are part of the
# product contract — readers see each slice as a 1-minute session, the
# reward gate fires at slice end, and the catalog UI uses the same label.
# Do not change either without revisiting the reader state machine and
# the per-slice point formula.
TARGET_CHARS_PER_SLICE = 3_000

# Below this length, we don't split at all — a short body is already one
# 1-minute slice. Imports with body_text under this threshold become a
# single slice.
NO_SLICE_THRESHOLD_CHARS = 3_600

# Tolerance: a slice can be up to 30% over target before we cut, to avoid
# leaving tiny trailing slices when no boundary falls near the target.
MAX_CHARS_PER_SLICE = int(TARGET_CHARS_PER_SLICE * 1.30)

# Hard cap. Protects the TEXT column from unbounded growth. If a
# paragraph is longer than this, we hard-cut inside it because boundary
# snapping could not find a break.
ABSOLUTE_MAX_CHARS = 6_000


@dataclass
class Slice:
    order: int  # 1-indexed position within the work
    body_text: str  # the actual prose (no boilerplate)
    char_count: int
    word_count: int
    estimated_read_minutes: int  # always 2 (or 1 for a final trailing slice)


_GUTENBERG_START_MARKERS = (
    re.compile(r"\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG", re.IGNORECASE),
    re.compile(r"\*\*\*\s*START OF THE EBOOK", re.IGNORECASE),
    re.compile(r"\*\*\*START\*\*\*", re.IGNORECASE),
)

_GUTENBERG_END_MARKERS = (
    re.compile(r"\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG", re.IGNORECASE),
    re.compile(r"\*\*\*\s*END OF THE EBOOK", re.IGNORECASE),
    re.compile(r"\*\*\*END\*\*\*", re.IGNORECASE),
)

# A TOC line is one of:
#   "CHAPTER I."
#   "Chapter 12. The Title"
#   "CHAP. III. The Title"
# We use a separate detector rather than a regex so we don't over-eagerly
# strip chapter lines from inside the actual prose.
_TOC_LINE = re.compile(
    r"^\s*(chapter|chap\.?|section|part)\s+"
    r"(?:\d+|[IVXLCDM]+)\s*\.?\s*[^a-z]{0,80}$",  # title line, mostly uppercase or short
    re.IGNORECASE,
)


def strip_gutenberg_boilerplate(text: str) -> str:
    """Remove Project Gutenberg license preamble and postamble.

    The *START OF* marker is followed by the license block, then the actual
    book. We drop everything from the top of the file through the first
    prose-like content after the marker.

    The *END OF* marker is followed by nothing useful for a reader. We
    truncate from there to the end.
    """
    if not text:
        return ""

    # Find the END marker first — it's a hard cutoff at the bottom.
    end_match = None
    for pattern in _GUTENBERG_END_MARKERS:
        m = pattern.search(text)
        if m:
            end_match = m
            break
    if end_match:
        text = text[: end_match.start()]

    # Find the START marker — keep everything after it, but skip the next
    # ~1,500 chars of license boilerplate that immediately follows.
    start_match = None
    for pattern in _GUTENBERG_START_MARKERS:
        m = pattern.search(text)
        if m:
            start_match = m
            break
    if start_match:
        # The license block after the marker is typically ~1,000-1,500 chars
        # of "*** START OF THE PROJECT GUTENBERG EBOOK ... [LICENSE TEXT]
        # *** END OF THE ..." preamble. We jump past it by looking for the
        # first double newline after the marker, then drop any heading-only
        # lines until we hit real prose.
        after_marker = text[start_match.end():]
        # Skip the "*** END OF ..." license footer line if it's right after
        # the start marker.
        end_of_license = re.search(
            r"\*\*\*\s*END OF (THE|THIS)?\s*(SMALL )?LICENSE", after_marker, re.IGNORECASE
        )
        if end_of_license:
            after_marker = after_marker[end_of_license.end():]
        # The START marker line often continues with " EBOOK TITLE ***" on
        # the same line and then a stray "***" line. Strip the trailing
        # "***" (and any junk before it on the same line) and any leading
        # blank-or-asterisk-only lines so the body starts cleanly with the
        # actual title.
        after_marker = re.sub(r"\s*\*+\s*$", "", after_marker, flags=re.MULTILINE)
        after_marker = re.sub(r"^[\s\*]+", "", after_marker, count=1)
        text = after_marker.lstrip("\n")

    return text.strip()


def strip_table_of_contents(text: str) -> str:
    """Drop leading TOC and front-matter blocks from a Gutenberg book.

    Gutenberg books have several layers of non-prose before the actual text:
      1. Title / author byline (we keep this — useful context)
      2. "CONTENTS" header + list of chapter titles (we drop this)
      3. Sometimes an "ETYMOLOGY" or "EXTRACTS" one-word heading between
         the chapter list and the start of prose (we drop this)
      4. The first real paragraph of prose (we keep this)

    Detection strategy: scan forward from the top of the text until we find
    a real prose paragraph (≥80 chars, lowercase letters, sentence
    punctuation). The slice of text from the start up to that paragraph is
    the front matter we want to drop. The first ~5 lines (title, author
    byline) are kept as a useful header.
    """
    if not text:
        return ""

    lines = text.split("\n")

    # Find the first real prose paragraph anywhere in the document.
    prose_start_idx = None
    for idx, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            continue
        # Skip Gutenberg metadata and chapter-shaped lines.
        if (
            stripped.startswith(("EBOOK", "Etext", "***", "Title:", "Author:", "Release", "Language:"))
            or _TOC_LINE.match(stripped)
        ):
            continue
        # Skip title-like lines (mostly uppercase).
        upper_count = sum(1 for c in stripped if c.isupper())
        lower_count = sum(1 for c in stripped if c.islower())
        if upper_count > lower_count:
            continue
        # Prose: ≥30 chars AND ≥2 distinct lowercase words of ≥4 chars
        # each AND a period, comma, or semicolon. Requiring 2+ lowercase
        # words rules out parenthetical headings like
        # "(Supplied by a Sub-Sub-Librarian)." where "by" and "a" are too
        # short to count and "Sub-Sub-Librarian" is hyphenated.
        words = re.findall(r"[a-z]{4,}", stripped)
        if (
            len(stripped) >= 30
            and len(words) >= 2
            and re.search(r"[.,;]", stripped)
        ):
            prose_start_idx = idx
            break
    if prose_start_idx is None:
        return text  # no prose found; bail

    # We want to keep the first few lines (title, author) as header context,
    # then drop everything from there to the prose paragraph. The header is
    # typically the first 4-6 lines.
    header_end = min(8, prose_start_idx)
    # Walk header_end back over blank lines so the output doesn't start
    # with a stack of empty lines.
    while header_end > 0 and not lines[header_end - 1].strip():
        header_end -= 1

    kept = lines[:header_end] + lines[prose_start_idx:]
    return "\n".join(kept).strip()


def _snap_to_boundary(text: str, target: int, lookback: int = 250, lookhead: int = 250) -> int:
    """Return a cut index near `target` that lands on a sentence or paragraph end.

    Snap priority, used in order:
      1. Sentence end within [target - lookback, target]. We accept any of
         `. `, `! `, `? `, `.\\n`, `!\\n`, `?\\n`, `.\\"`, `!\\"`, `?\\"`.
         A cut inside a sentence is the worst reader experience — it leaves
         the next slice starting mid-sentence and the previous slice ending
         mid-clause. We will hard-cut rather than let that happen.
      2. Paragraph break (`\\n\\n`) within the same window.
      3. Forward search for the nearest sentence or paragraph end past
         `target` (within `lookhead`). Useful when target lands at the very
         start of a long paragraph.
      4. Hard cut at `target` itself. Only reached for prose with no
         punctuation at all (rare; usually poetry or tables that shouldn't
         be sliced in the first place).

    Returns the index in `text` where the slice should END (exclusive).
    The caller already knows the slice STARTS at `cursor`; this function
    picks the END.
    """
    if target >= len(text):
        return len(text)

    # 1. Sentence-end backwards. We use a positive lookbehind-equivalent
    #    by scanning for the punctuation and validating the boundary.
    best_sentence = -1
    scan_start = max(0, target - lookback)
    for m in re.finditer(r"[.!?](?:[\"')\]]?)(?:\s|$)", text[scan_start:target]):
        # `end()` is one past the punctuation (or punctuation+quote). The
        # slice ends here — inclusive of the trailing whitespace so the
        # next slice doesn't start with a leading space.
        abs_end = scan_start + m.end()
        if abs_end >= target:
            break
        best_sentence = abs_end

    best_paragraph = -1
    cut = text.rfind("\n\n", scan_start, target)
    if cut != -1:
        best_paragraph = cut + 2  # include the blank line in the next slice

    # Prefer sentence end over paragraph end when both are available.
    if best_sentence != -1:
        return best_sentence
    if best_paragraph != -1:
        return best_paragraph

    # 3. Forward search — push the cut slightly past `target` rather than
    #    cutting mid-sentence. Same priority order: sentence first, then
    #    paragraph.
    forward_end = min(len(text), target + lookhead)
    m = re.search(r"[.!?](?:[\"')\]]?)(?:\s|$)", text[target:forward_end])
    if m:
        return target + m.end()
    fwd_para = text.find("\n\n", target, forward_end)
    if fwd_para != -1:
        return fwd_para + 2

    # 4. Hard cut. Caller will still respect MAX_CHARS_PER_SLICE.
    return target


def split_into_slices(text: str, target_chars: int = TARGET_CHARS_PER_SLICE) -> list[str]:
    """Split prose into ~target_chars chunks at sentence or paragraph ends.

    Boundary preference order (see _snap_to_boundary): sentence end → paragraph
    break → forward search → hard cut. The hard cap is MAX_CHARS_PER_SLICE
    (~30% over target, ~1.5 min). Anything beyond ABSOLUTE_MAX_CHARS is
    forcibly cut even if it falls mid-sentence — protects the TEXT column
    and bounds a single slice to ~2 minutes of reading at the absolute
    worst case.
    """
    text = text.strip()
    if not text:
        return []

    # Quick path: short content fits in one slice.
    if len(text) <= target_chars:
        return [text]

    slices: list[str] = []
    cursor = 0
    while cursor < len(text):
        remaining = len(text) - cursor
        # Take the remainder as-is only if it's at-or-below target. Bigger
        # than that and we'd oversell reading time on a single slice.
        if remaining <= target_chars:
            slices.append(text[cursor:].strip())
            break

        target_cut = cursor + target_chars
        cut = _snap_to_boundary(text, target_cut)
        # If snap pushed past the soft cap, prefer the soft cap to the
        # sentence we overshot to — except when the only path was already
        # at the soft cap (don't infinite-loop or pin to the same cut).
        if cut - cursor > MAX_CHARS_PER_SLICE:
            # First try a tighter snap closer to target.
            tighter = cursor + min(target_chars, MAX_CHARS_PER_SLICE)
            cut_t = _snap_to_boundary(text, tighter, lookback=120, lookhead=60)
            if cut_t <= MAX_CHARS_PER_SLICE and cut_t > cursor:
                cut = cut_t
            else:
                cut = cursor + MAX_CHARS_PER_SLICE
        # Absolute ceiling — protects the TEXT column from unbounded growth. If we still
        # overshot (pathologically long sentence-less paragraph), force.
        if cut - cursor > ABSOLUTE_MAX_CHARS:
            cut = cursor + ABSOLUTE_MAX_CHARS

        slice_text = text[cursor:cut].strip()
        if slice_text:
            slices.append(slice_text)
        cursor = cut

    return slices


def slice_work(
    raw_text: str,
    target_chars: int = TARGET_CHARS_PER_SLICE,
) -> list[Slice]:
    """End-to-end: raw Gutenberg text → list of Slice dataclasses."""
    cleaned = strip_gutenberg_boilerplate(raw_text)
    cleaned = strip_table_of_contents(cleaned)
    cleaned = cleaned.strip()
    if not cleaned:
        return []

    chunks = split_into_slices(cleaned, target_chars=target_chars)
    total = len(chunks)
    out: list[Slice] = []
    for idx, chunk in enumerate(chunks, start=1):
        words = len(chunk.split())
        # Each slice is labeled "1 minute" in the UI — see the contract
        # note above TARGET_CHARS_PER_SLICE. The parent work's total
        # minutes is `len(children)`, summing to the book's read time.
        minutes = 1
        out.append(
            Slice(
                order=idx,
                body_text=chunk,
                char_count=len(chunk),
                word_count=words,
                estimated_read_minutes=minutes,
            )
        )
    return out


async def slice_and_persist(
    db: AsyncSession,
    parent: ContentCatalog,
    target_chars: int = TARGET_CHARS_PER_SLICE,
) -> int:
    """Slice one parent work into N children, persist, return child count.

    Idempotent: if children already exist for this parent, returns the
    existing count without re-slicing. Safe to call repeatedly.

    Skip rules:
      - Body text under NO_SLICE_THRESHOLD_CHARS (~1 min read): kept as a
        single child slice rather than split. Splitting a 500-char news
        blurb into two 250-char fragments is useless.
      - Body text missing or empty: returns 0 (no children).

    The parent's own body_text is left intact (it's still useful for
    search/catalog lookup by the full work). Children carry the actual
    reading material for users.
    """
    # Idempotency: skip if children already exist.
    existing = await db.execute(
        select(ContentCatalog.id).where(ContentCatalog.parent_work_id == parent.id).limit(1)
    )
    if existing.scalar_one_or_none() is not None:
        # Count total children.
        count_row = await db.execute(
            select(ContentCatalog.id).where(ContentCatalog.parent_work_id == parent.id)
        )
        return len(count_row.scalars().all())

    if not parent.body_text:
        return 0

    raw_len = len(parent.body_text)

    # Short content: don't split. Emit a single child slice that's the
    # whole work, so the reader flow treats it the same as a sliced piece.
    if raw_len <= NO_SLICE_THRESHOLD_CHARS:
        words = len(parent.body_text.split())
        base_title = parent.title.split(";")[0].strip()
        db.add(
            ContentCatalog(
                title=f"{base_title} — Part 1 of 1",
                content_type=parent.content_type,
                category=parent.category,
                source_url=None,
                body_text=parent.body_text,
                author=parent.author,
                estimated_read_minutes=1,
                parent_work_id=parent.id,
                read_order=1,
                total_slices=1,
                word_count=words,
                char_count=raw_len,
            )
        )
        await db.execute(
            update(ContentCatalog)
            .where(ContentCatalog.id == parent.id)
            .values(
                estimated_read_minutes=1,
                word_count=None,
                char_count=None,
                read_order=None,
                total_slices=None,
            )
        )
        await db.commit()
        return 1

    slices = slice_work(parent.body_text, target_chars=target_chars)
    total = len(slices)
    if total == 0:
        return 0

    base_title = parent.title.split(";")[0].strip()  # drop "; Or, The Whale" style suffixes
    for s in slices:
        child_title = f"{base_title} — Part {s.order} of {total}"
        db.add(
            ContentCatalog(
                title=child_title,
                content_type=parent.content_type,  # inherit "book"
                category=parent.category,
                # Each child gets source_url=None (uniqueness constraint on
                # source_url is treated as an external reference, not a
                # download link, for children).
                source_url=None,
                body_text=s.body_text,
                author=parent.author,
                estimated_read_minutes=s.estimated_read_minutes,
                parent_work_id=parent.id,
                read_order=s.order,
                total_slices=total,
                word_count=s.word_count,
                char_count=s.char_count,
            )
        )

    # Demote the parent: keep its body for re-slicing if needed, but mark
    # its read-time as the total of all children so the catalog can still
    # show "X min total" on the parent row.
    await db.execute(
        update(ContentCatalog)
        .where(ContentCatalog.id == parent.id)
        .values(
            estimated_read_minutes=total,  # 1-min per slice, total slices
            word_count=None,
            char_count=None,
            read_order=None,
            total_slices=None,
        )
    )

    await db.commit()
    return total


async def slice_all_books(db: AsyncSession, target_chars: int = TARGET_CHARS_PER_SLICE) -> dict:
    """Slice every parent book in the catalog. Returns a summary dict.

    Skips rows that are already children (have parent_work_id set) and
    rows that already have children. Safe to re-run.
    """
    rows = await db.execute(
        select(ContentCatalog)
        .where(ContentCatalog.parent_work_id.is_(None))
        .where(ContentCatalog.content_type == "book")
        .where(ContentCatalog.body_text.is_not(None))
    )
    parents = rows.scalars().all()

    summary = {"parents": len(parents), "sliced": 0, "skipped_existing": 0, "children_added": 0}
    for parent in parents:
        # If this parent already has children, count it as skipped.
        existing = await db.execute(
            select(ContentCatalog.id).where(ContentCatalog.parent_work_id == parent.id).limit(1)
        )
        if existing.scalar_one_or_none() is not None:
            summary["skipped_existing"] += 1
            continue

        n = await slice_and_persist(db, parent, target_chars=target_chars)
        if n > 0:
            summary["sliced"] += 1
            summary["children_added"] += n
    return summary


async def force_reslice_all(
    db: AsyncSession,
    target_chars: int = TARGET_CHARS_PER_SLICE,
) -> dict:
    """Wipe every child slice and re-slice every parent from scratch.

    Use this when the catalog has books that were imported before slicing
    was wired in (so they're sitting as 1hr / 30min monoliths with
    `parent_work_id IS NULL` and no children) or when the slicer settings
    have changed (e.g. target size tuned from 1500 to 1000 chars).

    Returns a summary dict with parents scanned, parents re-sliced,
    and total children added. The user's `reading_progress` rows are
    pinned to `work_id` (the parent), not to specific child slice ids, so
    wiping children only invalidates `current_slice_id` pointers. The
    next `/progress/continue` will re-point to the first slice of each
    user's current work. Active `reading_session` rows are NOT touched.

    NOT used by the cron job — that runs `slice_all_books` which is
    idempotent. Reserved for the admin reslice endpoint and the client's
    lazy catalog refresh.
    """
    from app.models import ReadingProgress  # local import to avoid cycles

    # Pull every parent (those rows where parent_work_id IS NULL).
    parents_rows = await db.execute(
        select(ContentCatalog).where(ContentCatalog.parent_work_id.is_(None))
    )
    parents = parents_rows.scalars().all()

    summary = {
        "parents_scanned": len(parents),
        "parents_resliced": 0,
        "children_added": 0,
        "progress_rows_cleared": 0,
    }

    for parent in parents:
        if not parent.body_text:
            continue

        # Delete all existing children of this parent. We do this before
        # re-inserting to avoid the idempotency short-circuit in
        # slice_and_persist (which would skip if any children exist).
        deleted = await db.execute(
            delete(ContentCatalog).where(ContentCatalog.parent_work_id == parent.id)
        )
        # SQLAlchemy doesn't expose rowcount reliably across all backends;
        # roll the delete into the same transaction as the inserts below.

        # Refresh the parent instance so its in-memory attributes match the
        # row as it stands now (children deleted, parent still has its
        # original estimated_read_minutes — that's fine; slice_and_persist
        # overrides it on the parent when it finishes). NOTE: we do NOT
        # reset estimated_read_minutes because the column is NOT NULL.
        await db.refresh(parent)

        n = await slice_and_persist(db, parent, target_chars=target_chars)
        if n > 0:
            summary["parents_resliced"] += 1
            summary["children_added"] += n

        # Clear stale current_slice_id pointers for users who were mid-way
        # through THIS work. They'll resume from slice 1 the next time
        # they call /progress/continue, which is exactly what we want
        # — the slices themselves are freshly generated, so old ids are
        # meaningless.
        cleared = await db.execute(
            update(ReadingProgress)
            .where(ReadingProgress.work_id == parent.id)
            .where(ReadingProgress.is_finished == False)  # noqa: E712
            .values(current_slice_id=None)
        )
        if cleared.rowcount:
            summary["progress_rows_cleared"] += cleared.rowcount

    await db.commit()
    return summary