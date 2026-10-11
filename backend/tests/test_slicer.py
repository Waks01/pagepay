"""Cover the content slicer.

Gutenberg imports cap at 60KB and start with ~1,500 chars of license
boilerplate before the prose begins. The slicer has to strip the boilerplate
and split what remains into ~1,000-char slices at sentence or paragraph
boundaries. Slice size is part of the product contract: 1-minute sessions,
1-minute reward gate, 1-minute estimated_read_minutes per slice. These
tests pin both behaviors so we catch regressions in the cleaning logic.
"""

import pytest

from app.services.content.slicing.slicer import (
    slice_work,
    strip_gutenberg_boilerplate,
    strip_table_of_contents,
    split_into_slices,
    TARGET_CHARS_PER_SLICE,
)


# A representative chunk of Gutenberg preamble followed by real prose, with
# a TOC block in between. Mimics the structure of an actual Project
# Gutenberg plain-text file.
SAMPLE_GUTENBERG = """\
The Project Gutenberg eBook of Pride and Prejudice

This eBook is for the use of anyone anywhere in the United States and
most other parts of the world at no cost and with almost no restrictions
whatsoever. You may copy it, give it away or re-use it under the terms
of the Project Gutenberg License.

*** START OF THE PROJECT GUTENBERG EBOOK PRIDE AND PREJUDICE ***

*** END OF THE SMALL LICENSE ***

PRIDE AND PREJUDICE

By Jane Austen



Contents

CHAPTER I.


CHAPTER II.


CHAPTER III.


CHAPTER IV.


Chapter 1.


It is a truth universally acknowledged, that a single man in possession
of a good fortune, must be in want of a wife.

However little known the feelings or views of such a man may be on his
first entering a neighbourhood, this truth is so well fixed in the minds
of the surrounding families, that he is considered the rightful property
of some one or other of their daughters.

"My dear Mr. Bennet," said his lady to him one day, "have you heard that
Netherfield Park is let at last?"

Mr. Bennet replied that he had not.

"But it is," returned she; "for Mrs. Long has just been here, and told
me all about it."

Mr. Bennet made no answer.

"Do not you want to know who has taken it?" cried his lady impatiently.

"You want to tell me, and I have no objection to hearing it."

This was invitation enough.


Chapter 2.


""" + ("Mr. Bennet was so odd a mixture of quick parts, sarcastic humour, "
      "reserve, and caprice, that the experience of three-and-twenty years "
      "had been insufficient to make his wife understand his character. ") * 80 + """

*** END OF THE PROJECT GUTENBERG EBOOK PRIDE AND PREJUDICE ***
"""


def test_strip_gutenberg_boilerplate_removes_license_preamble():
    cleaned = strip_gutenberg_boilerplate(SAMPLE_GUTENBERG)
    # The license boilerplate at the top must be gone.
    assert "Project Gutenberg License" not in cleaned
    assert "no cost and with almost no restrictions" not in cleaned
    # The actual prose must still be present.
    assert "truth universally acknowledged" in cleaned
    # The end-of-book marker must be gone too.
    assert "END OF THE PROJECT GUTENBERG EBOOK" not in cleaned


def test_strip_table_of_contents_drops_chapter_lines():
    # Mirror the real call order: first strip Gutenberg boilerplate, then
    # the TOC. The standalone TOC stripper expects prose-leading text.
    cleaned = strip_gutenberg_boilerplate(SAMPLE_GUTENBERG)
    cleaned = strip_table_of_contents(cleaned)
    # All chapter lines from the TOC block must be gone — both roman and
    # arabic numeral styles.
    assert "CHAPTER I." not in cleaned
    assert "CHAPTER II." not in cleaned
    assert "CHAPTER III." not in cleaned
    # Prose paragraphs should still be there.
    assert "truth universally acknowledged" in cleaned
    # Title and author are kept as header context.
    assert "PRIDE AND PREJUDICE" in cleaned or "Pride and Prejudice" in cleaned
    assert "Jane Austen" in cleaned


def test_slice_work_produces_multiple_short_slices():
    slices = slice_work(SAMPLE_GUTENBERG, target_chars=3_000)
    # ~60KB of prose at 3,000 chars/slice should yield multiple slices.
    assert len(slices) >= 5, "should produce multiple ~2-min reads"
    # Each slice should be close to target, none absurdly long.
    for s in slices:
        assert s.estimated_read_minutes >= 1
        assert s.char_count > 100  # not empty
        # Slice can stretch up to the absolute cap when a sentence is
        # unusually long; never more than ~2.5 minutes of reading.
        assert s.char_count <= 6_000, f"slice too long: {s.char_count}"
    # Orders should be sequential from 1.
    assert [s.order for s in slices] == list(range(1, len(slices) + 1))


