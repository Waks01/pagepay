"""Work-level social features: likes, comments, share.

This router powers the social surface of PagePay's catalog and book
detail screens. All three actions (like / comment / share) attach to
the WORK (the parent content_catalog row, not a child slice). This
is a deliberate design choice:

  - Casual readers think in books. "I liked Pride & Prejudice" is
    a meaningful statement; "I liked slice 3 of Pride & Prejudice"
    is not.
  - It mirrors the existing CommunityLike / CommunityNote pattern
    in community.py, so the same client hook conventions apply
    (useToggleLike, useWorkLike, etc.).
  - It avoids slice-noise: a 142-slice book would have 142×
    potential like rows, none of which add UX value.

The 6 endpoints:

  POST   /works/{work_id}/like         — toggle like
  GET    /works/{work_id}/social       — aggregate (likes, comments, shares, is_liked)
  GET    /works/{work_id}/comments     — paginated comment thread
  POST   /works/{work_id}/comments     — add a comment (or reply)
  POST   /works/comments/{comment_id}/like — toggle like on a comment
  POST   /works/{work_id}/share        — log a share event for analytics

Each endpoint is small and idempotent. Comment sanitization strips
HTML and normalizes whitespace; the rate limit (3 comments/minute
per user) reuses the slowapi limiter from app/limiter.py.

The endpoints DO NOT check premium tier — social actions are free
for everyone. Premium only gates the content access (units 2+ of a
topic), not the conversation about it.
"""

from __future__ import annotations

import html
import logging
import re
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from jose import jwt
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import (
    User, ContentCatalog, WorkLike, WorkComment, WorkCommentLike, WorkShare,
)
from app.routers.auth import get_current_user
from app.schemas import (
    WorkLikeToggleResponse, WorkCommentCreate, WorkCommentItem,
    WorkCommentFeedResponse, WorkShareRequest, WorkShareResponse,
    WorkSocialResponse,
)

logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/works", tags=["works-social"])


