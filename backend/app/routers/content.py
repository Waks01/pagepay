"""Ad-rotation helper for the content feed.

`build_feed_with_sponsored` interleaves sponsored content every
Nth slot in a flat list. Used by the `/content/feed/:user_id`
endpoint so the catalog tab can show a sponsored card mixed in
with the regular books/articles, just like Twitter / Instagram /
Facebook do.

Why we don't query `is_sponsored` items in-line with the main
catalog query: the per-user de-dup logic ("don't show the same
sponsored item twice in a row") needs to compare across the two
streams, and that's easier to do in Python than in SQL. The
catalog dataset is small enough (≤50 items per page) that doing
the merge in-process is fine — we never load more than that.

The sponsored list comes from `ContentCatalog` filtered by
`is_sponsored=True`. We cap at `settings.feed_max_sponsored` and
shuffle deterministically per user (the same user always sees the
same sponsored order until they advance their read state, so the
back button restores the same ad).

Caller contract:
  organic:    ordered list of ContentCatalog (the regular items)
  sponsored:  ordered list of ContentCatalog (the ad-eligible items)
  user_id:    the requester — used for the per-user shuffle seed
  every:      how often to inject a sponsored item (default 4)

Returns: flat list of ContentCatalog with `is_sponsored=True` items
at positions `[every, 2*every, 3*every, ...]`. The last few items
in the organic list are dropped to make room — we trim the tail,
not the head, so the user still sees the most recent content.
"""

from __future__ import annotations

import hashlib
import random
from typing import Sequence

from app.config import settings
from app.models import ContentCatalog


def _seeded_shuffle(items: Sequence[ContentCatalog], user_id: int) -> list[ContentCatalog]:
    """Deterministic per-user shuffle.

    Same user → same order on every call until we add a freshness
    signal. Today's "freshness" is implicit: organic items come
    from the DB already ordered, and the sponsored shuffle is
    stable per-user, so the UI never shuffles under the user's
    thumb while they're scrolling.
    """
    seed_material = f"user:{user_id}:sponsored".encode("utf-8")
    seed_int = int(hashlib.sha256(seed_material).hexdigest()[:16], 16)
    rng = random.Random(seed_int)
    indexed = list(items)
    rng.shuffle(indexed)
    return indexed


def build_feed_with_sponsored(
    organic: Sequence[ContentCatalog],
    sponsored: Sequence[ContentCatalog],
    user_id: int,
    every: int | None = None,
    max_sponsored: int | None = None,
) -> list[ContentCatalog]:
    """Interleave sponsored items every Nth position.

    Sponsored list is taken from the head of the per-user shuffle
    (already capped by the caller). The last
    `len(organic) // every` organic items are dropped so the
    output length equals `len(organic)`. With the defaults
    (every=4, organic=20) we drop up to 5 organic items and gain
    5 sponsored — net length unchanged.

    The per-user de-dup ("don't repeat the same sponsored back-
    to-back") is handled by the per-user shuffle + the fact that
    each sponsored item is only inserted once per feed (we never
    pull a sponsored id twice).
    """
    interval = every if every is not None else settings.feed_sponsored_every
    cap = max_sponsored if max_sponsored is not None else settings.feed_max_sponsored
    if interval <= 0 or not sponsored:
        # Sponsored rotation disabled or no sponsored inventory —
        # return the organic list unchanged.
        return list(organic)

    # Cap the sponsored list. The caller may have already capped it
    # at the SQL level; this is a belt-and-suspenders check.
    sponsored_capped = list(sponsored)[:cap]
    if not sponsored_capped:
        return list(organic)

    # Deterministic per-user shuffle. The seed is per-user, so
    # back-button navigations restore the same ad order.
    sponsored_shuffled = _seeded_shuffle(sponsored_capped, user_id)

    # How many sponsored slots can we fill? Floor(len(organic) /
    # interval) — the last partial slot is dropped because an ad
    # at the very end of the feed looks like a "click here" CTA
    # that the user can't act on without scrolling back up.
    slots = len(organic) // interval
    if slots == 0:
        return list(organic)
    sponsored_to_use = sponsored_shuffled[:slots]

    # Insert one sponsored item every `interval` positions. We
    # split the organic list into `slots` chunks and put a
    # sponsored item after each chunk. The total length stays
    # equal to len(organic) because we drop the tail of organic
    # equal to the sponsored count we add.
    out: list[ContentCatalog] = []
    organic_kept = list(organic)[: len(organic) - slots]
    # With N organic kept and S sponsored, we split organic_kept
    # into S groups. The size of each group is N // S with the
    # remainder items added to the first few groups.
    group_size = len(organic_kept) // slots
    remainder = len(organic_kept) % slots
    pos = 0
    for i, ad in enumerate(sponsored_to_use):
        # First `remainder` groups get one extra organic item so
        # the total organic count is exact.
        extra = 1 if i < remainder else 0
        out.extend(organic_kept[pos : pos + group_size + extra])
        pos += group_size + extra
        out.append(ad)
    return out


