"""Content management endpoints.

Manage educational content in the catalog: view, filter, delete, and
trigger a fresh import from Gutendex to seed the database with books
and articles.
"""

import logging
import json
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import ContentCatalog, AdminUser, AdminAuditLog
from app.services.admin_auth import require_permission
from app.services.content.gutendex import import_gutendex
from app.services.content.slicing import force_reslice_all
from app.services.content.openstax import import_openstax_books, CURRICULUM

logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/content", tags=["admin-content"])


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


# ── Content Management ──────────────────────────────────────────────


@router.get("")
async def list_content(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    content_type: str | None = Query(None),
    category: str | None = Query(None),
    search: str | None = Query(None),
    current_admin: AdminUser = Depends(require_permission("content.view")),
    db: AsyncSession = Depends(get_db),
):
    """List content catalog with filtering and search."""
    q = select(ContentCatalog)
    
    if content_type:
        q = q.where(ContentCatalog.content_type == content_type)
    if category:
        q = q.where(ContentCatalog.category == category)
    if search:
        q = q.where(ContentCatalog.title.ilike(f"%{search}%"))
    
    total = (
        await db.execute(select(func.count()).select_from(q.subquery()))
    ).scalar_one()
    rows = await db.execute(
        q.order_by(ContentCatalog.created_at.desc())
        .limit(limit)
        .offset((page - 1) * limit)
    )
    
    items = [
        {
            "id": c.id,
            "title": c.title,
            "content_type": c.content_type,
            "category": c.category,
            "author": c.author,
            "created_at": c.created_at.isoformat(),
        }
        for c in rows.scalars().all()
    ]
    
    return {"items": items, "total": int(total), "page": page, "limit": limit}


@router.post("/import")
async def admin_import_content(
    request: Request,
    source: str = Query(..., description="Content source: 'gutenberg' or 'openstax'"),
    current_admin: AdminUser = Depends(require_permission("content.import")),
    db: AsyncSession = Depends(get_db),
):
    """Import content from a specific source.

    Supported sources:
      - gutenberg: import a fresh page of books from Gutendex
      - openstax: import the OpenStax STEM curriculum

    Returns counts the admin UI can show in a toast.
    """
    source = source.strip().lower()
    if source == "gutenberg":
        imported = await import_gutendex(db, limit=20, start_page=1)
        reslice_summary = await force_reslice_all(db)
        db.add(
            _log_admin_action(
                current_admin.id,
                current_admin.email,
                "import_gutenberg",
                "content",
                None,
                {"imported": imported, "resliced": str(reslice_summary)},
                request.client.host,
            )
        )
        await db.commit()
        return {"imported": imported, "resliced": reslice_summary}
    elif source == "openstax":
        summary = await import_openstax_books(db)
        db.add(
            _log_admin_action(
                current_admin.id,
                current_admin.email,
                "import_openstax",
                "content",
                None,
                {"books_imported": summary.get("books_imported", 0), "slices_total": summary.get("slices_total", 0)},
                request.client.host,
            )
        )
        await db.commit()
        return {"imported": summary.get("books_imported", 0), "slices_total": summary.get("slices_total", 0)}
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported source: {source}. Use 'gutenberg' or 'openstax'.")


@router.post("/refresh")
async def admin_refresh_catalog(
    request: Request,
    current_admin: AdminUser = Depends(require_permission("content.import")),
    db: AsyncSession = Depends(get_db),
):
    """Import a fresh batch of books from Gutendex and re-slice the catalog.

    Returns counts the admin UI can show in a toast: how many books
    were imported, how many parents were re-sliced, total child slices.
    This can take 10–30s on Render free tier.
    """
    try:
        imported = await import_gutendex(db, limit=20, start_page=1)
        reslice_summary = await force_reslice_all(db)

        db.add(
            _log_admin_action(
                current_admin.id,
                current_admin.email,
                "refresh_catalog",
                "content",
                None,
                {"imported": imported, "resliced": str(reslice_summary)},
                request.client.host,
            )
        )
        await db.commit()

        return {
            "imported": imported,
            "resliced": reslice_summary,
        }
    except Exception as exc:  # noqa: BLE001
        logger.exception("Content refresh failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Content refresh failed: {exc}") from exc


