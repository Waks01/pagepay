"""Reading-progress endpoints.

The user opens the app. We tell them where to read next via
GET /api/v1/progress/continue. As they scroll within a slice, the reader
saves scroll position via POST /api/v1/progress/bookmark. When they
finish a slice (or navigate to the next one), POST /api/v1/progress/finish
bumps the pointer to the next slice in the work.

If the user has no in-progress work, `continue` returns
`has_in_progress=False` and the client should show fresh content from the
catalog instead.
"""

import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select, update

from app.database import get_db
from app.models import User, ContentCatalog, ReadingProgress, SliceBookmark, ReadingUnit
from app.routers.auth import get_current_user
from app.schemas import (
    ContinueReading, WorkProgress, BookmarkSave,
    ReadingUnitItem, ReadingUnitListResponse,
    FinishSliceBody,
)

router = APIRouter(prefix="/progress", tags=["progress"])
logger = logging.getLogger("uvicorn.error")


# ── Unit-locking helper ──────────────────────────────────────────────
# Education content (OpenStax) has a per-topic unlock sequence: unit 1
# of every topic is always free; units 2+ require either (a) the user
# has premium tier, or (b) the user has completed all previous units
# in the slice. This function encapsulates that rule so the unit
# listing endpoint and the unit-finish endpoint agree.
def _is_unit_unlocked(
    unit_order: int,
    completed_unit_orders: set[int],
    user_tier,
) -> tuple[bool, str | None]:
    """Return (is_unlocked, unlock_reason). unlock_reason is a UI hint.

    unit_order: the unit_order value of the unit being queried.
    completed_unit_orders: the set of unit_order values the user has
        already completed for this slice. In v1 we approximate this
        by reading current_unit_order on the work's ReadingProgress
        row: all orders < current_unit_order are treated as completed.
    user_tier: the User's tier enum value (FREE / PREMIUM_*).

    Rules:
      - Unit 1 of every topic is always unlocked.
      - Units 2+ unlock if the user has premium tier.
      - Units 2+ also unlock if the user has completed the previous
        unit in this slice (i.e. (unit_order - 1) ∈ completed).
    """
    if unit_order == 1:
        return True, None
    # Premium tier bypasses the lock. The tier column is a SQLAlchemy
    # Enum whose .value is the string ('free' | 'premium_monthly' |
    # 'premium_yearly'). Both premium variants unlock units.
    if user_tier is not None and str(user_tier.value).startswith("premium"):
        return True, None
    # Sequential unlock: did the user complete the previous unit?
    if (unit_order - 1) in completed_unit_orders:
        return True, None
    return False, "complete_previous"