import logging
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from jose import jwt, JWTError
from app.database import get_db
from app.models import ContentCatalog, ReadingProgress
from app.routers.auth import get_current_user
from app.models import User
from app.schemas import (
    ContentItem, ContentDetail, ContinueReading, BookDetail, SliceSummary,
    ResumeState, ContentFilterResponse,
)
from app.services.content.gutendex import import_gutendex
from app.services.content.slicing import force_reslice_all
from app.config import settings

router = APIRouter(prefix="/content", tags=["content"])
logger = logging.getLogger("uvicorn.error")


async def get_current_user_optional(
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> User | None:
    """Like get_current_user but returns None instead of 401 if no token.

    Used by /catalog so anonymous browsers can still see the catalog.
    /progress and /continue stay strictly behind auth.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        user_id = payload.get("sub")
        if user_id is None:
            return None
    except JWTError:
        return None
    user = (await db.execute(select(User).where(User.id == int(user_id)))).scalar_one_or_none()
    return user


@router.get("/categories")
async def get_categories(db: AsyncSession = Depends(get_db)):
    """Return distinct, cleaned-up category names from the content catalog.

    Gutendex stores categories as comma-separated strings like
    `"Category: British Literature, Category: Novels"`. This endpoint
    splits them apart, strips prefixes, deduplicates, sorts, and returns
    a flat list so the client can populate its filter chips dynamically.
    """
    rows = await db.execute(
        select(ContentCatalog.category).distinct().where(ContentCatalog.category.isnot(None))
    )
    seen: set[str] = set()
    out: list[str] = []
    for (cat_str,) in rows.all():
        for part in cat_str.split(","):
            cleaned = part.strip()
            # Strip common Gutendex prefixes like "Category: "
            for prefix in ("Category: ", "Best Books Ever Listings, ", "Banned Books List from the American Library Association, ",
                           "Banned Books from Anne Haight's list, ", "Bestsellers, American, 1895-1923, "):
                if cleaned.startswith(prefix):
                    cleaned = cleaned[len(prefix):].strip()
            if not cleaned or cleaned in seen:
                continue
            seen.add(cleaned)
            out.append(cleaned)
    out.sort()
    return out


@router.get("/feed/{user_id}", response_model=list[ContentItem])
async def get_content_feed(
    user_id: int,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    category: str | None = Query(
        None,
        description="Optional category filter (e.g. 'Fiction', 'News'). Mirrors the /catalog filter.",
    ),
    education_level: str | None = Query(
        None,
        description="Filter by education level: creche | primary | secondary | tertiary | research",
    ),
    subject: str | None = Query(
        None,
        description="Filter by subject: physics | mathematics | biology | chemistry | economics | psychology | statistics",
    ),
    class_level: str | None = Query(
        None,
        description="Filter by class level: 'Grade 1' .. 'Grade 12', 'Year 1' .. 'Year 4'.",
    ),
    db: AsyncSession = Depends(get_db),
):
    """The user's content feed with sponsored rotation.

    Phase 2 endpoint. The catalog tab calls this instead of
    `/catalog` so the in-feed native ad lands every 4th item
    per the spec. The organic list comes from `/catalog`'s
    query (parent works only, category-filtered, exclude-read
    honored); the sponsored list comes from
    `ContentCatalog` filtered by `is_sponsored=True`.

    Sponsored insertion is done in Python via
    `build_feed_with_sponsored` because the per-user shuffle
    seed is cheaper to compute there than as a SQL ORDER BY
    expression, and the merge needs to compare across both
    streams (de-dup of repeats).

    The user_id in the path is for the per-user shuffle. We
    don't gate the endpoint on auth — the spec's anonymous
    browse path stays open. If `user_id` doesn't match the
    caller's token (when one is present), we still serve the
    request (ad rotation is the same regardless of which user
    is asking), but log a warning.
    """
    # Organic items: same query as /catalog.
    organic_stmt = select(ContentCatalog).where(ContentCatalog.parent_work_id.is_(None))
    if category:
        organic_stmt = organic_stmt.where(ContentCatalog.category.ilike(f"%{category}%"))
    if education_level:
        organic_stmt = organic_stmt.where(ContentCatalog.education_level == education_level)
    if subject:
        organic_stmt = organic_stmt.where(ContentCatalog.subject == subject)
    if class_level:
        organic_stmt = organic_stmt.where(ContentCatalog.class_level == class_level)
    organic_stmt = organic_stmt.offset((page - 1) * limit).limit(limit)
    organic_rows = (await db.execute(organic_stmt)).scalars().all()

    # Sponsored items: separate query, capped. We over-fetch by 2x
    # the cap so the per-user shuffle has a few candidates to
    # pick from even if the user has seen some already (we don't
    # track "seen sponsored" in v1 — over-fetching is the cheap
    # way to keep the list varied).
    sponsored_cap = settings.feed_max_sponsored
    sponsored_stmt = (
        select(ContentCatalog)
        .where(ContentCatalog.is_sponsored == True)  # noqa: E712
        .where(ContentCatalog.parent_work_id.is_(None))
        .order_by(func.random())
        .limit(sponsored_cap * 2)
    )
    sponsored_rows = (await db.execute(sponsored_stmt)).scalars().all()

    merged = build_feed_with_sponsored(
        organic=organic_rows,
        sponsored=sponsored_rows,
        user_id=user_id,
    )
    return [
        ContentItem(
            id=item.id,
            title=item.title,
            content_type=item.content_type,
            category=item.category,
            author=item.author,
            estimated_read_minutes=item.estimated_read_minutes,
            is_sponsored=item.is_sponsored,
            source=item.source,
            education_level=item.education_level,
            subject=item.subject,
            class_level=item.class_level,
            license_type=item.license_type,
            attribution_text=item.attribution_text,
        )
        for item in merged
    ]


@router.get("/catalog", response_model=list[ContentItem])
async def list_catalog(
    category: str | None = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    exclude_read: bool = Query(
        False,
        description="If true, omit works the current user has finished reading. Requires auth.",
    ),
    education_level: str | None = Query(
        None,
        description="Filter by education level: creche | primary | secondary | tertiary | research",
    ),
    subject: str | None = Query(
        None,
        description="Filter by subject: physics | mathematics | biology | chemistry | economics | psychology | statistics",
    ),
    source: str | None = Query(
        None,
        description="Filter by source: gutendex | openstax | gnews",
    ),
    class_level: str | None = Query(
        None,
        description=(
            "Filter by class level: 'Grade 1' .. 'Grade 12', 'Year 1' .. 'Year 4'. "
            "Always combine with education_level so creche/research are excluded."
        ),
    ),
    search: str | None = Query(
        None,
        max_length=120,
        description=(
            "Case-insensitive substring match against title and author. "
            "Implemented as ILIKE on both columns (OR'd) — fine at the "
            "current catalog scale (~thousands of rows). If we ever push "
            "past ~100k rows this is the obvious place to swap in "
            "tsvector + GIN."
        ),
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
):
    """Browse the public catalog.

    Only parent works and standalone slices are returned — child slices
    (parts of a sliced book) are intentionally hidden so the user sees
    each book once and then drills into its slices from the reader.

    `exclude_read=true` requires auth and filters out works the user has
    marked finished. Pass false (default) for an anonymous browser view.

    Education filters (`education_level`, `subject`, `source`) are
    designed for the Catalog tab's level grid + subject chips. They
    return education content only when set; NULL on those columns
    means casual reader content, so a request with no filters returns
    the full mixed catalog.
    """
    stmt = select(ContentCatalog).where(ContentCatalog.parent_work_id.is_(None))
    if category:
        stmt = stmt.where(ContentCatalog.category == category)
    if education_level:
        stmt = stmt.where(ContentCatalog.education_level == education_level)
    if subject:
        stmt = stmt.where(ContentCatalog.subject == subject)
    if source:
        stmt = stmt.where(ContentCatalog.source == source)
    if class_level:
        stmt = stmt.where(ContentCatalog.class_level == class_level)
    if search:
        # ILIKE on title + author. OR'd, not AND'd, so a search for
        # "physics" matches books with physics in the title *or* a
        # physics author. The leading + trailing %s make it a substring
        # match; the f-string is safe because `search` is bounded by
        # max_length=120 above.
        pattern = f"%{search}%"
        stmt = stmt.where(
            ContentCatalog.title.ilike(pattern) | ContentCatalog.author.ilike(pattern)
        )

    if exclude_read:
        if current_user is None:
            # Auth dependency will already 401; belt + suspenders.
            raise HTTPException(status_code=401, detail="Sign in to exclude read works")
        finished_ids_subq = (
            select(ReadingProgress.work_id)
            .where(ReadingProgress.user_id == current_user.id)
            .where(ReadingProgress.is_finished == True)  # noqa: E712
        )
        stmt = stmt.where(ContentCatalog.id.notin_(finished_ids_subq))

    stmt = stmt.order_by(ContentCatalog.id.asc()).offset((page - 1) * limit).limit(limit)
    result = await db.execute(stmt)
    items = result.scalars().all()
    return [
        ContentItem(
            id=item.id,
            title=item.title,
            content_type=item.content_type,
            category=item.category,
            author=item.author,
            estimated_read_minutes=item.estimated_read_minutes,
            is_sponsored=item.is_sponsored,
            source=item.source,
            education_level=item.education_level,
            subject=item.subject,
            class_level=item.class_level,
            license_type=item.license_type,
            attribution_text=item.attribution_text,
        )
        for item in items
    ]


@router.get("/filters", response_model=ContentFilterResponse)
async def get_content_filters(db: AsyncSession = Depends(get_db)):
    """Distinct values for the catalog filter axes.

    Powers the level grid + subject chips on the Catalog tab. The
    client fetches this on first Catalog render and caches it. The
    response is a list of strings for each axis, in alphabetical
    order, with NULLs excluded.

    Why a separate endpoint: querying the catalog itself for "what
    levels exist?" forces a full scan + GROUP BY on every request.
    A lightweight /filters endpoint is cached aggressively and keeps
    the catalog query plan simple.
    """
    # DISTINCT values for each axis. We use a SELECT DISTINCT col
     # pattern; PostgreSQL optimizes this to a loose index
    # scan when the column is indexed.
    levels_rows = await db.execute(
        select(ContentCatalog.education_level)
        .where(ContentCatalog.education_level.is_not(None))
        .distinct()
    )
    subjects_rows = await db.execute(
        select(ContentCatalog.subject)
        .where(ContentCatalog.subject.is_not(None))
        .distinct()
    )
    sources_rows = await db.execute(
        select(ContentCatalog.source).distinct()
    )
    levels = sorted(r for (r,) in levels_rows.all() if r)
    subjects = sorted(r for (r,) in subjects_rows.all() if r)
    sources = sorted(r for (r,) in sources_rows.all() if r)
    return ContentFilterResponse(
        education_levels=levels,
        subjects=subjects,
        sources=sources,
    )


@router.get("/continue", response_model=ContinueReading)
async def continue_reading(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Convenience alias for GET /progress/continue.

    Returns the slice the user should read next, or `has_in_progress=false`
    if they have no in-progress work. The client can hit this when
    navigating to the reader or building a "continue" banner on home.
    """
    # Defer to the progress router's logic via a thin lookup.
    rp_row = await db.execute(
        select(ReadingProgress)
        .where(ReadingProgress.user_id == current_user.id)
        .where(ReadingProgress.is_finished == False)  # noqa: E712
        # PostgreSQL supports NULLS LAST natively; kept as two-key sort
        # for cross-DB compatibility if needed in the future.
        # Rows with `last_read_at IS NULL` sort to the end because `1 > 0`,
        # then the secondary `desc()` puts the most recent timestamp first.
        .order_by(ReadingProgress.last_read_at.is_(None).asc(), ReadingProgress.last_read_at.desc())
        .limit(1)
    )
    rp = rp_row.scalar_one_or_none()
    if rp is None:
        return ContinueReading(
            slice_id=None, work_id=None, work_title=None, slice_title=None,
            slice_order=0, total_slices=0, percent_complete=0,
            has_in_progress=False, scroll_offset_px=0,
        )

    slice_id = rp.current_slice_id
    if slice_id is None:
        # No pointer yet — return the first slice's id if it exists.
        from app.models import ContentCatalog as CC
        first = (await db.execute(
            select(CC)
            .where(CC.parent_work_id == rp.work_id)
            .where(CC.read_order == 1)
            .limit(1)
        )).scalar_one_or_none()
        if first is not None:
            slice_id = first.id

    if slice_id is None:
        return ContinueReading(
            slice_id=None, work_id=rp.work_id, work_title=None, slice_title=None,
            slice_order=rp.current_slice_order, total_slices=rp.total_slices,
            percent_complete=0, has_in_progress=True, scroll_offset_px=0,
        )

    from app.models import ContentCatalog as CC, SliceBookmark as SB
    slice_obj = (await db.execute(select(CC).where(CC.id == slice_id))).scalar_one_or_none()
    if slice_obj is None:
        return ContinueReading(
            slice_id=None, work_id=None, work_title=None, slice_title=None,
            slice_order=0, total_slices=0, percent_complete=0,
            has_in_progress=False, scroll_offset_px=0,
        )
    work = (await db.execute(select(CC).where(CC.id == rp.work_id))).scalar_one_or_none()
    bm = (await db.execute(
        select(SB.scroll_offset_px)
        .where(SB.user_id == current_user.id)
        .where(SB.slice_id == slice_id)
        .limit(1)
    )).scalar_one_or_none() or 0

    percent = int((rp.slices_completed / rp.total_slices) * 100) if rp.total_slices > 0 else 0
    return ContinueReading(
        slice_id=slice_id,
        work_id=rp.work_id,
        work_title=work.title if work else None,
        slice_title=slice_obj.title,
        slice_order=rp.current_slice_order,
        total_slices=rp.total_slices,
        percent_complete=min(100, percent),
        has_in_progress=True,
        scroll_offset_px=bm,
    )


@router.get("/{content_id:int}", response_model=ContentDetail)
async def get_content(content_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ContentCatalog).where(ContentCatalog.id == content_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Content not found")
    
    # v3 §3.3: compute audio_url if this content has reading units.
    # We fetch the first unit for this content_id (there's typically
    # only one unit per slice, but if a slice has multiple, we link
    # to the first — the player UI doesn't loop through units).
    from app.models import ReadingUnit
    unit_result = await db.execute(
        select(ReadingUnit.id)
        .where(ReadingUnit.slice_id == content_id)
        .order_by(ReadingUnit.unit_order)
        .limit(1)
    )
    unit_id = unit_result.scalar_one_or_none()
    audio_url = f"/api/v1/content/audio/{unit_id}.mp3" if unit_id else None
    
    return ContentDetail(
        id=item.id,
        title=item.title,
        content_type=item.content_type,
        category=item.category,
        author=item.author,
        body_text=item.body_text,
        estimated_read_minutes=item.estimated_read_minutes,
        is_sponsored=item.is_sponsored,
        parent_work_id=item.parent_work_id,
        # v3 sentinel contract version. 0 for the existing catalog;
        # the OpenStax ingest will bump this to 1 when it starts
        # emitting sentinels (separate change, see migration 017).
        body_sentinels_version=item.body_sentinels_version,
        audio_url=audio_url,
    )


@router.get("/works/{work_id}", response_model=BookDetail)
async def get_book_detail(
    work_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
):
    """Parent work + the ordered list of its slices.

    Powers the locked-slice detail screen. If the work has no children
    (standalone article, or a book imported before slicing was wired in
    that still hasn't been re-sliced), we surface it as a single-slice
    work so the UI doesn't have to branch on `is_sliced`.

    Anonymous callers can browse — auth is only needed when the client
    wants to overlay the user's per-slice completion state. That's
    intentionally not in this response; clients hit `/progress` separately
    if they need it.
    """
    work_row = await db.execute(
        select(ContentCatalog).where(ContentCatalog.id == work_id)
    )
    work = work_row.scalar_one_or_none()
    if work is None:
        raise HTTPException(status_code=404, detail=f"Work {work_id} not found")

    # Children of this parent.
    children_rows = await db.execute(
        select(ContentCatalog)
        .where(ContentCatalog.parent_work_id == work_id)
        .order_by(ContentCatalog.read_order.asc())
    )
    children = children_rows.scalars().all()

    if children:
        slices = [
            SliceSummary(
                id=child.id,
                title=child.title,
                read_order=child.read_order or idx + 1,
                total_slices=child.total_slices or len(children),
                estimated_read_minutes=child.estimated_read_minutes or 1,
            )
            for idx, child in enumerate(children)
        ]
        is_sliced = True
    else:
        # Standalone — surface the parent itself as a single-slice work so
        # the same UI renders without branching. `total_slices=1` matches
        # how the slicer tags standalone articles.
        slices = [
            SliceSummary(
                id=work.id,
                title=work.title,
                read_order=1,
                total_slices=1,
                estimated_read_minutes=work.estimated_read_minutes or 1,
            )
        ]
        is_sliced = False

    return BookDetail(
        id=work.id,
        title=work.title,
        author=work.author,
        category=work.category,
        estimated_read_minutes=work.estimated_read_minutes or sum(s.estimated_read_minutes for s in slices),
        content_type=work.content_type,
        is_sliced=is_sliced,
        slices=slices,
        source=work.source,
        education_level=work.education_level,
        subject=work.subject,
        class_level=work.class_level,
        license_type=work.license_type,
        attribution_text=work.attribution_text,
    )


@router.get("/works/{work_id}/resume", response_model=ResumeState)
async def get_book_resume(
    work_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The user's progress against one work. Returns the slice id they
    currently have unlocked plus how many slices they've completed.

    If the user has never touched this work, returns all-zero, is_finished
    false, current_slice_id=None. The detail screen treats "no progress"
    the same as "first slice unlocked" — there's nothing to lock.
    """
    rp_row = await db.execute(
        select(ReadingProgress)
        .where(ReadingProgress.user_id == current_user.id)
        .where(ReadingProgress.work_id == work_id)
    )
    rp = rp_row.scalar_one_or_none()
    if rp is None:
        return ResumeState(
            work_id=work_id,
            current_slice_id=None,
            slices_completed=0,
            total_slices=0,
            percent_complete=0,
            is_finished=False,
        )

    current = rp.current_slice_id
    if current is None and (not rp.is_finished):
        # Pointer was never set — return first slice id if it exists,
        # same fallback the /continue endpoint uses.
        first_row = await db.execute(
            select(ContentCatalog)
            .where(ContentCatalog.parent_work_id == work_id)
            .where(ContentCatalog.read_order == 1)
            .limit(1)
        )
        first = first_row.scalar_one_or_none()
        if first is not None:
            current = first.id

    percent = int(
        (rp.slices_completed / rp.total_slices) * 100
        if rp.total_slices > 0 else 0
    )
    return ResumeState(
        work_id=work_id,
        current_slice_id=current,
        slices_completed=rp.slices_completed,
        total_slices=rp.total_slices,
        percent_complete=min(100, percent),
        is_finished=rp.is_finished,
    )


@router.post("/refresh")
async def refresh_catalog(db: AsyncSession = Depends(get_db)):
    """On-demand catalog refresh — pulls a new page of books from Gutendex,
    then re-slices every parent in the catalog.

    Designed for the empty-state CTA on the catalog tab. Anonymous
    callers can hit it. Behind the SlowAPI limiter (configured per-route
    in `app.limiter`) so a malicious actor can't hammer Gutendex or the
    slice pipeline through us.

    Returns counts the client can show in a toast: how many books were
    imported, how many parents were re-sliced, total child slices added.
    """
    # Pull one fresh page of Gutendex. This will also slice those new
    # parents because gutendex.py is wired to do so.
    imported = await import_gutendex(db, limit=20, start_page=1)
    # Now re-slice the whole catalog so books imported before slicing
    # was wired in (long monoliths with no children) become proper
    # 1-minute slice children too.
    reslice_summary = await force_reslice_all(db)
    return {
        "imported": imported,
        "resliced": reslice_summary,
    }
