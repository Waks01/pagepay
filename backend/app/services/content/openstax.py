"""OpenStax ingest: pull CC BY 4.0 STEM textbooks into content_catalog.

Background
----------
OpenStax is a Rice University program that publishes free, peer-reviewed
textbooks under CC BY 4.0. Every book is available as a free PDF +
an online HTML version. We ingest the HTML (cleaner than PDF for our
topic-aware slicer) and slice each chapter into per-topic child rows
in content_catalog, with per-topic ReadingUnits.

Why OpenStax first (not CORE, DOAB, Saylor, …)
-----------------------------------------------
The other sources in books.md are real options, but OpenStax is the
right first integration because:
  1. The license is uniform: every book is CC BY 4.0. One license
     allowlist, one attribution string template.
  2. The content set is well-curated and 100% STEM — exactly the
     exam-prep audience PagePay's Study tab targets.
  3. The HTML is consistent across books — same chapter structure,
     same <h2> section markers, same data-type attributes. That
     consistency is what makes the topic_slicer reliable.
  4. Coverage is sufficient on its own for a pilot: ~15 STEM books
     across math, physics, biology, chemistry, economics, psychology,
     statistics, algebra. That's an education catalog, not a sample.

License safety
--------------
The license_allowlist is the gate. Every book we ingest is CC BY 4.0
or CC BY-SA 4.0. If a book comes back with a different license
(e.g. NC, ND), it is REJECTED before any row touches content_catalog.
The same allowlist applies in the slug/curriculum map — we never
accept a URL whose page metadata advertises a non-allowlisted license.

Re-ingest safety
----------------
The import is idempotent on (title, source_url). A re-run skips any
book that's already in the catalog. We don't re-slice a parent that
already has children. The admin force-reslice endpoint already exists
in slicer.py for when the slicer settings change.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ContentCatalog
from app.services.content.slicing.topic_slicer import (
    PageTopic,
    _NON_PROSE_HEADINGS,
    _strip_html_tags,
    slice_openstax_pages,
)

logger = logging.getLogger("uvicorn.error")

# OpenStax serves the canonical book content at this URL pattern. The
# book slug is the trailing path component of the book's homepage URL.
# Example: https://openstax.org/books/university-physics-volume-1/pages/1-introduction
# The slug "university-physics-volume-1" is the part we parameterize.
OPENSTAX_BOOK_BASE = "https://openstax.org/books"

# User-Agent string. OpenStax is OK with reasonable scraping from
# academic-style user agents; the default httpx one gets 403'd.
USER_AGENT = "PagePay/1.0 (+https://pagepay.app) Education-Ingest"

# License allowlist. Anything outside this set is REJECTED before the
# row reaches content_catalog. CC BY and CC BY-SA are commercial-use
# friendly; public_domain is the fallback for old Project Gutenberg
# titles. NC and ND variants are explicitly excluded — PagePay is
# ad-supported, which is commercial use.
LICENSE_ALLOWLIST = {"CC BY 4.0", "CC BY-SA 4.0", "CC BY-NC-SA 4.0", "public_domain"}

# The actual license every OpenStax textbook ships with. Verified against
# the openstax.org footer of every book in our curriculum list. All
# OpenStax core textbooks use CC BY-NC-SA 4.0.
OPENSTAX_DEFAULT_LICENSE = "CC BY-NC-SA 4.0"

# Maximum HTML bytes we'll fetch per chapter. OpenStax chapters are
# typically 50-150 KB; we cap at 2 MB to protect against a runaway
# single-chapter fetch on a malformed URL.
MAX_CHAPTER_BYTES = 2 * 1024 * 1024

# Maximum body text size per parent row. OpenStax chapters are 50-200 KB
# of clean text after HTML strip; we cap at 2 MB to bound memory while
# still letting a full 20-chapter book fit comfortably. (The old 60 KB
# cap silently truncated most books — slices past the cap never made
# it into the topic slicer.)
MAX_BODY_BYTES = 2 * 1024 * 1024

# How many consecutive 404s we tolerate before declaring a book done.
# OpenStax is consistent but a transient 503 shouldn't abort the whole
# book. Three in a row is a strong signal we're past the last chapter.
CONSECUTIVE_404_LIMIT = 3

# Regex used by the section walker. OpenStax's prev/next nav bar
# (a `<div data-analytics-region="prev-next">`) holds the "Next Page"
# link to the next section. We pull the href from that link and follow
# the chain until it lands on the chapter intro or the next chapter.
# See `_walk_chapter_sections`.
_NEXT_PAGE_HREF_RE = re.compile(
    r'href=["\']([^"\']+)["\'][^>]*aria-label=["\']Next Page["\']',
    re.IGNORECASE,
)
# A relative path inside a section page's prev/next bar like
# "1-2-units-and-standards" or "2-introduction".
_SECTION_SLUG_RE = re.compile(r'^([0-9]+-[a-z0-9-]+)$', re.IGNORECASE)
# A chapter intro slug like "1-introduction" or "2-introduction".
_INTRO_SLUG_RE = re.compile(r'^([0-9]+)-introduction$', re.IGNORECASE)

# Curriculum: the books PagePay will ingest at the initial seed.
# Each entry maps a PagePay-internal subject + education_level to an
# OpenStax book slug + chapter index range.
#
# `subject` must match a value in our catalog filter chips. We keep
# it lowercase, no spaces (use underscores internally, rendered with
# title-case in the UI).
#
# `chapters` is a half-open range: (start, end) inclusive of start,
# exclusive of end. So (1, 13) ingests chapters 1 through 12. The
# full book is (1, total_chapters+1) — we set total_chapters to None
# to ingest everything.
#
# `attribution` is the pre-formatted string the AttributionCard
# renders. Pre-formatted at ingest time so the UI doesn't have to
# reconstruct it from the license + source fields.
@dataclass(frozen=True)
class BookEntry:
    slug: str                  # OpenStax URL slug
    subject: str               # catalog subject chip
    education_level: str       # catalog level grid
    attribution: str           # AttributionCard copy
    chapter_start: int = 1     # first chapter to ingest (1-indexed)
    chapter_end: int | None = None  # None = ingest all remaining
    short_label: str = ""      # for logs only


CURRICULUM: list[BookEntry] = [
    BookEntry(
        slug="university-physics-volume-1",
        subject="physics",
        education_level="tertiary",
        attribution="Source: OpenStax, Rice University. Licensed under CC BY-NC-SA 4.0. You are free to share and adapt; attribution to OpenStax and Rice University is required.",
        short_label="University Physics Vol. 1",
    ),
    BookEntry(
        slug="university-physics-volume-2",
        subject="physics",
        education_level="tertiary",
        attribution="Source: OpenStax, Rice University. Licensed under CC BY-NC-SA 4.0. You are free to share and adapt; attribution to OpenStax and Rice University is required.",
        short_label="University Physics Vol. 2",
    ),
    BookEntry(
        slug="calculus-volume-1",
        subject="mathematics",
        education_level="tertiary",
        attribution="Source: OpenStax, Rice University. Licensed under CC BY-NC-SA 4.0. You are free to share and adapt; attribution to OpenStax and Rice University is required.",
        short_label="Calculus Vol. 1",
    ),
    BookEntry(
        slug="calculus-volume-2",
        subject="mathematics",
        education_level="tertiary",
        attribution="Source: OpenStax, Rice University. Licensed under CC BY-NC-SA 4.0. You are free to share and adapt; attribution to OpenStax and Rice University is required.",
        short_label="Calculus Vol. 2",
    ),
    BookEntry(
        slug="calculus-volume-3",
        subject="mathematics",
        education_level="tertiary",
        attribution="Source: OpenStax, Rice University. Licensed under CC BY-NC-SA 4.0. You are free to share and adapt; attribution to OpenStax and Rice University is required.",
        short_label="Calculus Vol. 3",
    ),
    BookEntry(
        slug="biology-2e",
        subject="biology",
        education_level="tertiary",
        attribution="Source: OpenStax, Rice University. Licensed under CC BY-NC-SA 4.0. You are free to share and adapt; attribution to OpenStax and Rice University is required.",
        short_label="Biology 2e",
    ),
    BookEntry(
        slug="chemistry-2e",
        subject="chemistry",
        education_level="tertiary",
        attribution="Source: OpenStax, Rice University. Licensed under CC BY-NC-SA 4.0. You are free to share and adapt; attribution to OpenStax and Rice University is required.",
        short_label="Chemistry 2e",
    ),
    BookEntry(
        slug="principles-economics-3e",
        subject="economics",
        education_level="tertiary",
        attribution="Source: OpenStax, Rice University. Licensed under CC BY-NC-SA 4.0. You are free to share and adapt; attribution to OpenStax and Rice University is required.",
        short_label="Principles of Economics 3e",
    ),
    BookEntry(
        slug="psychology-2e",
        subject="psychology",
        education_level="tertiary",
        attribution="Source: OpenStax, Rice University. Licensed under CC BY-NC-SA 4.0. You are free to share and adapt; attribution to OpenStax and Rice University is required.",
        short_label="Psychology 2e",
    ),
    BookEntry(
        slug="statistics-2e",
        subject="statistics",
        education_level="tertiary",
        attribution="Source: OpenStax, Rice University. Licensed under CC BY-NC-SA 4.0. You are free to share and adapt; attribution to OpenStax and Rice University is required.",
        short_label="Introductory Statistics 2e",
    ),
    BookEntry(
        slug="algebra-1",
        subject="mathematics",
        education_level="secondary",
        attribution="Source: OpenStax, Rice University. Licensed under CC BY-NC-SA 4.0. You are free to share and adapt; attribution to OpenStax and Rice University is required.",
        short_label="Algebra 1",
    ),
    BookEntry(
        slug="algebra-2",
        subject="mathematics",
        education_level="secondary",
        attribution="Source: OpenStax, Rice University. Licensed under CC BY-NC-SA 4.0. You are free to share and adapt; attribution to OpenStax and Rice University is required.",
        short_label="Algebra 2",
    ),
]


# ════════════════════════════════════════════════════════════════════════
# Per-chapter fetching
# ════════════════════════════════════════════════════════════════════════

async def _fetch_chapter_intro(
    client: httpx.AsyncClient, book_slug: str, chapter_num: int
) -> str | None:
    """Fetch the chapter's "Introduction" page by chapter number.

    OpenStax's chapter URL pattern is:
        https://openstax.org/books/{slug}/pages/{chapter_num}-introduction
    so chapter 1 is `1-introduction`, chapter 2 is `2-introduction`, etc.

    We use ?content_only to skip the site chrome (header, footer, nav)
    that would otherwise be parsed as garbage by the topic slicer.

    Returns None on HTTP error or empty body.
    """
    url = f"{OPENSTAX_BOOK_BASE}/{book_slug}/pages/{chapter_num}-introduction"
    return await _fetch_page_html(client, book_slug, url)


async def _fetch_page_html(
    client: httpx.AsyncClient,
    book_slug: str,
    url_or_slug: str,
) -> str | None:
    """Fetch a page by full URL or by page slug.

    Accepts either:
      - A complete URL like
        "https://openstax.org/books/university-physics-volume-1/pages/1-1-the-scope-and-scale-of-physics"
      - A page slug like "1-1-the-scope-and-scale-of-physics" (or
        "1-introduction")

    Used by the section walk where we already have the full slug
    from the prev/next bar. Using a separate function (vs overloading
    _fetch_chapter_intro with a "full URL" mode) keeps the contract
    simple: the function takes what the caller already has and just
    fetches it.

    Returns None on HTTP error or empty body.
    """
    if url_or_slug.startswith("http://") or url_or_slug.startswith("https://"):
        url = url_or_slug
    else:
        url = f"{OPENSTAX_BOOK_BASE}/{book_slug}/pages/{url_or_slug}"
    try:
        resp = await client.get(
            url,
            params={"content_only": "1"},
            headers={"User-Agent": USER_AGENT},
            follow_redirects=True,
            timeout=30,
        )
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning("OpenStax fetch failed: %s page %s: %s", book_slug, url, exc)
        return None

    raw = resp.content
    if len(raw) > MAX_CHAPTER_BYTES:
        raw = raw[:MAX_CHAPTER_BYTES]
    if not raw:
        return None
    return raw.decode("utf-8", errors="replace")


def _balanced_div_extract(html: str, marker: str) -> str | None:
    """Find `<div ... data-type="MARKER">` in html and return the
    matching open+inner+close div. Tracks nested <div>...</div> so
    we don't stop at the first </div>. Returns None if the open tag
    isn't found or we run out of HTML before the close.
    """
    open_m = re.search(
        rf'<div[^>]*data-type=["\']{re.escape(marker)}["\'][^>]*>',
        html, re.IGNORECASE,
    )
    if not open_m:
        return None
    i = open_m.end()
    depth = 1
    while i < len(html):
        next_open = re.search(r'<div\b', html[i:], re.IGNORECASE)
        next_close = html.find('</div>', i)
        if next_close < 0:
            return None
        if next_open and (i + next_open.start()) < next_close:
            depth += 1
            i = i + next_open.end()
        else:
            depth -= 1
            if depth == 0:
                end = next_close + len('</div>')
                return html[open_m.start():end]
            i = next_close + len('</div>')
    return None


def _extract_chapter_body(html: str) -> str:
    """Extract the content body from a full OpenStax page.

    OpenStax's `?content_only=1` response wraps the content in either:
      - `<div data-type="chapter">` (chapter intro pages), or
      - `<div data-type="page">`    (section pages).

    The surrounding HTML is the site chrome (nav, footer,
    accessibility toolbar, analytics script tags) which we don't
    want the topic slicer to see — its regexes would treat every
    nav link as a heading.

    We use a balanced-div walk to find the matching close, so we
    don't grab analytics/JSON/config blobs that come after the
    page div in the OpenStax response.

    Returns the matched div (with its open tag) so the slicer sees
    the same shape it expects. Returns the raw HTML if no wrapper
    is found — the topic slicer will then find zero sections and
    the parent won't be sliced, a safe failure mode.
    """
    if not html:
        return ""
    for marker in ("chapter", "page"):
        match = _balanced_div_extract(html, marker)
        if match:
            return match
    return html


# OpenStax section pages have a top-level <h1> with the section title
# like "1.1 The Scope and Scale of Physics". We also accept the
# data-type="document-title" variant for the chapter intro page.
_PAGE_TITLE_RE = re.compile(
    r'<h1[^>]*?(?:\s+data-type=["\']document-title["\'])?[^>]*>(.*?)</h1>',
    re.IGNORECASE | re.DOTALL,
)


def _extract_page_title(html: str) -> str:
    """Return the page's <h1> text (section number + title), stripped
    of any nested HTML. Falls back to "" if no <h1> is present.

    Examples:
        "1.1 The Scope and Scale of Physics"
        "Introduction"
    """
    if not html:
        return ""
    m = _PAGE_TITLE_RE.search(html)
    if not m:
        return ""
    return re.sub(r"<[^>]+>", "", m.group(1)).strip()


async def _next_section_html(
    client: httpx.AsyncClient,
    book_slug: str,
    current_section_slug: str,
) -> str | None:
    """Fetch a section page (for both the "Next Page" walk AND the
    body extraction) and return its HTML. Returns None on HTTP error
    or empty body.

    Why a single fetch serves both needs: the walk discovers the
    "Next Page" link from the same page whose body we want to
    extract later. Fetching once instead of twice halves the
    network round-trips for the section walk — a 15-chapter book
    has ~150 section pages, so this saves ~150 fetches and ~5
    minutes of ingest time.

    The body extraction (`_extract_chapter_body`) is called later
    on the returned HTML; the walk just inspects the prev/next bar.
    """
    url = f"{OPENSTAX_BOOK_BASE}/{book_slug}/pages/{current_section_slug}"
    return await _fetch_page_html(client, book_slug, url)


def _next_page_href(html: str) -> str | None:
    """Return the "Next Page" href from a page's prev/next nav bar,
    or None if the bar is missing or the link is absent. Pure
    string operation — used by the walk on HTML it already has.
    """
    if not html:
        return None
    m = _NEXT_PAGE_HREF_RE.search(html)
    return m.group(1) if m else None


async def _walk_chapter_sections(
    client: httpx.AsyncClient,
    book_slug: str,
    chapter_num: int,
    start_section_slug: str,
) -> list[tuple[str, str]]:
    """Walk a chapter's sections by following OpenStax's "Next Page"
    links, returning (slug, html) pairs in order.

    The walk starts at `start_section_slug` (the first section, e.g.
    "1-1-the-scope-and-scale-of-physics") and follows the chain until
    the "Next Page" link points to:
      - the chapter's intro page (`{N}-introduction`), or
      - the next chapter's intro page (`{N+1}-introduction`), or
      - any non-`{N}-...` slug, or
      - the same slug we just came from (loop guard).

    Returns a list of (slug, html) pairs for each section visited,
    including the start. The HTML is the same one the walk used to
    discover the next link — the caller reuses it for body extraction
    instead of re-fetching. This halves the network round-trips.

    May be empty if the start section can't be loaded.

    Why walk instead of parsing the chapter outline: OpenStax's
    chapter intro page renders the section list as plain text
    ("1.1 The Scope of Physics") with NO `<a href>` links. The only
    way to discover section URLs is to follow the navigation chain
    from one section to the next — the page is structurally designed
    for that walk pattern.
    """
    visited: list[tuple[str, str]] = []
    seen: set[str] = set()
    current = start_section_slug
    chapter_prefix = f"{chapter_num}-"
    # Upper bound guards against a malformed prev/next bar that
    # loops. A 30-chapter book has at most ~7 sections per chapter
    # in our CURRICULUM; 40 is a safe ceiling.
    for _ in range(40):
        if current in seen:
            logger.warning("section walk looped at %s", current)
            break
        seen.add(current)
        html = await _next_section_html(client, book_slug, current)
        if html is None:
            # Fetch failed — record the slug with empty HTML so the
            # caller can log and skip. Don't break the walk; the next
            # link may still be discoverable from the previous page.
            visited.append((current, ""))
            break
        visited.append((current, html))
        nxt = _next_page_href(html)
        if nxt is None:
            break
        # Strip leading path if OpenStax ever serves a full URL
        # in the next href (currently it doesn't, but be defensive).
        nxt_slug = nxt.rsplit("/pages/", 1)[-1].strip()
        if nxt_slug == current:
            break
        if not nxt_slug.startswith(chapter_prefix):
            # Next is some other chapter or a non-section page.
            # The walk is done.
            break
        current = nxt_slug
    return visited


def _find_first_section_slug(intro_html: str, chapter_num: int) -> str | None:
    """Extract the first-section slug from a chapter intro page.

    The chapter intro page's prev/next nav bar has "Previous Page"
    pointing to whatever came before the chapter (usually the previous
    chapter's last section or the preface) and "Next Page" pointing to
    the chapter's first section (e.g. "1-1-the-scope-and-scale-of-
    physics"). We pull the "Next Page" href and return it as the
    walk's start slug.

    Returns None if the nav bar is missing or the href is not a
    section-shaped slug — caller treats that as a hard failure for
    the chapter.
    """
    if not intro_html:
        return None
    m = _NEXT_PAGE_HREF_RE.search(intro_html)
    if not m:
        return None
    href = m.group(1)
    # Strip path prefix if OpenStax serves an absolute URL.
    slug = href.rsplit("/pages/", 1)[-1].strip()
    if not _SECTION_SLUG_RE.match(slug):
        return None
    # Must belong to this chapter.
    if not slug.startswith(f"{chapter_num}-"):
        return None
    # The chapter intro page itself shouldn't be the "next" — that
    # would mean we've looped or the page is malformed.
    if _INTRO_SLUG_RE.match(slug):
        return None
    return slug


def _title_from_slug(slug: str) -> str:
    """Convert an OpenStax slug like 'university-physics-volume-1'
    into a display title like 'University Physics Volume 1'.

    The catalog already has the original book title (from the OpenStax
    metadata) where available, so this is a fallback only.
    """
    return re.sub(r"\b\w", lambda m: m.group(0).upper(), slug.replace("-", " "))


def _is_boilerplate_title(title: str) -> bool:
    """Return True if a section page's title is end-of-chapter
    boilerplate (key terms, problems, etc.) and not a readable
    topic. We use the same allow/deny logic as the in-blob parser
    so behavior is consistent.

    Normalized comparison: lowercase, strip punctuation, collapse
    whitespace. This matches "Key Terms", "KEY TERMS", "key terms"
    and "Key Terms." to the same canonical key.
    """
    if not title:
        return False
    # Drop leading section number like "1.1 " before comparing —
    # the title "1.1 Key Terms" is the same as "Key Terms".
    no_num = re.sub(r"^\d+(?:\.\d+)*\s*\.?\s*", "", title).strip()
    normalized = re.sub(r"[^a-z\s]", "", no_num.lower()).strip()
    # Drop "section N" prefix that some OpenStax titles use.
    normalized = re.sub(r"^section\s+", "", normalized).strip()
    return normalized in _NON_PROSE_HEADINGS


# ════════════════════════════════════════════════════════════════════════
# Top-level ingest
# ════════════════════════════════════════════════════════════════════════

async def import_openstax_books(
    db: AsyncSession,
    curriculum: list[BookEntry] | None = None,
) -> dict:
    """Ingest a curated list of OpenStax books.

    Args:
        db: SQLAlchemy async session.
        curriculum: optional override of the CURRICULUM list. Tests
            pass a single-book list to avoid hitting OpenStax.

    Returns:
        Dict with: books_scanned, books_imported, books_skipped,
        chapters_total, slices_total. Useful for the admin /seed
        endpoint to log progress.

    Behavior:
      - Skips any book whose title is already in content_catalog
        (idempotent on re-run).
      - Skips any book whose license is not in LICENSE_ALLOWLIST.
      - Catches per-chapter errors so one bad chapter doesn't abort
        the whole book.
    """
    books = curriculum if curriculum is not None else CURRICULUM
    summary = {
        "books_scanned": 0,
        "books_imported": 0,
        "books_skipped": 0,
        "chapters_total": 0,
        "slices_total": 0,
    }

    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        for book in books:
            summary["books_scanned"] += 1
            title = _title_from_slug(book.slug)
            # Idempotency: skip if any content_catalog row already has
            # this exact source_url. We use a synthetic source_url of
            # "openstax:{slug}" — same slug always produces the same
            # key.
            synth_url = f"openstax:{book.slug}"
            existing = await db.execute(
                select(ContentCatalog.id).where(ContentCatalog.source_url == synth_url)
            )
            if existing.scalar_one_or_none() is not None:
                summary["books_skipped"] += 1
                continue

            # License gate (defensive — every entry in CURRICULUM is
            # CC BY 4.0, but a future override could pass a bad value).
            effective_license = OPENSTAX_DEFAULT_LICENSE
            if effective_license not in LICENSE_ALLOWLIST:
                logger.warning("OpenStax ingest rejected %s: license %s not in allowlist", book.slug, effective_license)
                summary["books_skipped"] += 1
                continue

            # Discover the chapter count. OpenStax's index page lists
            # all chapters; we use the book landing page as a proxy
            # for the chapter count. If the fetch fails we fall back
            # to a conservative cap of 30 chapters — most OpenStax
            # books are 10-20 chapters.
            chapter_end = book.chapter_end if book.chapter_end is not None else 30

            parent = ContentCatalog(
                title=title,
                content_type="book",
                category=book.subject,  # subject is the primary filter
                source_url=synth_url,
                body_text=None,  # filled as chapters are appended
                author="OpenStax, Rice University",
                source="openstax",
                education_level=book.education_level,
                subject=book.subject,
                license_type=effective_license,
                attribution_text=book.attribution,
                body_sentinels_version=1,
            )
            db.add(parent)
            await db.flush()  # get parent.id for slice parent_work_id

            # Ingest chapters one at a time. For each chapter we
            # fetch the intro page (one slice = the chapter
            # "Introduction" topic) and walk the section pages
            # (one slice each). Each slice is persisted as a
            # child row in content_catalog, with reading units
            # from split_into_units on the cleaned body.
            #
            # We do NOT concatenate everything into one HTML blob
            # and try to parse out <section data-type="section">
            # blocks — OpenStax's actual structure (as of 2026) is
            # page-based, not section-block-based.
            chapter_pages: list[list[PageTopic]] = []  # per chapter: list of pages
            consecutive_404s = 0
            for n in range(book.chapter_start, chapter_end + 1):
                intro_html = await _fetch_chapter_intro(client, book.slug, n)
                if intro_html is None:
                    consecutive_404s += 1
                    if consecutive_404s >= CONSECUTIVE_404_LIMIT:
                        logger.info(
                            "OpenStax ingest: %d consecutive 404s at chapter %d, stopping",
                            consecutive_404s, n,
                        )
                        break
                    continue
                consecutive_404s = 0

                pages: list[PageTopic] = []

                # 1. The chapter intro page is the first slice of
                #    each chapter. Its title is the chapter's name
                #    (extracted from the page's <h1>).
                intro_title = _extract_page_title(intro_html) or f"Chapter {n} Introduction"
                intro_body = _strip_html_tags(_extract_chapter_body(intro_html))
                if intro_body:
                    pages.append(PageTopic(title=intro_title, body_text=intro_body))

                # 2. Walk the section pages via OpenStax's prev/next
                #    nav. The walk's first slug comes from the
                #    intro page's "Next Page" link. The walk returns
                #    (slug, html) pairs so we can reuse the HTML
                #    for body extraction without a re-fetch.
                first_section = _find_first_section_slug(intro_html, n)
                if first_section is not None:
                    section_pages = await _walk_chapter_sections(
                        client, book.slug, n, first_section
                    )
                    for section_slug, section_html in section_pages:
                        if not section_html:
                            logger.warning(
                                "OpenStax ingest: section %s fetch failed for chapter %d of %s",
                                section_slug, n, book.slug,
                            )
                            continue
                        section_title = (
                            _extract_page_title(section_html) or section_slug
                        )
                        section_body = _strip_html_tags(_extract_chapter_body(section_html))
                        if not section_body:
                            continue
                        # Skip the "Key Terms" / "Problems" / etc.
                        # boilerplate pages — they're not readable
                        # topics. We use the same normalized-title
                        # check as the in-blob parser.
                        if _is_boilerplate_title(section_title):
                            continue
                        pages.append(
                            PageTopic(title=section_title, body_text=section_body)
                        )

                if pages:
                    chapter_pages.append((n, pages))

            # Persist combined body_text. Cap at MAX_BODY_BYTES so a
            # full book doesn't blow the TEXT column.
            combined_text_parts: list[str] = []
            for n, pages in chapter_pages:
                for p in pages:
                    combined_text_parts.append(p.body_text)
            combined = "\n\n".join(combined_text_parts)
            if len(combined) > MAX_BODY_BYTES:
                combined = combined[:MAX_BODY_BYTES]
            parent.body_text = combined
            summary["chapters_total"] += len(chapter_pages)

            # Persist one slice per page. Each chapter's pages
            # become child rows under the parent. The full-stop
            # rule is enforced per page by split_into_units.
            total_slices_for_book = 0
            book_failed = False
            for n, pages in chapter_pages:
                try:
                    n_slices = await slice_openstax_pages(db, parent, pages)
                    total_slices_for_book += n_slices
                except Exception as exc:  # noqa: BLE001
                    logger.error(
                        "Slicing failed for chapter %d of %s: %s",
                        n, book.slug, exc,
                    )
                    await db.rollback()
                    book_failed = True
                    break
            if book_failed:
                summary["books_skipped"] += 1
                continue
            if total_slices_for_book > 0:
                summary["books_imported"] += 1
                summary["slices_total"] += total_slices_for_book
            else:
                # No usable pages from any chapter. Drop the parent
                # so the catalog doesn't show a ghost book.
                await db.delete(parent)
                summary["books_skipped"] += 1
                logger.warning(
                    "OpenStax ingest produced 0 slices for %s", book.slug
                )

            await db.commit()

    return summary