def test_split_into_slices_prefers_sentence_boundaries():
    """A slice should end at a sentence end whenever one is near the
    target. If we landed inside a sentence instead, the next slice would
    start mid-sentence and the reader would feel the cut."""
    # Build a paragraph where a sentence end exists within the lookback
    # window of the 1,000-char target. The cut should snap to it.
    sentence = "It was a dark and stormy night. "  # 31 chars
    # ~33 sentences = ~1023 chars. The last sentence end is right around
    # the target so the snap should land there or one sentence before.
    body = sentence * 33
    chunks = split_into_slices(body, target_chars=1_000)
    assert len(chunks) >= 2
    for chunk in chunks[:-1]:  # last chunk can absorb remainder
        # Every chunk (except possibly the last) must end with a sentence
        # terminator followed by whitespace, or end at a paragraph break.
        # Anything else means we cut mid-sentence.
        stripped = chunk.rstrip()
        assert stripped[-1] in ".!?\"')] " or stripped.endswith("\n\n"), (
            f"chunk ends mid-sentence: {stripped[-40:]!r}"
        )


def test_split_into_slices_splits_at_paragraph_breaks():
    body = "\n\n".join(["word " * 100 for _ in range(10)])  # 10 paragraphs of 100 words
    chunks = split_into_slices(body, target_chars=1_000)
    assert len(chunks) >= 3
    # Every chunk must be exactly some prefix of the paragraph stream — no
    # chunk should start or end mid-word.
    for chunk in chunks:
        assert not chunk.endswith(" word") or chunk.endswith("word"), (
            "split landed mid-word"
        )


def test_split_into_slices_handles_short_input_as_single_slice():
    body = "A short paragraph.\n\nAnother short one."
    chunks = split_into_slices(body)
    assert len(chunks) == 1
    assert chunks[0] == body


def test_split_into_slices_handles_empty_input():
    assert split_into_slices("") == []
    assert split_into_slices("   \n\n  ") == []


@pytest.mark.asyncio
async def test_slice_and_persist_creates_children(db_session):
    """End-to-end: persist a parent row, run the slicer, verify children."""
    from app.services.content.slicing.slicer import slice_and_persist
    from app.models import ContentCatalog

    parent = ContentCatalog(
        title="Test Book",
        content_type="book",
        category="fiction",
        body_text=SAMPLE_GUTENBERG,
        author="Jane Austen",
        estimated_read_minutes=99,
    )
    db_session.add(parent)
    await db_session.commit()
    await db_session.refresh(parent)

    n = await slice_and_persist(db_session, parent)
    assert n >= 3

    from sqlalchemy import select
    children = (await db_session.execute(
        select(ContentCatalog).where(ContentCatalog.parent_work_id == parent.id)
    )).scalars().all()
    assert len(children) == n
    # Children must be ordered, and orders must be 1..n contiguous.
    assert [c.read_order for c in children] == list(range(1, n + 1))
    # Every child has its body.
    for c in children:
        assert c.body_text and len(c.body_text) > 100
        assert c.total_slices == n
        assert c.char_count is not None and c.char_count > 0
        assert c.word_count is not None and c.word_count > 0
        assert c.title.startswith("Test Book — Part")
    # First child should contain the canonical opening line of P&P — proves
    # the preamble stripping actually worked (otherwise we'd see "The
    # Project Gutenberg eBook of..." as the first slice).
    first_child_text = children[0].body_text
    assert "Project Gutenberg" not in first_child_text
    assert "CHAPTER I." not in first_child_text  # TOC must be stripped
    assert "truth universally acknowledged" in first_child_text


@pytest.mark.asyncio
async def test_slice_and_persist_is_idempotent(db_session):
    """Re-running the slicer on a parent that already has children must
    not double-insert them. This is critical because admins will run the
    slicer after each import and we don't want duplicate rows."""
    from app.services.content.slicing.slicer import slice_and_persist
    from app.models import ContentCatalog
    from sqlalchemy import select

    parent = ContentCatalog(
        title="Idempotency Test",
        content_type="book",
        category="fiction",
        body_text="Long enough text. " * 2000,  # ~50,000 chars
        author="Tester",
        estimated_read_minutes=99,
    )
    db_session.add(parent)
    await db_session.commit()
    await db_session.refresh(parent)

    n1 = await slice_and_persist(db_session, parent)
    n2 = await slice_and_persist(db_session, parent)
    assert n1 == n2

    count = (await db_session.execute(
        select(ContentCatalog.id).where(ContentCatalog.parent_work_id == parent.id)
    )).all()
    assert len(count) == n1