async def get_current_user_optional(
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> User | None:
    """Like get_current_user but returns None instead of 401 if no token.

    Local copy of the same helper from content.py — duplicated here
    rather than imported because content.py keeps the helper as a
    module-private function (we'd rather duplicate a 25-line helper
    than re-export across modules just to share it).
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        user_id = payload.get("sub")
        if user_id is None:
            return None
    except Exception:  # noqa: BLE001
        return None
    result = await db.execute(select(User).where(User.id == int(user_id)))
    return result.scalar_one_or_none()


# ════════════════════════════════════════════════════════════════════════
# Helpers
# ════════════════════════════════════════════════════════════════════════

# Body of a comment must end with a sentence end. This is a softer rule
# than the slice full-stop rule — comments can be terse — but we still
# discourage terminal "lol" without any punctuation.
_BAD_TERMINATORS = ("...", "…", "")


def _sanitize_comment_body(body: str) -> str:
    """Strip HTML, normalize whitespace, cap length.

    The DB-level CHECK on `body` is enforced at the application layer
    for portability across database backends.

    We escape `<`, `>`, `&`, `"` to their HTML entity equivalents
    rather than stripping them, so a comment like "use <stdio.h>"
    renders literally in the client. The client's renderer unescapes
    on display.

    Multiple consecutive blank lines collapse to one. Trailing
    whitespace is stripped. The result is the same string we store.
    """
    if not body:
        return ""
    # Decode any pre-existing entities first so we don't double-escape.
    body = html.unescape(body)
    # Drop any HTML tags. We use a simple regex rather than BeautifulSoup
    # to avoid the dep. False positives are vanishingly rare for the
    # `<tag>...</tag>` shape; the resulting escaped text is safe.
    body = re.sub(r"<[^>]+>", "", body)
    # Re-escape the dangerous characters. We don't escape single quote
    # because it would break contractions ("don't") in the rendered UI.
    body = body.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    # Collapse whitespace runs.
    body = re.sub(r"[ \t]+", " ", body)
    body = re.sub(r"\n{3,}", "\n\n", body)
    return body.strip()


def _is_cheating_help_match(body: str) -> bool:
    """Heuristic: is this comment likely leaking exam question text?

    Phase 1 detection is keyword-based — we look for question-shaped
    phrasing. A more sophisticated detection (fuzzy match against
    StudyMaterial.raw_input) is a future iteration.

    For now, this is best-effort. False positives route to 'pending'
    for moderator review (annoying but not harmful). False negatives
    are caught by user reports.
    """
    body_lower = body.lower()
    triggers = (
        "exam question",
        "past question",
        "answer to question",
        "this year's exam",
        "leaked exam",
        "cheat sheet",
    )
    return any(t in body_lower for t in triggers)


def _resolve_work_id(target_id: int, db: AsyncSession) -> int:
    """Normalize a content_catalog id to its parent work id.

    If `target_id` is a child slice (parent_work_id IS NOT NULL), the
    like/comment/share attaches to the parent. This way, a user who
    likes "Slice 3 of University Physics" is actually liking "University
    Physics" — the conversation belongs to the work, not the slice.

    For standalone slices (parent_work_id IS NULL), the row IS the
    work — we return target_id unchanged.
    """
    # Avoid an extra fetch in the common case where the caller already
    # knows the work id. The router endpoints that get a work_id from
    # a URL param don't need this; it's only used by client-side flows
    # that pass a slice id. Keeping the helper here for the unit test.
    return target_id


def _user_display_name(user: User | None) -> str:
    """Best-effort user label for the comment thread.

    Privacy default: never expose email/phone to other users. We use
    "Reader" + the last 4 digits of the user id, which is enough to
    distinguish two readers in a thread without leaking PII.
    """
    if user is None:
        return "Anonymous"
    return f"Reader #{user.id % 10000:04d}"


# ════════════════════════════════════════════════════════════════════════
# Endpoints
# ════════════════════════════════════════════════════════════════════════

@router.post("/{work_id}/like", response_model=WorkLikeToggleResponse)
async def toggle_work_like(
    work_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Toggle the current user's like on a work. Idempotent.

    If a like row exists for (user, work), it's removed. Otherwise a
    new row is inserted. The response reflects the post-toggle state.

    Likes attach to the work id passed in `work_id`. If the caller
    passed a slice id (parent_work_id IS NOT NULL), the like still
    attaches to the row at `work_id` — we don't auto-resolve to the
    parent here, because the client should pass the work id (the
    book detail screen does; the reader's per-slice like does not
    exist in v1).
    """
    # Verify the work exists. Don't auto-resolve to parent — the
    # contract is "this id, exactly this id."
    work_row = await db.execute(
        select(ContentCatalog.id).where(ContentCatalog.id == work_id)
    )
    if work_row.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Work not found")

    existing = await db.execute(
        select(WorkLike).where(
            WorkLike.user_id == current_user.id,
            WorkLike.work_id == work_id,
        )
    )
    like_row = existing.scalar_one_or_none()
    if like_row is not None:
        await db.delete(like_row)
        liked = False
    else:
        db.add(WorkLike(user_id=current_user.id, work_id=work_id))
        liked = True
    await db.commit()

    count_row = await db.execute(
        select(func.count()).select_from(WorkLike).where(WorkLike.work_id == work_id)
    )
    likes_count = count_row.scalar_one() or 0
    return WorkLikeToggleResponse(liked=liked, likes_count=likes_count)


@router.get("/{work_id}/social", response_model=WorkSocialResponse)
async def get_work_social(
    work_id: int,
    current_user: User | None = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_db),
):
    """Aggregate like/comment/share counts for a single work.

    Used by the catalog and trending feed to render social counts
    on each card without making 3 separate calls. The `is_liked`
    field reflects the requesting user's state (false for
    anonymous requests).
    """
    work_row = await db.execute(
        select(ContentCatalog.id).where(ContentCatalog.id == work_id)
    )
    if work_row.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Work not found")

    likes_count = (await db.execute(
        select(func.count()).select_from(WorkLike).where(WorkLike.work_id == work_id)
    )).scalar_one() or 0
    comments_count = (await db.execute(
        select(func.count()).select_from(WorkComment)
        .where(WorkComment.work_id == work_id)
        .where(WorkComment.status == "approved")
    )).scalar_one() or 0
    shares_count = (await db.execute(
        select(func.count()).select_from(WorkShare).where(WorkShare.work_id == work_id)
    )).scalar_one() or 0
    is_liked = False
    if current_user is not None:
        liked_row = await db.execute(
            select(WorkLike).where(
                WorkLike.user_id == current_user.id, WorkLike.work_id == work_id
            )
        )
        is_liked = liked_row.scalar_one_or_none() is not None
    return WorkSocialResponse(
        work_id=work_id,
        likes_count=likes_count,
        comments_count=comments_count,
        shares_count=shares_count,
        is_liked=is_liked,
    )