@router.get("/continue", response_model=ContinueReading)
async def get_continue_reading(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """What should the user read next?

    Looks up the user's most recently active in-progress work. Returns
    the slice they should resume (or start if they're at slice 1). If
    the user has no in-progress work, returns `has_in_progress=False` so
    the client can show the catalog.
    """
    # Find the user's most recent in-progress work.
    rp_row = await db.execute(
        select(ReadingProgress)
        .where(ReadingProgress.user_id == current_user.id)
        .where(ReadingProgress.is_finished == False)  # noqa: E712
        # PostgreSQL supports NULLS LAST natively; kept as two-key sort
        # for cross-DB compatibility if needed in the future.
        .order_by(ReadingProgress.last_read_at.is_(None).asc(), ReadingProgress.last_read_at.desc())
        .limit(1)
    )
    rp = rp_row.scalar_one_or_none()

    if rp is None:
        return ContinueReading(
            slice_id=None,
            work_id=None,
            work_title=None,
            slice_title=None,
            slice_order=0,
            total_slices=0,
            percent_complete=0,
            has_in_progress=False,
            scroll_offset_px=0,
        )

    # Look up the current slice (or the first slice if pointer is unset).
    slice_id = rp.current_slice_id
    if slice_id is None:
        # Pointer was never set — try to use current_slice_order if
        # we have one, so we don't reset progress for legacy rows
        # that have a valid order but no slice id.
        if rp.current_slice_order:
            ordered_slice = await db.execute(
                select(ContentCatalog)
                .where(ContentCatalog.parent_work_id == rp.work_id)
                .where(ContentCatalog.read_order == rp.current_slice_order)
                .limit(1)
            )
            ordered = ordered_slice.scalar_one_or_none()
            if ordered is not None:
                slice_id = ordered.id
        if slice_id is None:
            # Still nothing — point to the first slice of the work.
            first_slice = await db.execute(
                select(ContentCatalog)
                .where(ContentCatalog.parent_work_id == rp.work_id)
                .where(ContentCatalog.read_order == 1)
                .limit(1)
            )
            first = first_slice.scalar_one_or_none()
            if first is None:
                # Work has no slices? Shouldn't happen post-slicing, but be safe.
                raise HTTPException(status_code=500, detail="Work has no slices")
            slice_id = first.id
            rp.current_slice_order = 1
        await db.execute(
            update(ReadingProgress)
            .where(ReadingProgress.id == rp.id)
            .values(current_slice_id=slice_id, current_slice_order=rp.current_slice_order)
        )
        await db.commit()

    # Resolve the slice row for title etc.
    slice_row = await db.execute(select(ContentCatalog).where(ContentCatalog.id == slice_id))
    slice_obj = slice_row.scalar_one_or_none()
    if slice_obj is None:
        # Pointer is stale (slice was deleted?). Treat as no progress.
        return ContinueReading(
            slice_id=None, work_id=None, work_title=None, slice_title=None,
            slice_order=0, total_slices=0, percent_complete=0,
            has_in_progress=False, scroll_offset_px=0,
        )

    # Work title is the parent's title (parent_work_id on the slice is the work).
    work_row = await db.execute(select(ContentCatalog).where(ContentCatalog.id == rp.work_id))
    work = work_row.scalar_one_or_none()

    # Look up any saved bookmark within this slice.
    bm_row = await db.execute(
        select(SliceBookmark.scroll_offset_px)
        .where(SliceBookmark.user_id == current_user.id)
        .where(SliceBookmark.slice_id == slice_id)
        .limit(1)
    )
    scroll_offset = bm_row.scalar_one_or_none() or 0

    percent = (
        int((rp.slices_completed / rp.total_slices) * 100) if rp.total_slices > 0 else 0
    )

    return ContinueReading(
        slice_id=slice_id,
        work_id=rp.work_id,
        work_title=work.title if work else None,
        slice_title=slice_obj.title,
        slice_order=rp.current_slice_order,
        total_slices=rp.total_slices,
        percent_complete=min(100, percent),
        has_in_progress=True,
        scroll_offset_px=scroll_offset,
        # v3 §3.4: surface the user's last-picked reader mode so the
        # reader opens in the right mode without a flash of the
        # default. rp.reader_mode is guaranteed by the model
        # default; never None in practice.
        reader_mode=rp.reader_mode,
    )


@router.get("", response_model=list[WorkProgress])
async def list_in_progress(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """All works the user has started but not finished.

    Powers a "Continue reading" section on the home screen — shows
    every in-progress work as a card, newest first.
    """
    rows = await db.execute(
        select(ReadingProgress, ContentCatalog.title, ContentCatalog.author)
        .join(ContentCatalog, ContentCatalog.id == ReadingProgress.work_id)
        .where(ReadingProgress.user_id == current_user.id)
        .where(ReadingProgress.is_finished == False)  # noqa: E712
        .order_by(ReadingProgress.last_read_at.is_(None).asc(), ReadingProgress.last_read_at.desc())
    )
    out: list[WorkProgress] = []

    slice_ids = [rp.current_slice_id for rp, _, _ in rows.all() if rp.current_slice_id]
    slice_titles: dict[int, str] = {}
    if slice_ids:
        slice_rows = await db.execute(
            select(ContentCatalog.id, ContentCatalog.title).where(ContentCatalog.id.in_(slice_ids))
        )
        for sid, stitle in slice_rows.all():
            slice_titles[sid] = stitle

    for rp, work_title, work_author in rows.all():
        slice_title = f"{work_title} — Part {rp.current_slice_order}"
        if rp.current_slice_id and rp.current_slice_id in slice_titles:
            slice_title = slice_titles[rp.current_slice_id]
        percent = (
            int((rp.slices_completed / rp.total_slices) * 100)
            if rp.total_slices > 0 else 0
        )
        out.append(
            WorkProgress(
                work_id=rp.work_id,
                work_title=work_title,
                slice_title=slice_title,
                slice_order=rp.current_slice_order,
                current_slice_id=rp.current_slice_id,
                total_slices=rp.total_slices,
                slices_completed=rp.slices_completed,
                percent_complete=min(100, percent),
                is_finished=rp.is_finished,
                last_read_at=rp.last_read_at,
                author=work_author,
            )
        )
    return out


@router.post("/bookmark")
async def save_bookmark(
    payload: BookmarkSave,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Save scroll offset within a slice. Idempotent: latest write wins.

    The reader calls this every ~5s while scrolling. We update in place
    rather than insert a new row — one bookmark per (user, slice).
    """
    existing = await db.execute(
        select(SliceBookmark)
        .where(SliceBookmark.user_id == current_user.id)
        .where(SliceBookmark.slice_id == payload.slice_id)
    )
    bm = existing.scalar_one_or_none()
    if bm is None:
        db.add(
            SliceBookmark(
                user_id=current_user.id,
                slice_id=payload.slice_id,
                scroll_offset_px=payload.scroll_offset_px,
            )
        )
    else:
        bm.scroll_offset_px = payload.scroll_offset_px
        bm.updated_at = datetime.utcnow()
    await db.commit()
    return {"ok": True}


@router.post("/finish")
async def finish_slice(
    slice_id: int,
    body: "FinishSliceBody | None" = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mark a slice as completed and advance to the next slice.

    Called when:
      - User taps "Next slice" / "Done" button after finishing one
      - Server detects scroll-bottom reached + dwell time exceeded
        (Phase 1.5 — auto-finish on scroll completion)

    If this was the last slice in the work, marks the work finished.

    The optional body carries `reader_mode` so the v3 mode switcher
    can persist per-work preferences. Sending a mode on every finish
    is a small write but cheap; we only update the column when the
    value differs to avoid a useless write.
    """
    # Look up the slice to find its parent work.
    slice_row = await db.execute(select(ContentCatalog).where(ContentCatalog.id == slice_id))
    slice_obj = slice_row.scalar_one_or_none()
    if slice_obj is None:
        raise HTTPException(status_code=404, detail="Slice not found")
    if slice_obj.parent_work_id is None:
        # Standalone slice (not part of a work) — nothing to track.
        return {"ok": True, "is_finished": True, "next_slice_id": None}

    work_id = slice_obj.parent_work_id

    # Get or create progress row for this work.
    rp_row = await db.execute(
        select(ReadingProgress)
        .where(ReadingProgress.user_id == current_user.id)
        .where(ReadingProgress.work_id == work_id)
    )
    rp = rp_row.scalar_one_or_none()

    # Total slices snapshot (set on first finish).
    if rp is None:
        total_count_row = await db.execute(
            select(func.count(ContentCatalog.id))
            .where(ContentCatalog.parent_work_id == work_id)
        )
        total_count = total_count_row.scalar_one()
        rp = ReadingProgress(
            user_id=current_user.id,
            work_id=work_id,
            current_slice_order=1,
            slices_completed=0,
            total_slices=total_count,
            is_finished=False,
            last_read_at=datetime.utcnow(),
            # Persist the reader's preferred mode on first-finish so
            # the very next slice opens in the same mode. Default
            # 'read' matches the DB column default.
            reader_mode=(body.reader_mode if body and body.reader_mode else "read"),
        )
        db.add(rp)
        await db.flush()
    elif body and body.reader_mode and body.reader_mode != rp.reader_mode:
        # Update only when the value actually differs — saves a
        # useless UPDATE round-trip and keeps the column a clean
        # audit of the user's last-picked mode per work.
        rp.reader_mode = body.reader_mode

    # Find the next slice by order.
    next_slice_row = await db.execute(
        select(ContentCatalog)
        .where(ContentCatalog.parent_work_id == work_id)
        .where(ContentCatalog.read_order == slice_obj.read_order + 1)
    )
    next_slice = next_slice_row.scalar_one_or_none()

    # Update progress: bump counter, advance pointer, set last_read_at.
    rp.slices_completed = min(rp.total_slices, rp.slices_completed + 1)
    rp.last_read_at = datetime.utcnow()

    if next_slice is None:
        rp.is_finished = True
        rp.current_slice_id = None
        await db.commit()
        return {"ok": True, "is_finished": True, "next_slice_id": None}

    rp.current_slice_id = next_slice.id
    rp.current_slice_order = next_slice.read_order
    await db.commit()
    return {
        "ok": True,
        "is_finished": False,
        "next_slice_id": next_slice.id,
        "next_slice_title": next_slice.title,
    }


@router.post("/start")
async def start_work(
    work_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Begin tracking a work for the user. No-op if already tracking.

    Idempotent — calling twice is fine. Use this when a user taps
    "Read" on a work from the catalog so we can resume them later.
    """
    work_row = await db.execute(select(ContentCatalog).where(ContentCatalog.id == work_id))
    work = work_row.scalar_one_or_none()
    if work is None:
        raise HTTPException(status_code=404, detail="Work not found")

    rp_row = await db.execute(
        select(ReadingProgress)
        .where(ReadingProgress.user_id == current_user.id)
        .where(ReadingProgress.work_id == work_id)
    )
    rp = rp_row.scalar_one_or_none()
    if rp is not None:
        return {"ok": True, "already_tracked": True, "work_id": work_id}

    total_count_row = await db.execute(
        select(func.count(ContentCatalog.id))
        .where(ContentCatalog.parent_work_id == work_id)
    )
    total_count = total_count_row.scalar_one()

    db.add(
        ReadingProgress(
            user_id=current_user.id,
            work_id=work_id,
            current_slice_id=None,
            current_slice_order=1,
            slices_completed=0,
            total_slices=total_count,
            is_finished=False,
            last_read_at=datetime.utcnow(),
        )
    )
    await db.commit()
    return {"ok": True, "already_tracked": False, "work_id": work_id}


# ════════════════════════════════════════════════════════════════════════
# Education unit endpoints (Phase: OpenStax integration)
# ════════════════════════════════════════════════════════════════════════


@router.get("/units/{slice_id}", response_model=ReadingUnitListResponse)
async def list_slice_units(
    slice_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List the reading units for a topic slice, with lock state.

    Returns every unit in the slice in unit_order sequence, each
    annotated with is_unlocked, is_completed, and a human-readable
    unlock_reason. The reader uses this to decide which unit to
    render next, and to render the locked-unit upsell card.

    For casual reader content (gutendex/gnews), each slice has
    exactly 1 unit, and the unit is always unlocked. The reader
    doesn't need to call this endpoint for those — but if it does,
    the result is the expected single-unit list.
    """
    # Verify the slice exists.
    slice_row = await db.execute(
        select(ContentCatalog).where(ContentCatalog.id == slice_id)
    )
    slice_obj = slice_row.scalar_one_or_none()
    if slice_obj is None:
        raise HTTPException(status_code=404, detail="Slice not found")

    # Fetch all units for the slice, ordered by unit_order.
    units_rows = await db.execute(
        select(ReadingUnit)
        .where(ReadingUnit.slice_id == slice_id)
        .order_by(ReadingUnit.unit_order)
    )
    units = units_rows.scalars().all()

    # If there are no units, this is a casual reader slice. We
    # synthesize a single unit from the slice's body_text so the
    # reader's unit-aware flow has something to render. The unit
    # has total_units=1 and unit_order=1, so it's always unlocked.
    if not units and slice_obj.body_text:
        synthesized = ReadingUnitItem(
            id=-1,  # sentinel; reader treats this as "no DB row"
            unit_order=1,
            total_units=1,
            is_unlocked=True,
            is_completed=False,
            estimated_read_minutes=max(1, slice_obj.estimated_read_minutes or 1),
            unlock_reason=None,
        )
        return ReadingUnitListResponse(slice_id=slice_id, units=[synthesized])

    # Determine the user's completed-unit set from their progress row
    # for the parent work. current_unit_order is the next unit the
    # user should read; everything below it is completed.
    completed: set[int] = set()
    if slice_obj.parent_work_id is not None:
        rp_row = await db.execute(
            select(ReadingProgress).where(
                ReadingProgress.user_id == current_user.id,
                ReadingProgress.work_id == slice_obj.parent_work_id,
            )
        )
        rp = rp_row.scalar_one_or_none()
        if rp is not None and rp.current_unit_order is not None:
            completed = set(range(1, rp.current_unit_order))

    items: list[ReadingUnitItem] = []
    for u in units:
        is_unlocked, reason = _is_unit_unlocked(
            u.unit_order, completed, current_user.tier
        )
        is_completed = u.unit_order in completed
        items.append(ReadingUnitItem(
            id=u.id,
            unit_order=u.unit_order,
            total_units=u.total_units,
            is_unlocked=is_unlocked,
            is_completed=is_completed,
            estimated_read_minutes=u.estimated_read_minutes,
            unlock_reason=reason,
        ))
    return ReadingUnitListResponse(slice_id=slice_id, units=items)


@router.post("/units/{unit_id}/finish")
async def finish_unit(
    unit_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mark a reading unit as completed and advance the progress pointer.

    For casual reader content (gutendex/gnews), this endpoint isn't
    called — the existing /progress/finish handles those slices
    directly. For education content, the reader calls this endpoint
    when the user finishes a unit. The next unit (if any) becomes
    available immediately if the user has completed the current one.

    Premium tier also unlocks the next unit even if the user hasn't
    finished the current one. The unit-finish call is always
    idempotent — finishing an already-completed unit is a no-op.
    """
    # Fetch the unit. If unit_id is -1 (synthesized casual reader
    # unit), we route to the existing /progress/finish behavior.
    if unit_id == -1:
        # Synthesized unit — no DB row. The caller is a casual reader
        # slice that hasn't been broken into units. We treat this as
        # "the slice is finished" and call into the existing flow.
        # Note: the client should not normally hit this path because
        # the reader renders casual reader slices without calling
        # /units; this is a safety net.
        return {"ok": True, "is_synthesized": True}

    unit_row = await db.execute(
        select(ReadingUnit).where(ReadingUnit.id == unit_id)
    )
    unit = unit_row.scalar_one_or_none()
    if unit is None:
        raise HTTPException(status_code=404, detail="Unit not found")

    slice_row = await db.execute(
        select(ContentCatalog).where(ContentCatalog.id == unit.slice_id)
    )
    slice_obj = slice_row.scalar_one_or_none()
    if slice_obj is None or slice_obj.parent_work_id is None:
        # Standalone slice (no parent). Nothing to track.
        return {"ok": True, "is_finished": True, "next_unit_id": None}

    work_id = slice_obj.parent_work_id

    # Get or create the progress row for this work.
    rp_row = await db.execute(
        select(ReadingProgress).where(
            ReadingProgress.user_id == current_user.id,
            ReadingProgress.work_id == work_id,
        )
    )
    rp = rp_row.scalar_one_or_none()
    if rp is None:
        # Lazy-create. total_units isn't known yet; we just snapshot
        # the slice count and the unit pointer on the first finish.
        total_slices = (await db.execute(
            select(ContentCatalog.id).where(ContentCatalog.parent_work_id == work_id)
        )).scalars().all()
        rp = ReadingProgress(
            user_id=current_user.id,
            work_id=work_id,
            current_slice_id=unit.slice_id,
            current_slice_order=slice_obj.read_order or 1,
            slices_completed=0,
            total_slices=len(total_slices),
            is_finished=False,
            last_read_at=datetime.utcnow(),
        )
        db.add(rp)
        await db.flush()

    # Advance the unit pointer. If the user is finishing unit N, the
    # next unread unit is N+1 (or the first unit of the next slice if
    # this was the last unit in the slice).
    rp.current_unit_id = unit.id
    rp.current_unit_order = unit.unit_order
    rp.last_read_at = datetime.utcnow()

    # Is there a next unit in this slice?
    next_unit_row = await db.execute(
        select(ReadingUnit)
        .where(ReadingUnit.slice_id == unit.slice_id)
        .where(ReadingUnit.unit_order == unit.unit_order + 1)
    )
    next_unit = next_unit_row.scalar_one_or_none()

    if next_unit is not None:
        # Still have units in this slice. Stay on this slice.
        rp.current_unit_id = next_unit.id
        rp.current_unit_order = next_unit.unit_order
        await db.commit()
        return {
            "ok": True,
            "next_unit_id": next_unit.id,
            "next_slice_id": unit.slice_id,
            "is_slice_finished": False,
        }

    # No more units in this slice. Advance to the next slice in the
    # work (if any). Bump the slice completion counter.
    rp.slices_completed = min(rp.total_slices, rp.slices_completed + 1)

    next_slice_row = await db.execute(
        select(ContentCatalog)
        .where(ContentCatalog.parent_work_id == work_id)
        .where(ContentCatalog.read_order == (slice_obj.read_order or 0) + 1)
    )
    next_slice = next_slice_row.scalar_one_or_none()

    if next_slice is None:
        rp.is_finished = True
        rp.current_slice_id = None
        rp.current_unit_id = None
        rp.current_unit_order = None
        await db.commit()
        return {
            "ok": True,
            "next_unit_id": None,
            "next_slice_id": None,
            "is_slice_finished": True,
            "is_work_finished": True,
        }

    # Find the first unit of the next slice (it exists; we just
    # finished the previous slice's last unit, so the next slice was
    # already created with units).
    first_unit_row = await db.execute(
        select(ReadingUnit)
        .where(ReadingUnit.slice_id == next_slice.id)
        .where(ReadingUnit.unit_order == 1)
    )
    first_unit = first_unit_row.scalar_one_or_none()
    rp.current_slice_id = next_slice.id
    rp.current_slice_order = next_slice.read_order
    rp.current_unit_id = first_unit.id if first_unit else None
    rp.current_unit_order = 1 if first_unit else None
    await db.commit()
    return {
        "ok": True,
        "next_unit_id": first_unit.id if first_unit else None,
        "next_slice_id": next_slice.id,
        "is_slice_finished": True,
        "is_work_finished": False,
    }