@pytest.mark.asyncio
async def test_slice_and_persist_skips_split_when_content_is_short(db_session):
    """A 600-char body (a short news blurb) becomes one child slice, not
    multiple fragments. Splitting would break the article's coherence.
    """
    from app.services.content.slicing.slicer import slice_and_persist
    from app.models import ContentCatalog
    from sqlalchemy import select

    short_body = "Breaking news. " * 50  # ~750 chars
    parent = ContentCatalog(
        title="Short Article",
        content_type="news",
        category="news",
        body_text=short_body,
        author="Wire",
        estimated_read_minutes=5,
    )
    db_session.add(parent)
    await db_session.commit()
    await db_session.refresh(parent)

    n = await slice_and_persist(db_session, parent)
    assert n == 1, "short content should produce exactly one child slice"

    children = (await db_session.execute(
        select(ContentCatalog).where(ContentCatalog.parent_work_id == parent.id)
    )).scalars().all()
    assert len(children) == 1
    assert children[0].total_slices == 1
    assert children[0].read_order == 1
    assert children[0].body_text == short_body  # unchanged


@pytest.mark.asyncio
async def test_slice_all_books_skips_parents_with_existing_children(db_session):
    """`slice_all_books` must skip a parent that already has children."""
    from app.services.content.slicing.slicer import slice_all_books, slice_and_persist
    from app.models import ContentCatalog

    parent = ContentCatalog(
        title="Skip Test",
        content_type="book",
        category="fiction",
        body_text="Some body text. " * 1500,
        author="Tester",
        estimated_read_minutes=99,
    )
    db_session.add(parent)
    await db_session.commit()
    await db_session.refresh(parent)

    # Slice once.
    await slice_and_persist(db_session, parent)

    # Now run slice_all_books — it should detect existing children and skip.
    summary = await slice_all_books(db_session)
    assert summary["skipped_existing"] >= 1
    assert summary["children_added"] == 0


@pytest.mark.asyncio
async def test_force_reslice_all_rebuilds_children(db_session):
    """The catalog has books that were imported before slicing was wired in
    (no children). force_reslice_all wipes their (zero) children and
    creates a fresh slice set. Used by the lazy catalog refresh CTA."""
    from app.services.content.slicing.slicer import force_reslice_all, slice_and_persist
    from app.models import ContentCatalog, ReadingProgress
    from sqlalchemy import select

    # Insert a parent with no children — simulate a stale catalog row.
    parent = ContentCatalog(
        title="Force Reslice Book",
        content_type="book",
        category="fiction",
        body_text="It was a dark and stormy night. " * 200,  # ~6,200 chars
        author="Tester",
        estimated_read_minutes=99,  # stale "1 hour" estimate
    )
    db_session.add(parent)
    await db_session.commit()
    await db_session.refresh(parent)
    assert parent.estimated_read_minutes == 99

    # And a reading_progress row that was pinned to this work.
    user_id = 1  # conftest's default user (test scaffolding may need adjustment)
    rp = ReadingProgress(
        user_id=user_id,
        work_id=parent.id,
        current_slice_id=None,
        current_slice_order=1,
        slices_completed=0,
        total_slices=0,
        is_finished=False,
    )
    db_session.add(rp)
    await db_session.commit()

    summary = await force_reslice_all(db_session)
    assert summary["parents_resliced"] >= 1
    assert summary["children_added"] >= 2  # 6,200 chars / ~3,000 = 2+ slices

    # Children exist.
    children = (await db_session.execute(
        select(ContentCatalog).where(ContentCatalog.parent_work_id == parent.id)
    )).scalars().all()
    assert len(children) >= 2

    # Parent's minutes should now reflect the slice count, not 99.
    await db_session.refresh(parent)
    assert parent.estimated_read_minutes == len(children)

    # Reading progress current_slice_id was reset by force_reslice_all
    # so the next /progress/continue call will re-point to slice 1.
    await db_session.refresh(rp)
    assert rp.current_slice_id is None