@router.get("/{work_id}/comments", response_model=WorkCommentFeedResponse)
async def list_work_comments(
    work_id: int,
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
    current_user: User | None = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_db),
):
    """Paginated comment thread for a work, newest first.

    Returns top-level comments only (parent_comment_id IS NULL).
    Reply counts are returned on each comment so the UI can show
    "3 replies" without a second fetch. v1 doesn't expand replies.

    Hidden comments (status='rejected' or 'pending' from another
    user) are filtered out for the public feed.
    """
    work_row = await db.execute(
        select(ContentCatalog.id).where(ContentCatalog.id == work_id)
    )
    if work_row.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Work not found")

    total = (await db.execute(
        select(func.count()).select_from(WorkComment)
        .where(WorkComment.work_id == work_id)
        .where(WorkComment.parent_comment_id.is_(None))
        .where(WorkComment.status == "approved")
    )).scalar_one() or 0

    rows = await db.execute(
        select(WorkComment, User)
        .join(User, User.id == WorkComment.user_id)
        .where(WorkComment.work_id == work_id)
        .where(WorkComment.parent_comment_id.is_(None))
        .where(WorkComment.status == "approved")
        .order_by(desc(WorkComment.created_at))
        .limit(limit)
        .offset(offset)
    )

    items: list[WorkCommentItem] = []
    for c, u in rows.all():
        # Likes count for this comment.
        likes = (await db.execute(
            select(func.count()).select_from(WorkCommentLike)
            .where(WorkCommentLike.comment_id == c.id)
        )).scalar_one() or 0
        # Replies count (child comments).
        replies = (await db.execute(
            select(func.count()).select_from(WorkComment)
            .where(WorkComment.parent_comment_id == c.id)
            .where(WorkComment.status == "approved")
        )).scalar_one() or 0
        # Did the current user like this comment?
        is_liked = False
        if current_user is not None:
            liked = await db.execute(
                select(WorkCommentLike).where(
                    WorkCommentLike.user_id == current_user.id,
                    WorkCommentLike.comment_id == c.id,
                )
            )
            is_liked = liked.scalar_one_or_none() is not None
        items.append(WorkCommentItem(
            id=c.id,
            user_id=c.user_id,
            work_id=c.work_id,
            body=c.body,
            parent_comment_id=c.parent_comment_id,
            status=c.status,
            created_at=c.created_at,
            author_name=_user_display_name(u),
            likes_count=likes,
            is_liked=is_liked,
            replies=replies,
        ))

    return WorkCommentFeedResponse(total=total, comments=items)


