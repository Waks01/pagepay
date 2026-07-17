"""Community notes moderation endpoints.

Review and moderate user-submitted study notes. Manage publication workflow:
pending → approved/rejected. Delete violating content (copyright, illegal).
Track all moderation decisions in audit logs.
"""

import logging
import json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import CommunityNote, User, AdminUser, AdminAuditLog
from app.services.admin_auth import require_permission

logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/community", tags=["admin-community"])


# ── Helpers ─────────────────────────────────────────────────────────


def _log_admin_action(
    admin_id: int | None,
    admin_email: str | None,
    action: str,
    target_type: str,
    target_id: int | None,
    changes: dict | None,
    ip: str | None = None,
    result: str = "success",
    error: str | None = None,
):
    """Create an audit log entry for admin actions."""
    return AdminAuditLog(
        admin_id=admin_id,
        admin_email=admin_email,
        action=action,
        target_type=target_type,
        target_id=target_id,
        changes=json.dumps(changes) if changes else None,
        ip_address=ip,
        result=result,
        error_message=error,
    )


# ── Community Notes Listing ─────────────────────────────────────────


@router.get("/notes/pending")
async def list_pending_notes(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    current_admin: AdminUser = Depends(require_permission("community.moderate")),
    db: AsyncSession = Depends(get_db),
):
    """List pending community notes awaiting moderation."""
    query = (
        select(CommunityNote)
        .where(CommunityNote.status == "pending")
        .order_by(CommunityNote.created_at.desc())
    )
    
    total = (
        await db.execute(select(func.count()).select_from(query.subquery()))
    ).scalar_one()
    rows = await db.execute(query.limit(limit).offset((page - 1) * limit))

    items = []
    for note in rows.scalars().all():
        # Get user email
        user_result = await db.execute(
            select(User).where(User.id == note.user_id)
        )
        user = user_result.scalar_one_or_none()

        items.append({
            "id": note.id,
            "user_id": note.user_id,
            "user_email": user.email if user else None,
            "title": note.title,
            "content": note.content,
            "course_code": note.course_code,
            "university": note.university,
            "status": note.status,
            "likes_count": note.likes_count,
            "created_at": note.created_at.isoformat(),
            "updated_at": note.updated_at.isoformat(),
        })

    return {"items": items, "total": int(total), "page": page, "limit": limit}


@router.get("/notes")
async def list_all_notes(
    status: str = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    current_admin: AdminUser = Depends(require_permission("community.view")),
    db: AsyncSession = Depends(get_db),
):
    """List all community notes with optional status filter."""
    query = select(CommunityNote)
    if status:
        query = query.where(CommunityNote.status == status)
    query = query.order_by(CommunityNote.created_at.desc())

    total = (
        await db.execute(select(func.count()).select_from(query.subquery()))
    ).scalar_one()
    rows = await db.execute(query.limit(limit).offset((page - 1) * limit))

    items = []
    for note in rows.scalars().all():
        # Get user email
        user_result = await db.execute(
            select(User).where(User.id == note.user_id)
        )
        user = user_result.scalar_one_or_none()

        items.append({
            "id": note.id,
            "user_id": note.user_id,
            "user_email": user.email if user else None,
            "title": note.title,
            "content": (
                note.content[:200] + "..."
                if len(note.content) > 200 else note.content
            ),
            "course_code": note.course_code,
            "university": note.university,
            "status": note.status,
            "likes_count": note.likes_count,
            "created_at": note.created_at.isoformat(),
            "updated_at": note.updated_at.isoformat(),
        })

    return {"items": items, "total": int(total), "page": page, "limit": limit}


@router.get("/notes/{note_id}")
async def get_note_detail(
    note_id: int,
    current_admin: AdminUser = Depends(require_permission("community.view")),
    db: AsyncSession = Depends(get_db),
):
    """Get full details of a community note."""
    result = await db.execute(
        select(CommunityNote).where(CommunityNote.id == note_id)
    )
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    # Get user details
    user_result = await db.execute(
        select(User).where(User.id == note.user_id)
    )
    user = user_result.scalar_one_or_none()

    return {
        "id": note.id,
        "user_id": note.user_id,
        "user_email": user.email if user else None,
        "user_tier": (
            user.tier.value if user and hasattr(user.tier, "value") else None
        ),
        "title": note.title,
        "content": note.content,
        "course_code": note.course_code,
        "university": note.university,
        "status": note.status,
        "likes_count": note.likes_count,
        "created_at": note.created_at.isoformat(),
        "updated_at": note.updated_at.isoformat(),
    }


# ── Moderation Actions ──────────────────────────────────────────────


@router.post("/notes/{note_id}/approve")
async def approve_note(
    request: Request,
    note_id: int,
    current_admin: AdminUser = Depends(require_permission("community.moderate")),
    db: AsyncSession = Depends(get_db),
):
    """Approve a community note for public display."""
    result = await db.execute(
        select(CommunityNote).where(CommunityNote.id == note_id)
    )
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    if note.status == "approved":
        raise HTTPException(status_code=400, detail="Note already approved")

    old_status = note.status
    note.status = "approved"
    note.updated_at = datetime.utcnow()

    db.add(
        _log_admin_action(
            current_admin.id,
            current_admin.email,
            "approve_community_note",
            "community_note",
            note_id,
            {
                "title": note.title,
                "user_id": note.user_id,
                "status": {"from": old_status, "to": "approved"},
            },
            request.client.host,
        )
    )

    await db.commit()

    return {"success": True, "message": "Note approved and published"}


@router.post("/notes/{note_id}/reject")
async def reject_note(
    request: Request,
    note_id: int,
    reason: str = Query(...),
    current_admin: AdminUser = Depends(require_permission("community.moderate")),
    db: AsyncSession = Depends(get_db),
):
    """Reject a community note (inappropriate content, copyright, etc)."""
    result = await db.execute(
        select(CommunityNote).where(CommunityNote.id == note_id)
    )
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    if note.status == "rejected":
        raise HTTPException(status_code=400, detail="Note already rejected")

    old_status = note.status
    note.status = "rejected"
    note.updated_at = datetime.now(timezone.utc)

    db.add(
        _log_admin_action(
            current_admin.id,
            current_admin.email,
            "reject_community_note",
            "community_note",
            note_id,
            {
                "title": note.title,
                "user_id": note.user_id,
                "status": {"from": old_status, "to": "rejected"},
                "reason": reason,
            },
            request.client.host,
        )
    )

    await db.commit()

    return {"success": True, "message": "Note rejected"}


@router.delete("/notes/{note_id}")
async def delete_note(
    request: Request,
    note_id: int,
    reason: str = Query(...),
    current_admin: AdminUser = Depends(require_permission("community.delete")),
    db: AsyncSession = Depends(get_db),
):
    """Permanently delete a community note (copyright violation, illegal content)."""
    result = await db.execute(
        select(CommunityNote).where(CommunityNote.id == note_id)
    )
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    db.add(
        _log_admin_action(
            current_admin.id,
            current_admin.email,
            "delete_community_note",
            "community_note",
            note_id,
            {
                "title": note.title,
                "user_id": note.user_id,
                "content_preview": note.content[:100],
                "reason": reason,
            },
            request.client.host,
        )
    )

    await db.delete(note)
    await db.commit()

    return {"success": True, "message": "Note deleted permanently"}