@router.delete("/{content_id}")
async def delete_content(
    request: Request,
    content_id: int,
    current_admin: AdminUser = Depends(require_permission("content.delete")),
    db: AsyncSession = Depends(get_db),
):
    """Delete content from catalog."""
    result = await db.execute(
        select(ContentCatalog).where(ContentCatalog.id == content_id)
    )
    content = result.scalar_one_or_none()
    if not content:
        raise HTTPException(status_code=404, detail="Content not found")
    
    db.add(
        _log_admin_action(
            current_admin.id,
            current_admin.email,
            "delete_content",
            "content",
            content_id,
            {"title": content.title},
            request.client.host,
        )
    )
    
    await db.delete(content)
    await db.commit()
    
    return {"success": True}


# ── v3 TTS Audio Generation ─────────────────────────────────────────


@router.post("/tts/generate-work/{work_id}")
async def admin_generate_tts_for_work(
    request: Request,
    work_id: int,
    force: bool = Query(False, description="Regenerate existing files"),
    current_admin: AdminUser = Depends(require_permission("content.import")),
    db: AsyncSession = Depends(get_db),
):
    """Batch-generate TTS audio for all units in a work.

    v3 §3.3 Listen mode. This is the admin endpoint for triggering
    audio generation per-work. The full catalog job is exposed as
    /admin/content/tts/generate-all (below).

    Returns:
        {"units_processed": N} where N is the count of units that
        had audio generated (or skipped if already present).

    Typical runtime: 5-10 minutes per book (depending on book size).
    For OpenStax "University Physics Vol 1" (~60 units), expect ~6
    minutes. The endpoint is synchronous so the admin UI can show a
    spinner. For production use, this would be better as a background
    job with a polling endpoint, but for v3 MVP we ship it synchronous.
    """
    from app.services.tts import batch_generate_audio_for_work

    try:
        count = await batch_generate_audio_for_work(
            db, work_id, force=force, concurrency=5
        )
        db.add(
            _log_admin_action(
                current_admin.id,
                current_admin.email,
                "generate_tts_for_work",
                "content",
                work_id,
                {"units_processed": count, "force": force},
                request.client.host,
            )
        )
        await db.commit()
        return {"units_processed": count}
    except Exception as exc:  # noqa: BLE001
        logger.exception("TTS generation failed for work %d: %s", work_id, exc)
        raise HTTPException(
            status_code=500, detail=f"TTS generation failed: {exc}"
        ) from exc


@router.post("/tts/generate-all")
async def admin_generate_tts_for_all_works(
    request: Request,
    force: bool = Query(False, description="Regenerate existing files"),
    current_admin: AdminUser = Depends(require_permission("content.import")),
    db: AsyncSession = Depends(get_db),
):
    """Batch-generate TTS audio for ALL works in the catalog.

    v3 §3.3 one-time job. This takes 1-2 hours for the full OpenStax
    curriculum (12 books, ~800 units). Run once after v3 ships to
    pre-populate audio, then use /tts/generate-work/{work_id} for
    incremental updates.

    Returns:
        {"total_units": N} where N is the total count across all works.

    CAUTION: This is a long-running synchronous endpoint. The admin UI
    should show a clear "This will take ~1-2 hours" warning before the
    user clicks. For production, migrate this to a background job with
    a status poll endpoint.
    """
    from app.services.tts import batch_generate_audio_for_all_works

    try:
        total = await batch_generate_audio_for_all_works(
            db, force=force, concurrency=5
        )
        db.add(
            _log_admin_action(
                current_admin.id,
                current_admin.email,
                "generate_tts_for_all_works",
                "content",
                None,
                {"total_units": total, "force": force},
                request.client.host,
            )
        )
        await db.commit()
        return {"total_units": total}
    except Exception as exc:  # noqa: BLE001
        logger.exception("TTS generation failed for all works: %s", exc)
        raise HTTPException(
            status_code=500, detail=f"TTS generation failed: {exc}"
        ) from exc