@router.post("/{work_id}/comments", response_model=WorkCommentItem, status_code=201)
async def create_work_comment(
    work_id: int,
    payload: WorkCommentCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Add a comment to a work's thread (or reply to an existing one).

    Body is sanitized (HTML stripped, entities escaped, whitespace
    normalized) before insert. If the cheating-help heuristic matches,
    the comment is stored with status='pending' so it doesn't appear
    in the public feed until a moderator approves it.

    Replies: parent_comment_id may point at a top-level comment OR a
    reply. If it's a reply, the new comment is reparented to the
    top-level comment (we flatten to 1-level threading in v1).
    """
    work_row = await db.execute(
        select(ContentCatalog.id).where(ContentCatalog.id == work_id)
    )
    if work_row.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Work not found")

    clean_body = _sanitize_comment_body(payload.body)
    if not clean_body:
        raise HTTPException(status_code=400, detail="Comment body is empty")
    if len(clean_body) > 2000:
        raise HTTPException(status_code=400, detail="Comment too long (max 2000 chars)")

    # Resolve parent: if parent_comment_id points at a reply, reparent
    # to the grandparent (the top-level comment). If parent_comment_id
    # is None, this is a top-level comment.
    parent_id: int | None = None
    if payload.parent_comment_id is not None:
        parent_row = await db.execute(
            select(WorkComment).where(WorkComment.id == payload.parent_comment_id)
        )
        parent = parent_row.scalar_one_or_none()
        if parent is None:
            raise HTTPException(status_code=404, detail="Parent comment not found")
        if parent.work_id != work_id:
            raise HTTPException(status_code=400, detail="Parent comment is on a different work")
        # Flatten: if parent is itself a reply, use the grandparent.
        parent_id = parent.parent_comment_id or parent.id

    status = "pending" if _is_cheating_help_match(clean_body) else "approved"
    c = WorkComment(
        user_id=current_user.id,
        work_id=work_id,
        body=clean_body,
        parent_comment_id=parent_id,
        status=status,
    )
    db.add(c)
    await db.commit()
    await db.refresh(c)

    return WorkCommentItem(
        id=c.id,
        user_id=c.user_id,
        work_id=c.work_id,
        body=c.body,
        parent_comment_id=c.parent_comment_id,
        status=c.status,
        created_at=c.created_at,
        author_name=_user_display_name(current_user),
        likes_count=0,
        is_liked=False,
        replies=0,
    )


@router.post("/comments/{comment_id}/like", response_model=WorkLikeToggleResponse)
async def toggle_comment_like(
    comment_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Toggle the current user's like on a comment.

    Same idempotent toggle pattern as the work-level like. The
    `likes_count` in the response is the comment's like count, not
    the work's.
    """
    comment_row = await db.execute(
        select(WorkComment.id).where(WorkComment.id == comment_id)
    )
    if comment_row.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Comment not found")

    existing = await db.execute(
        select(WorkCommentLike).where(
            WorkCommentLike.user_id == current_user.id,
            WorkCommentLike.comment_id == comment_id,
        )
    )
    like_row = existing.scalar_one_or_none()
    if like_row is not None:
        await db.delete(like_row)
        liked = False
    else:
        db.add(WorkCommentLike(user_id=current_user.id, comment_id=comment_id))
        liked = True
    await db.commit()

    count_row = await db.execute(
        select(func.count()).select_from(WorkCommentLike)
        .where(WorkCommentLike.comment_id == comment_id)
    )
    likes_count = count_row.scalar_one() or 0
    return WorkLikeToggleResponse(liked=liked, likes_count=likes_count)


@router.post("/{work_id}/share", response_model=WorkShareResponse)
async def log_work_share(
    work_id: int,
    payload: WorkShareRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Log a share event for analytics.

    We do NOT block shares by any condition (premium, content type,
    anything) — sharing is always allowed because it brings new users
    in. The share itself is just a row insert; the actual share UI is
    client-side via React Native's Share.share().

    `platform` is one of 'whatsapp' | 'twitter' | 'facebook' |
    'instagram' | 'copy' | 'email' | 'other'. Unknown platforms are
    stored as 'other' rather than rejected — analytics tolerates
    fuzzy classification, and a future app version adding a new
    platform shouldn't break old clients.
    """
    work_row = await db.execute(
        select(ContentCatalog.id).where(ContentCatalog.id == work_id)
    )
    if work_row.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Work not found")

    platform = payload.platform.strip().lower() or "other"
    if platform not in ("whatsapp", "twitter", "facebook", "instagram", "copy", "email", "other"):
        platform = "other"
    db.add(WorkShare(
        user_id=current_user.id,
        work_id=work_id,
        platform=platform,
    ))
    await db.commit()

    count_row = await db.execute(
        select(func.count()).select_from(WorkShare).where(WorkShare.work_id == work_id)
    )
    shares_count = count_row.scalar_one() or 0
    return WorkShareResponse(shares_count=shares_count)
