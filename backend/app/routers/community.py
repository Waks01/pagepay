"""Community notes feed endpoints.

POST /community/upload   — create a note (status=pending, auth required)
GET  /community/feed     — paginated list of approved notes
POST /community/{id}/like — toggle like on a note
"""

import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User, CommunityNote, CommunityLike
from app.routers.auth import get_current_user
from app.schemas import CommunityNoteCreate, CommunityNoteOut, CommunityFeedItem

logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/community", tags=["community"])


@router.post("/upload", response_model=CommunityNoteOut, status_code=201)
async def upload_note(
    payload: CommunityNoteCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload a community study note. Defaults to pending moderation."""
    note = CommunityNote(
        user_id=current_user.id,
        title=payload.title,
        content=payload.content,
        course_code=payload.course_code,
        university=payload.university,
        status="pending",
    )
    db.add(note)
    await db.commit()
    await db.refresh(note)
    return CommunityNoteOut(
        id=note.id,
        user_id=note.user_id,
        title=note.title,
        content=note.content,
        course_code=note.course_code,
        university=note.university,
        status=note.status,
        likes_count=note.likes_count,
        created_at=note.created_at,
        author_name=f"{current_user.email or current_user.phone or 'Anonymous'}",
    )


@router.get("/feed", response_model=list[CommunityFeedItem])
async def get_community_feed(
    course_code: str | None = Query(None),
    sort: str = Query("recent", pattern="^(popular|recent)$"),
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
    current_user: User | None = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Paginated feed of approved community notes.

    Filters: `?course_code=CSC201`
    Sort: `?sort=popular` (most liked) or `?sort=recent` (newest)
    """
    query = select(CommunityNote, User.id).join(
        User, CommunityNote.user_id == User.id
    ).where(CommunityNote.status == "approved")

    if course_code:
        query = query.where(CommunityNote.course_code == course_code)

    if sort == "popular":
        query = query.order_by(desc(CommunityNote.likes_count), desc(CommunityNote.created_at))
    else:
        query = query.order_by(desc(CommunityNote.created_at))

    query = query.limit(limit).offset(offset)
    rows = await db.execute(query)
    results = rows.all()

    out: list[CommunityFeedItem] = []
    for note, user_id in results:
        is_liked = False
        if current_user:
            liked_row = await db.execute(
                select(CommunityLike).where(
                    CommunityLike.note_id == note.id,
                    CommunityLike.user_id == current_user.id,
                )
            )
            is_liked = liked_row.scalar_one_or_none() is not None

        author_name = f"Student #{user_id}"
        out.append(CommunityFeedItem(
            id=note.id,
            title=note.title,
            content=note.content,
            course_code=note.course_code,
            university=note.university,
            likes_count=note.likes_count,
            created_at=note.created_at,
            author_name=author_name,
            is_liked=is_liked,
        ))

    return out


@router.post("/{note_id}/like", response_model=dict)
async def toggle_like(
    note_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Toggle like on a community note. Returns `{liked: bool, likes_count: int}`."""
    note_row = await db.execute(select(CommunityNote).where(CommunityNote.id == note_id))
    note = note_row.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    existing = await db.execute(
        select(CommunityLike).where(
            CommunityLike.note_id == note_id,
            CommunityLike.user_id == current_user.id,
        )
    )
    like = existing.scalar_one_or_none()

    if like:
        await db.delete(like)
        note.likes_count = max(0, (note.likes_count or 0) - 1)
        liked = False
    else:
        db.add(CommunityLike(user_id=current_user.id, note_id=note_id))
        note.likes_count = (note.likes_count or 0) + 1
        liked = True

    await db.commit()
    await db.refresh(note)
    return {"liked": liked, "likes_count": note.likes_count}
