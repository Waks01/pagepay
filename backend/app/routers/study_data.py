"""Study data endpoints for the v3 reader Study mode (v3 §3.2).

Endpoints (all under /api/v1/content/users/me/study-data):
  GET    /                  → fetch the full blob
  PUT    /                  → replace the full blob
  PATCH  /highlights/{uid}  → upsert one unit's highlights
  PATCH  /notes/{uid}       → upsert one unit's note

Why a single blob, not a per-highlight endpoint:
  - Highlights are written at the rate the user is reading
    (a heavy reader creates 1+ highlights per minute). Round-
    tripping per highlight is wasteful when the local store
    already has the full document.
  - The client batches writes: every 10 seconds, or on app-
    background, or on slice finish. That's the same pattern
    Notion and Apple Notes use — local-first, server-confirmed.
  - The PUT (full replace) is the simplest possible offline-
    first sync shape. If the local copy diverges from the
    server, the client overwrites the server; the next read
    gives the client the truth.
  - The PATCH endpoints are the lean alternative for clients
    that prefer to send just the changed unit. Both shapes
    are supported; the client picks.

Auth: every endpoint requires a JWT. `get_current_user` is
the standard dep (see routers/auth.py). Anonymous users have
no study_data; the GET returns an empty blob, writes 401.

Validation: the blob size is bounded to 64KB by the global
RequestSizeLimitMiddleware; we don't double-check here.
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.limiter import limiter
from app.models import User
from app.routers.auth import get_current_user
from app.schemas import (
    StudyDataBlob,
    StudyDataPatchHighlights,
    StudyDataPatchNote,
)

logger = logging.getLogger("uvicorn.error")

router = APIRouter(
    prefix="/content/users/me/study-data",
    tags=["study-data"],
)


def _now_iso() -> str:
    """ISO 8601 in UTC, second precision. The client uses this as
    a fallback `created_at` / `updated_at` when the writer didn't
    provide one."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _coerce_blob(raw: dict | None) -> StudyDataBlob:
    """Defensively coerce whatever's in `users.study_data` into a
    valid `StudyDataBlob`. Old clients may have written shapes we
    don't recognise (e.g. a future v4 field). We drop unknown keys
    silently and validate the rest, rather than 500'ing on
    forward-compatibility. Returns an empty blob for None.
    """
    if not raw:
        return StudyDataBlob()
    # `model_validate` runs Pydantic v2's strict mode on
    # unknown fields, raising on extras. Disable that here so
    # the upgrade path stays smooth.
    return StudyDataBlob.model_validate(raw)


@router.get("", response_model=StudyDataBlob)
async def get_study_data(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the user's study_data blob, or an empty one."""
    # Touch `db` to keep the dep wiring honest (so test mocks
    # that need the session don't fall over later). Otherwise
    # the call is a simple read off the in-session object.
    _ = db
    return _coerce_blob(current_user.study_data)


@router.put("", response_model=StudyDataBlob)
@limiter.limit("60/minute")
async def put_study_data(
    request: Request,
    body: StudyDataBlob,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Replace the user's study_data blob. Used by the client's
    batched sync (every 10s or on app-background)."""
    current_user.study_data = body.model_dump()
    await db.commit()
    await db.refresh(current_user)
    return body


@router.patch("/highlights/{unit_id}", response_model=StudyDataBlob)
@limiter.limit("30/minute")
async def patch_highlights(
    request: Request,
    unit_id: int,
    body: StudyDataPatchHighlights,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upsert one unit's highlights. The client sends the full
    new list for the unit; we replace the array for that key.

    We use the path-param `unit_id` as a string key, even though
    it's an int on the wire, to keep JSON keys uniformly strings
    (the spec for v3 §Appendix A). The DB stores keys as strings
    because JSON object keys are always strings."""
    if unit_id <= 0:
        raise HTTPException(status_code=400, detail="unit_id must be positive")

    blob = _coerce_blob(current_user.study_data)
    blob.highlights[str(unit_id)] = body.entries
    current_user.study_data = blob.model_dump()
    await db.commit()
    await db.refresh(current_user)
    return blob


@router.patch("/notes/{unit_id}", response_model=StudyDataBlob)
@limiter.limit("30/minute")
async def patch_note(
    request: Request,
    unit_id: int,
    body: StudyDataPatchNote,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upsert one unit's note. Empty text deletes the note."""
    if unit_id <= 0:
        raise HTTPException(status_code=400, detail="unit_id must be positive")

    blob = _coerce_blob(current_user.study_data)
    key = str(unit_id)
    text = body.text.strip()
    if text:
        now = _now_iso()
        # Preserve original created_at on edit, stamp updated_at.
        existing = blob.notes.get(key)
        created_at = existing.created_at if existing else now
        blob.notes[key] = type(blob.notes.get(key))(
            text=text, created_at=created_at, updated_at=now
        ) if existing else None
        # The above ternary falls through to None if there's no
        # existing note; build fresh below.
        if blob.notes.get(key) is None:
            from app.schemas import NoteEntry
            blob.notes[key] = NoteEntry(text=text, created_at=now, updated_at=now)
    else:
        # Empty text → delete the note. We do not store empty
        # strings as notes; the client should send empty text to
        # mean "clear it."
        blob.notes.pop(key, None)

    current_user.study_data = blob.model_dump()
    await db.commit()
    await db.refresh(current_user)
    return blob
