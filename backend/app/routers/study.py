"""Study endpoints for Phase 3: AI Exam Prep.

SOW upload → AI parsing → asset generation (MCQ/flashcard/essay) →
ad-or-points gated unlock → streaming study chat.
"""

import logging
import uuid
import asyncio
import io
import re
from datetime import datetime, timedelta

import httpx

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.prompts import (
    CHAT_TUTOR_SYSTEM,
    DIAGRAM_GENERATOR,
    DIFFICULTY_GUIDES,
    ESSAY_ALL_TOPICS_GENERATOR,
    ESSAY_GENERATOR,
    ESSAY_TOPIC_GENERATOR,
    EXAM_STYLE_GUIDES,
    EXAMPLE_GENERATOR,
    FLASHCARD_ALL_TOPICS_GENERATOR,
    FLASHCARD_GENERATOR,
    FLASHCARD_TOPIC_GENERATOR,
    LANGUAGE_NAMES,
    MCQ_ALL_TOPICS_GENERATOR,
    MCQ_GENERATOR,
    MCQ_TOPIC_GENERATOR,
    SOW_PARSER,
    VIDEO_SCRIPT_GENERATOR,
)
from app.ai.router import route_ai
from app.exam_types import (
    EXAM_DURATIONS,
    EXAM_QUESTION_COUNTS,
    EXAM_TYPE_KEYS,
    EXAM_TYPE_SPECS,
    normalize_exam_type,
)
from app.services import tts_hybrid
from app.models import (
    AudioUnlock,
    ExamAnswer,
    ExamSession,
    SowUploadJob,
    StudyAsset,
    StudyAudioBatch,
    StudyMaterial,
    StudyProgress,
    StudyTransaction,
    User,
    ReadingSession,
)
from app.database import AsyncSessionLocal, get_db
from app.routers.auth import get_current_user
from app.config import settings
from app.services.sanitize import (
    safe_filename,
    sanitize_for_display,
)
from app.services.tts_hybrid import AUDIO_CACHE_DIR, synthesize_study_audio
from app.services import study_narration
from app.services import audio_pricing
from app.services import study_audio_service
from app.services import r2_storage
import app.services.tts_hybrid as tts_hybrid
from app.limiter import limiter
from app.services.ai_usage import check_and_record, release
from app.services.subscription import is_premium
from app.schemas import (
    ChatRequest,
    ExampleCheckRequest,
    ExampleCheckResponse,
    ExampleGenerateRequest,
    ExamAnswerSubmit,
    ExamAnswerConfirm,
    ExamStartRequest,
    ExamStartResponse,
    ExamHistoryItem,
    ExamResultDetail,
    ExamSubmitResponse,
    GenerateAssetRequest,
    GenerateAssetResponse,
    MaterialDetail,
    MaterialSummary,
    MaterialUpdate,
    QuizCompleteRequest,
    QuizCompleteResponse,
    SowUploadJobAccepted,
    SowUploadJobStatus,
    SowUploadRequest,
    SowUploadResponse,
    StudyProgressListResponse,
    StudyProgressResponse,
    StudyProgressUpdate,
    UnlockRequest,
    UnlockResponse,
)

logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/study", tags=["study"])

# Per-route file upload cap. The global RequestSizeLimitMiddleware
# allows up to 1MB, but we tighten that for these routes — a 5MB
# SOW image blows up the base64 payload (2× RAM) and the Gemini
# Vision bill. Documents (PDF/DOCX/TXT) get a slightly larger cap.
MAX_SOW_IMAGE_BYTES: int = 5 * 1024 * 1024   # 5 MB
MAX_SOW_DOC_BYTES: int = 7 * 1024 * 1024     # 7 MB

# Content-type allowlist for the image route. The browser-supplied
# `file.content_type` is attacker-controlled and was previously
# trusted verbatim — restrict it to types Gemini Vision can process.
ALLOWED_IMAGE_TYPES: frozenset[str] = frozenset({
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
})

UNLOCK_POINTS_COST = settings.study_unlock_points_cost
VIDEO_UNLOCK_POINTS_COST = settings.study_video_unlock_points_cost


# ── POST /study/sow/upload ──────────────────────────────────────────


@router.post("/sow/upload", response_model=SowUploadResponse, status_code=201)
async def upload_sow(
    payload: SowUploadRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload scheme-of-work text for AI parsing.

    The text is sent to the AI router with the SOW_PARSER prompt.
    On success the parsed JSON is stored alongside the raw input.
    """
    try:
        exam_type = normalize_exam_type(payload.exam_type)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    prompt = SOW_PARSER.format(raw_text=payload.text)
    ai_result = await route_ai(prompt, task_type="heavy", db=db)

    parsed = None
    try:
        import json as _json
        parsed = _json.loads(ai_result["response"])
    except Exception:
        logger.error("SOW parser returned non-JSON: %s", ai_result["response"][:200])

    title = (parsed or {}).get("title", "Untitled Material") if isinstance(parsed, dict) else "Untitled Material"

    material = StudyMaterial(
        user_id=current_user.id,
        title=title,
        exam_type=exam_type,
        raw_input=payload.text,
        parsed_structure=_json.dumps(parsed) if parsed else None,
        ai_model_used=ai_result.get("provider"),
    )
    db.add(material)
    await db.commit()
    await db.refresh(material)

    return SowUploadResponse(
        material_id=material.id,
        title=material.title,
        exam_type=material.exam_type,
        parsed_structure=parsed,
    )


@router.post("/sow/upload-image", response_model=SowUploadJobAccepted, status_code=202)
async def upload_sow_image(
    file: UploadFile = File(...),
    exam_type: str | None = Form(default=None),
    request: Request = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload a SOW image. The file is read and validated synchronously
    so the 5 MB cap + content-type allowlist still hold before we
    return. OCR (Cloudflare vision) + SOW AI parsing then run in a
    background task. The client polls
    `GET /api/v1/study/sow/jobs/{job_id}` to drive its progress bar
    through the 80→100 window.
    """
    try:
        exam_type = normalize_exam_type(exam_type)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    content_length = request.headers.get("content-length") if request else None
    logger.info(
        "[sow/upload-image] HIT user=%s exam_type=%s filename=%s ctype=%s length=%s",
        current_user.id,
        exam_type,
        file.filename,
        file.content_type,
        content_length,
    )
    logger.info("[sow/upload-image] cloudinary_in_scope=%s", __name__)

    if not settings.cloudflare_account_id or not settings.cloudflare_api_token:
        logger.error("[sow/upload-image] Cloudflare not configured")
        raise HTTPException(status_code=503, detail="Cloudflare Workers AI not configured")

    # Content-type allowlist — `file.content_type` is set by the
    # client and is attacker-controlled. Reject anything other than
    # the types Gemini Vision actually accepts.
    ctype = (file.content_type or "").lower().split(";", 1)[0].strip()
    if ctype not in ALLOWED_IMAGE_TYPES:
        logger.warning("[sow/upload-image] unsupported ctype: %s", ctype)
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported image type: {ctype!r}. Use JPEG, PNG, WEBP, or HEIC.",
        )

    # Sanitize the filename BEFORE we read the body so a hostile
    # path-traversal filename never touches the DB or the log.
    safe_name = safe_filename(file.filename, fallback="upload.jpg")
    logger.info("[sow/upload-image] safe_name=%s", safe_name)

    try:
        contents = await file.read()
    except Exception as e:
        logger.exception("[sow/upload-image] file.read() failed: %s", e)
        raise HTTPException(status_code=400, detail=f"Could not read uploaded file: {e}")

    logger.info(
        "[sow/upload-image] read %s bytes (limit=%s)",
        len(contents),
        MAX_SOW_IMAGE_BYTES,
    )
    if not contents:
        logger.warning("[sow/upload-image] empty file")
        raise HTTPException(status_code=400, detail="Empty file")
    if len(contents) > MAX_SOW_IMAGE_BYTES:
        logger.warning(
            "[sow/upload-image] too large: %s > %s",
            len(contents),
            MAX_SOW_IMAGE_BYTES,
        )
        raise HTTPException(
            status_code=413,
            detail=f"Image too large (max {MAX_SOW_IMAGE_BYTES // (1024*1024)} MB)",
        )

    # Insert the job row, fire the worker, return immediately.
    job = SowUploadJob(id=str(uuid.uuid4()), user_id=current_user.id, status="queued")
    db.add(job)
    await db.commit()
    await db.refresh(job)

    logger.info(
        "[sow/upload-image] job queued id=%s user=%s dispatching background worker",
        job.id,
        current_user.id,
    )

    asyncio.create_task(
        _process_sow_image_job(
            job_id=job.id,
            user_id=current_user.id,
            exam_type=exam_type,
            contents=contents,
            safe_name=safe_name,
            content_type=file.content_type or "image/jpeg",
        )
    )

    return SowUploadJobAccepted(job_id=job.id, status="queued")


@router.post("/sow/preview-pdf")
async def preview_sow_pdf(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """Render PDF pages to PNG images for client-side review.

    Returns the same shape as `GET /materials/{id}/pages` so the
    frontend can reuse its page-rendering UI. The client should send
    the picked PDF here first, let the user select/deselect pages,
    then call `/sow/upload-document` with `selected_pages`.
    """
    safe_name = safe_filename(file.filename, fallback="preview.pdf")
    try:
        contents = await file.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read file: {e}")

    if not contents:
        raise HTTPException(status_code=400, detail="Empty file")

    fname = safe_name.lower()
    if not fname.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF preview is supported")

    try:
        import fitz  # PyMuPDF
    except ImportError:
        raise HTTPException(status_code=500, detail="PDF renderer not configured")

    try:
        pdf = fitz.open(stream=contents, filetype="pdf")
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Stored file is not a valid PDF") from exc

    try:
        pages: list[dict] = []
        for page_num in range(len(pdf)):
            page = pdf[page_num]
            pix = page.get_pixmap(dpi=150)
            img_bytes = pix.tobytes("png")
            pages.append({
                "page": page_num + 1,
                "total": len(pdf),
                "image_base64": __import__("base64").b64encode(img_bytes).decode("ascii"),
                "width": pix.width,
                "height": pix.height,
            })
        pdf.close()
        return {"pages": pages}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("[sow/preview-pdf] PDF rendering failed user=%s err=%s", current_user.id, exc)
        raise HTTPException(status_code=500, detail=f"PDF rendering failed: {exc}") from exc


@router.post("/sow/upload-document", response_model=SowUploadJobAccepted, status_code=202)
async def upload_sow_document(
    file: UploadFile = File(...),
    exam_type: str | None = Form(default=None),
    selected_pages: str | None = Form(default=None),
    request: Request = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload a SOW document (PDF, DOCX, TXT). The file is read and
    validated synchronously so the 10 MB cap holds; text extraction
    + SOW AI parsing then run in a background task. The client
    polls `GET /api/v1/study/sow/jobs/{job_id}` to drive its progress
    bar through the 80→100 window.

    For PDFs, `selected_pages` is a JSON array of 1-indexed page
    numbers to include. If omitted, all pages are used.
    """
    try:
        exam_type = normalize_exam_type(exam_type)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    content_length = request.headers.get("content-length") if request else None
    logger.info(
        "[sow/upload-document] HIT user=%s exam_type=%s filename=%s ctype=%s length=%s",
        current_user.id,
        exam_type,
        file.filename,
        file.content_type,
        content_length,
    )
    logger.info("[sow/upload-document] cloudinary_in_scope=%s", __name__)
    safe_name = safe_filename(file.filename, fallback="document")
    logger.info("[sow/upload-document] safe_name=%s", safe_name)

    try:
        contents = await file.read()
    except Exception as e:
        logger.exception(
            "[sow/upload-document] file.read() failed: %s", e,
        )
        raise HTTPException(status_code=400, detail=f"Could not read uploaded file: {e}")

    logger.info(
        "[sow/upload-document] read %s bytes (limit=%s)",
        len(contents),
        MAX_SOW_DOC_BYTES,
    )

    if not contents:
        logger.warning("[sow/upload-document] empty file")
        raise HTTPException(status_code=400, detail="Empty file")
    if len(contents) > MAX_SOW_DOC_BYTES:
        logger.warning(
            "[sow/upload-document] too large: %s > %s",
            len(contents),
            MAX_SOW_DOC_BYTES,
        )
        raise HTTPException(
            status_code=413,
            detail=f"Document too large (max {MAX_SOW_DOC_BYTES // (1024*1024)} MB)",
        )

    # Reject early if the extension is not one we know how to parse —
    # do this inline so the client gets a fast 400 instead of finding
    # out via the polling endpoint.
    filename_lower = safe_name.lower()
    if not (
        filename_lower.endswith(".pdf")
        or filename_lower.endswith(".docx")
        or filename_lower.endswith(".doc")
        or filename_lower.endswith(".txt")
    ):
        logger.warning(
            "[sow/upload-document] unsupported extension: %s", safe_name,
        )
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Upload PDF, DOCX, or TXT.",
        )

    job = SowUploadJob(id=str(uuid.uuid4()), user_id=current_user.id, status="queued")
    db.add(job)
    await db.commit()
    await db.refresh(job)

    logger.info(
        "[sow/upload-document] job queued id=%s user=%s dispatching background worker",
        job.id,
        current_user.id,
    )

    asyncio.create_task(
        _process_sow_document_job(
            job_id=job.id,
            user_id=current_user.id,
            exam_type=exam_type,
            contents=contents,
            safe_name=safe_name,
            selected_pages=selected_pages,
        )
    )

    return SowUploadJobAccepted(job_id=job.id, status="queued")


@router.get("/sow/jobs/{job_id}", response_model=SowUploadJobStatus)
async def get_sow_job_status(
    job_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Poll for the status of an in-flight SOW upload.

    Scoped to `current_user.id` so a user can never see another
    user's job state. Returns 404 on miss — we don't leak the
    existence of someone else's job.
    """
    row = await db.get(SowUploadJob, job_id)
    if row is None or row.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Job not found")
    return SowUploadJobStatus(
        job_id=row.id,
        status=row.status,
        material_id=row.material_id,
        error=row.error_message,
        updated_at=row.updated_at,
    )


# ── Background workers ───────────────────────────────────────────────


async def _ocr_image_with_cloudflare(
    contents: bytes, content_type: str
) -> str:
    """Send the image to Cloudflare Workers AI Llama Vision and return extracted text.

    Uses @cf/meta/llama-3.2-11b-vision-instruct with the image as a
    base64 data URI. Raises RuntimeError on failure so the worker
    can mark the job as `failed`.
    """
    import base64
    import httpx

    b64 = base64.b64encode(contents).decode()
    data_uri = f"data:{content_type};base64,{b64}"
    url = (
        f"https://api.cloudflare.com/client/v4/accounts/"
        f"{settings.cloudflare_account_id}/ai/run/@cf/meta/llama-3.2-11b-vision-instruct"
    )
    headers = {
        "Authorization": f"Bearer {settings.cloudflare_api_token}",
        "Content-Type": "application/json",
    }
    body = {
        "prompt": "Extract all text from this image. Return the raw text exactly as written, preserving structure (headings, bullet points, numbering).",
        "image": data_uri,
        "max_tokens": 8000,
        "temperature": 0.1,
    }
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(url, json=body, headers=headers)
        if resp.status_code != 200:
            raise RuntimeError(f"cf_vision_http_{resp.status_code}")
        data = resp.json()
    try:
        text = data.get("result", {}).get("response", "")
        if not text:
            raise RuntimeError("cf_vision_empty")
        return text
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError("cf_vision_malformed_response") from exc


async def _extract_document_text(contents: bytes, filename: str, selected_pages: str | None = None) -> str:
    """Branch on extension and extract plain text from PDF / DOCX / TXT.

    Raises a `ValueError` with a user-safe category on any failure;
    the document worker translates that into the right
    `error_message` on the job row.

    For PDFs, `selected_pages` is a JSON array of 1-indexed page numbers
    to include. If omitted or empty, all pages are extracted.
    """
    fname = filename.lower()
    if fname.endswith(".pdf"):
        try:
            import pypdf
            from io import BytesIO
            reader = pypdf.PdfReader(BytesIO(contents))
            pages = reader.pages
            if selected_pages:
                try:
                    import json as _json
                    selected = set(_json.loads(selected_pages))
                    pages = [pages[i - 1] for i in sorted(selected) if 1 <= i <= len(reader.pages)]
                except Exception:
                    pass
            return "\n".join(p.extract_text() or "" for p in pages)
        except Exception as exc:
            logger.error("PDF extraction failed: %s", exc)
            raise ValueError("pdf_extraction_failed") from exc
    if fname.endswith((".docx", ".doc")):
        try:
            import docx
            from io import BytesIO
            doc = docx.Document(BytesIO(contents))
            return "\n".join(para.text for para in doc.paragraphs)
        except Exception as exc:
            logger.error("DOCX extraction failed: %s", exc)
            raise ValueError("docx_extraction_failed") from exc
    if fname.endswith(".txt"):
        try:
            return contents.decode("utf-8")
        except UnicodeDecodeError:
            try:
                return contents.decode("latin-1")
            except Exception as exc:
                logger.error("Text file decode failed: %s", exc)
                raise ValueError("text_decode_failed") from exc
    raise ValueError("unsupported_file_type")


def _parse_ai_response(response_text: str) -> dict | None:
    """Best-effort JSON parse of the SOW parser's output.

    Some providers wrap JSON in a ```json ... ``` fenced code block;
    strip that before parsing. Returns None on failure.
    """
    import json as _json
    try:
        return _json.loads(response_text)
    except Exception:
        pass
    try:
        if "```json" in response_text:
            inner = response_text.split("```json", 1)[1]
            inner = inner.split("```", 1)[0]
            return _json.loads(inner)
    except Exception:
        pass
    try:
        if "```" in response_text:
            inner = response_text.split("```", 1)[1]
            inner = inner.split("```", 1)[0]
            return _json.loads(inner)
    except Exception:
        pass
    logger.error("SOW parser returned non-JSON: %s", response_text[:200])
    return None


async def _run_sow_parser(extracted_text: str) -> tuple[dict | None, str | None, str | None]:
    """Run the SOW parser AI prompt. Returns (parsed, provider, raw_response).

    Pulled out of the workers so the image + document paths share the
    exact same parsing logic.
    """
    prompt = SOW_PARSER.format(raw_text=extracted_text)
    ai_result = await route_ai(prompt, task_type="heavy")
    parsed = _parse_ai_response(ai_result.get("response", ""))
    return parsed, ai_result.get("provider"), ai_result.get("response", "")


async def _mark_job_status(
    job_id: str, status: str, *, material_id: int | None = None, error: str | None = None
) -> None:
    """Update a job row using its own session.

    The worker runs in a background task with no shared session, so
    each status flip opens `AsyncSessionLocal` briefly.
    """
    async with AsyncSessionLocal() as db:
        row = await db.get(SowUploadJob, job_id)
        if row is None:
            return
        row.status = status
        if material_id is not None:
            row.material_id = material_id
        if error is not None:
            row.error_message = error
        row.updated_at = datetime.utcnow()
        await db.commit()


async def _process_sow_image_job(
    job_id: str,
    user_id: int,
    exam_type: str | None,
    contents: bytes,
    safe_name: str,
    content_type: str,
) -> None:
    """Background worker for the image SOW upload.

    Opens its own `AsyncSessionLocal` so it doesn't share a session
    with the request that fired it. Never raises — every error path
    ends in a `failed` row so the polling endpoint has something to
    report.
    """
    logger.info(
        "[sow/upload-image worker] START job=%s user=%s bytes=%s",
        job_id, user_id, len(contents),
    )
    try:
        await _mark_job_status(job_id, "processing")

        try:
            extracted_text = await _ocr_image_with_cloudflare(contents, content_type)
            logger.info(
                "[sow/upload-image worker] OCR done job=%s text_len=%s",
                job_id, len(extracted_text or ""),
            )
        except Exception as exc:
            logger.error("Cloudflare Vision OCR failed for job %s: %s", job_id, exc)
            raise RuntimeError("image_ocr_failed") from exc

        if not extracted_text.strip():
            raise RuntimeError("image_ocr_empty")

        try:
            parsed, provider, _ = await _run_sow_parser(extracted_text)
            logger.info(
                "[sow/upload-image worker] parser done job=%s provider=%s keys=%s",
                job_id, provider, list((parsed or {}).keys()) if isinstance(parsed, dict) else None,
            )
        except Exception as exc:
            logger.error("SOW parser AI failed for job %s: %s", job_id, exc)
            raise RuntimeError("ai_parser_failed") from exc

        title = (parsed or {}).get("title", safe_name) if isinstance(parsed, dict) else safe_name

        import json as _json
        async with AsyncSessionLocal() as db:
            material = StudyMaterial(
                user_id=user_id,
                title=title,
                exam_type=exam_type,
                raw_input=f"[IMAGE: {safe_name}]\n{extracted_text}",
                parsed_structure=_json.dumps(parsed) if parsed else None,
                original_file_data=contents,
                file_mime_type=content_type or "image/jpeg",
                ai_model_used=provider,
            )
            db.add(material)
            await db.commit()
            await db.refresh(material)
            material_id = material.id

        logger.info(
            "[sow/upload-image worker] DONE job=%s material_id=%s",
            job_id, material_id,
        )
        await _mark_job_status(job_id, "completed", material_id=material_id)
    except Exception as exc:
        logger.exception("SOW image job %s failed", job_id)
        await _mark_job_status(job_id, "failed", error=str(exc) or exc.__class__.__name__)


async def _process_sow_document_job(
    job_id: str,
    user_id: int,
    exam_type: str | None,
    contents: bytes,
    safe_name: str,
    selected_pages: str | None = None,
) -> None:
    """Background worker for the document SOW upload. Same shape as
    the image worker — runs extraction + AI parse, writes the
    material, updates the job row.
    """
    logger.info(
        "[sow/upload-document worker] START job=%s user=%s bytes=%s cloudinary_available=%s",
        job_id, len(contents), "cloudinary" in dir(),
    )
    logger.info("[sow/upload-document worker] study_router_cloudinary_imports=%s", "cloudinary" in globals())
    try:
        await _mark_job_status(job_id, "processing")

        try:
            extracted_text = await _extract_document_text(contents, safe_name, selected_pages=selected_pages)
            logger.info(
                "[sow/upload-document worker] extract done job=%s text_len=%s",
                job_id, len(extracted_text or ""),
            )
        except ValueError as exc:
            # Already a user-safe category from the extractor.
            logger.warning(
                "[sow/upload-document worker] extract ValueError job=%s err=%s",
                job_id, exc,
            )
            await _mark_job_status(job_id, "failed", error=str(exc))
            return
        except Exception as exc:
            logger.exception("Document extraction crashed for job %s: %s", job_id, exc)
            await _mark_job_status(job_id, "failed", error="document_extraction_failed")
            return

        if not extracted_text.strip():
            logger.warning(
                "[sow/upload-document worker] empty text job=%s",
                job_id,
            )
            await _mark_job_status(job_id, "failed", error="empty_extracted_text")
            return

        try:
            parsed, provider, _ = await _run_sow_parser(extracted_text)
            logger.info(
                "[sow/upload-document worker] parser done job=%s provider=%s",
                job_id, provider,
            )
        except Exception as exc:
            logger.exception("SOW parser AI failed for job %s: %s", job_id, exc)
            await _mark_job_status(job_id, "failed", error="ai_parser_failed")
            return

        title = (parsed or {}).get("title", safe_name) if isinstance(parsed, dict) else safe_name

        import json as _json
        async with AsyncSessionLocal() as db:
            filename_lower = safe_name.lower()
            if filename_lower.endswith(".pdf"):
                inferred_mime = "application/pdf"
            elif filename_lower.endswith((".docx", ".doc")):
                inferred_mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            elif filename_lower.endswith(".txt"):
                inferred_mime = "text/plain"
            else:
                inferred_mime = "application/octet-stream"
            material = StudyMaterial(
                user_id=user_id,
                title=title,
                exam_type=exam_type,
                raw_input=f"[DOCUMENT: {safe_name}]\n{extracted_text}",
                parsed_structure=_json.dumps(parsed) if parsed else None,
                original_file_data=contents,
                file_mime_type=inferred_mime,
                ai_model_used=provider,
            )
            db.add(material)
            await db.commit()
            await db.refresh(material)
            material_id = material.id

        logger.info(
            "[sow/upload-document worker] DONE job=%s material_id=%s",
            job_id, material_id,
        )
        await _mark_job_status(job_id, "completed", material_id=material_id)
    except Exception as exc:
        logger.exception("SOW document job %s failed", job_id)
        await _mark_job_status(job_id, "failed", error=str(exc) or exc.__class__.__name__)


# ── GET /study/materials ────────────────────────────────────────────


@router.get("/materials", response_model=list[MaterialSummary])
async def list_materials(
    exam_type: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(StudyMaterial).where(StudyMaterial.user_id == current_user.id)
    if exam_type:
        query = query.where(or_(StudyMaterial.exam_type == exam_type, StudyMaterial.exam_type.is_(None)))
    result = await db.execute(query.order_by(StudyMaterial.created_at.desc()))
    materials = result.scalars().all()

    out = []
    for m in materials:
        asset_types = await _get_asset_types(db, m.id)
        out.append(MaterialSummary(
            id=m.id,
            title=m.title,
            exam_type=m.exam_type,
            asset_types=asset_types,
            created_at=m.created_at,
        ))
    return out


async def _get_asset_types(db: AsyncSession, material_id: int) -> list[str]:
    result = await db.execute(
        select(StudyAsset.asset_type)
        .where(StudyAsset.material_id == material_id)
        .distinct()
    )
    return [row[0] for row in result.all()]


# ── GET /study/materials/{id} ───────────────────────────────────────


@router.get("/materials/{material_id}", response_model=MaterialDetail)
async def get_material(
    material_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(StudyMaterial).where(
            StudyMaterial.id == material_id,
            StudyMaterial.user_id == current_user.id,
        )
    )
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    assets_result = await db.execute(
        select(StudyAsset).where(StudyAsset.material_id == material_id)
    )
    assets = assets_result.scalars().all()

    # Get unlocked assets for this user
    unlocked_result = await db.execute(
        select(StudyTransaction.asset_id, StudyAsset.content_json)
        .join(StudyAsset, StudyTransaction.asset_id == StudyAsset.id)
        .where(
            StudyTransaction.user_id == current_user.id,
            StudyTransaction.reward_granted == True,
            StudyAsset.material_id == material_id,
        )
    )
    unlocked_data = {row[0]: row[1] for row in unlocked_result.all()}

    import json as _json
    parsed = _json.loads(material.parsed_structure) if material.parsed_structure else None

    asset_list = []
    for a in assets:
        asset_dict = {
            "id": a.id,
            "material_id": a.material_id,
            "type": a.asset_type,
            "points_to_unlock": a.points_to_unlock,
            "created_at": a.created_at.isoformat(),
        }
        
        # Include content if already unlocked
        if a.id in unlocked_data:
            asset_dict["unlocked"] = True
            asset_dict["content"] = _json.loads(unlocked_data[a.id])
        else:
            asset_dict["unlocked"] = False
            
        asset_list.append(asset_dict)

    return MaterialDetail(
        id=material.id,
        title=material.title,
        exam_type=material.exam_type,
        content=material.raw_input or None,
        parsed_structure=parsed,
        assets=asset_list,
        file_mime_type=material.file_mime_type or None,
        has_original_file=material.original_file_data is not None,
        created_at=material.created_at,
    )


# ── PATCH /study/materials/{id} ───────────────────────────────────────


@router.patch("/materials/{material_id}", response_model=MaterialDetail)
async def update_material(
    material_id: int,
    payload: MaterialUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(StudyMaterial).where(
            StudyMaterial.id == material_id,
            StudyMaterial.user_id == current_user.id,
        )
    )
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    if payload.title is not None:
        material.title = payload.title.strip()
    if payload.exam_type is not None:
        try:
            material.exam_type = normalize_exam_type(payload.exam_type)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))

    await db.commit()
    await db.refresh(material)

    assets_result = await db.execute(
        select(StudyAsset).where(StudyAsset.material_id == material_id)
    )
    assets = assets_result.scalars().all()

    unlocked_result = await db.execute(
        select(StudyTransaction.asset_id, StudyAsset.content_json)
        .join(StudyAsset, StudyTransaction.asset_id == StudyAsset.id)
        .where(
            StudyTransaction.user_id == current_user.id,
            StudyTransaction.reward_granted == True,
            StudyAsset.material_id == material_id,
        )
    )
    unlocked_data = {row[0]: row[1] for row in unlocked_result.all()}

    import json as _json
    parsed = _json.loads(material.parsed_structure) if material.parsed_structure else None

    asset_list = []
    for a in assets:
        asset_dict = {
            "id": a.id,
            "material_id": a.material_id,
            "type": a.asset_type,
            "points_to_unlock": a.points_to_unlock,
            "created_at": a.created_at.isoformat(),
        }
        if a.id in unlocked_data:
            asset_dict["unlocked"] = True
            asset_dict["content"] = _json.loads(unlocked_data[a.id])
        else:
            asset_dict["unlocked"] = False
        asset_list.append(asset_dict)

    return MaterialDetail(
        id=material.id,
        title=material.title,
        exam_type=material.exam_type,
        content=material.raw_input or None,
        parsed_structure=parsed,
        assets=asset_list,
        file_mime_type=material.file_mime_type or None,
        has_original_file=material.original_file_data is not None,
        created_at=material.created_at,
    )


# ── DELETE /study/materials/{id} ──────────────────────────────────────


@router.delete("/materials/{material_id}", status_code=204)
async def delete_material(
    material_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(StudyMaterial).where(
            StudyMaterial.id == material_id,
            StudyMaterial.user_id == current_user.id,
        )
    )
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    await db.delete(material)
    await db.commit()
    return Response(status_code=204)


# ── GET /study/materials/{id}/export ───────────────────────────────────


@router.get("/materials/{material_id}/export")
async def export_material(
    material_id: int,
    format: str = "pdf",
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    logger.info("[export] material_id=%s format=%s user=%s", material_id, format, current_user.id)
    logger.info("[export] cloudinary_in_scope=%s", "cloudinary" in dir())
    result = await db.execute(
        select(StudyMaterial).where(
            StudyMaterial.id == material_id,
            StudyMaterial.user_id == current_user.id,
        )
    )
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    topic_names: list[str] = []
    if material.parsed_structure:
        import json as _json
        parsed = _json.loads(material.parsed_structure)
        topic_names = [t.get("name", "") for t in parsed.get("topics", []) if t.get("name")]

    assets_result = await db.execute(
        select(StudyAsset).where(StudyAsset.material_id == material_id)
    )
    assets = assets_result.scalars().all()

    content = material.raw_input or ""
    safe_title = material.title or "study-material"
    base_name = re.sub(r"^[A-Z]+ · ", "", safe_title).strip() or "study-material"
    base_name = re.sub(r"[^a-zA-Z0-9_-]+", "_", base_name).strip() or "study_material"

    if format == "image":
        if material.original_file_data:
            return Response(
                content=material.original_file_data,
                media_type=material.file_mime_type or "application/octet-stream",
                headers={
                    "Content-Disposition": f'attachment; filename="{base_name}.png"',
                },
            )
        
        from PIL import Image, ImageDraw, ImageFont
        width, height = 800, 1000
        img = Image.new("RGB", (width, height), color="white")
        draw = ImageDraw.Draw(img)
        try:
            font_title = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 28)
            font_body = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 18)
            font_meta = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 14)
        except Exception:
            font_title = ImageFont.load_default()
            font_body = ImageFont.load_default()
            font_meta = ImageFont.load_default()

        y = 30
        draw.text((40, y), safe_title, fill="black", font=font_title)
        y += 50
        meta = f"Exam: {(material.exam_type or 'Custom').upper()}    Topics: {len(topic_names)}    Assets: {len(assets)}"
        draw.text((40, y), meta, fill="#666666", font=font_meta)
        y += 30
        draw.line([(40, y), (width - 40, y)], fill="#0E7C66", width=2)
        y += 20

        paragraphs = _split_paragraphs(content or "")
        for para in paragraphs:
            lines = _wrap_text(para, width - 80, font_body)
            for line in lines:
                if y > height - 40:
                    break
                draw.text((40, y), line, fill="black", font=font_body)
                y += 26
            y += 10

        buffer = io.BytesIO()
        img.save(buffer, format="PNG")
        buffer.seek(0)
        return Response(
            content=buffer.getvalue(),
            media_type="image/png",
            headers={
                "Content-Disposition": f'attachment; filename="{base_name}.png"',
            },
        )

    if format == "pdf":
        from app.services.pdf_material import material_to_pdf
        pdf_bytes = material_to_pdf(
            title=safe_title,
            content=content,
            exam_type=material.exam_type,
            topic_names=topic_names,
            asset_count=len(assets),
            created_at=material.created_at,
            image_bytes=material.original_file_data,
        )
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{base_name}.pdf"',
            },
        )

    if format == "docx":
        import docx  # python-docx
        doc = docx.Document()
        doc.add_heading(safe_title, level=1)
        if material.exam_type:
            doc.add_paragraph(f"Exam: {material.exam_type.upper()}")
        doc.add_paragraph(f"Topics: {len(topic_names)}  |  Assets: {len(assets)}")
        doc.add_paragraph("")
        
        if material.original_file_data:
            try:
                img_stream = io.BytesIO(material.original_file_data)
                doc.add_picture(img_stream, width=docx.shared.Inches(5.5))
                doc.add_paragraph("")
            except Exception:
                pass
        
        if topic_names:
            doc.add_heading("Topics Covered", level=2)
            for idx, name in enumerate(topic_names, 1):
                doc.add_paragraph(f"{idx}. {name}", style="List Number")
            doc.add_paragraph("")
        doc.add_heading("Content", level=2)
        for para in (content or "").split("\n\n"):
            para = para.strip()
            if para:
                doc.add_paragraph(para)
        buffer = io.BytesIO()
        doc.save(buffer)
        buffer.seek(0)
        return Response(
            content=buffer.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={
                "Content-Disposition": f'attachment; filename="{base_name}.docx"',
            },
        )

    if format == "txt":
        body = "\n".join([
            safe_title,
            f"Exam: {(material.exam_type or 'Custom').upper()}",
            f"Topics: {len(topic_names)}",
            f"Assets: {len(assets)}",
            "",
            "---",
            "",
            content or "(No content available)",
        ])
        return Response(
            content=body.encode("utf-8"),
            media_type="text/plain",
            headers={
                "Content-Disposition": f'attachment; filename="{base_name}.txt"',
            },
        )

    raise HTTPException(status_code=400, detail="Unsupported export format. Use pdf, docx, txt, or image.")


# ── GET /study/materials/{id}/file ────────────────────────────────────


@router.get("/materials/{material_id}/file")
async def get_material_file(
    material_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    logger.info("[file] material_id=%s user=%s", material_id, current_user.id)
    result = await db.execute(
        select(StudyMaterial).where(
            StudyMaterial.id == material_id,
            StudyMaterial.user_id == current_user.id,
        )
    )
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")
    if not material.original_file_data:
        raise HTTPException(status_code=404, detail="Original file not available")

    mime = material.file_mime_type or "application/octet-stream"
    return Response(
        content=material.original_file_data,
        media_type=mime,
        headers={
            "Content-Disposition": f'inline; filename="material_{material_id}{_ext_from_mime(mime)}"',
            "Cache-Control": "private, max-age=3600",
        },
    )


# ── GET /study/materials/{id}/pages ───────────────────────────────────


@router.get("/materials/{material_id}/pages")
async def get_material_pages(
    material_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    logger.info("[pages] material_id=%s user=%s", material_id, current_user.id)
    result = await db.execute(
        select(StudyMaterial).where(
            StudyMaterial.id == material_id,
            StudyMaterial.user_id == current_user.id,
        )
    )
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")
    if not material.original_file_data:
        raise HTTPException(status_code=404, detail="Original file not available")

    mime = material.file_mime_type or ""
    if mime != "application/pdf":
        raise HTTPException(status_code=400, detail="Only PDF page rendering is supported")

    if len(material.original_file_data) == 0:
        raise HTTPException(status_code=400, detail="Empty PDF file")

    try:
        import fitz  # PyMuPDF
    except ImportError:
        logger.exception("[pages] PyMuPDF not installed")
        raise HTTPException(status_code=500, detail="PDF renderer not configured on server")

    try:
        pdf = fitz.open(stream=material.original_file_data, filetype="pdf")
    except Exception as exc:
        logger.exception("[pages] failed to open PDF material_id=%s err=%s", material_id, exc)
        raise HTTPException(status_code=400, detail="Stored file is not a valid PDF") from exc

    try:
        pages: list[dict] = []
        for page_num in range(len(pdf)):
            page = pdf[page_num]
            pix = page.get_pixmap(dpi=150)
            img_bytes = pix.tobytes("png")
            pages.append({
                "page": page_num + 1,
                "total": len(pdf),
                "image_base64": __import__("base64").b64encode(img_bytes).decode("ascii"),
                "width": pix.width,
                "height": pix.height,
            })
        pdf.close()
        return {"pages": pages}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("[pages] PDF rendering failed material_id=%s err=%s", material_id, exc)
        raise HTTPException(status_code=500, detail=f"PDF rendering failed: {exc}") from exc


# ── POST /study/generate ────────────────────────────────────────────


@router.post("/generate", response_model=GenerateAssetResponse)
async def generate_asset(
    payload: GenerateAssetRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(StudyMaterial).where(
            StudyMaterial.id == payload.material_id,
            StudyMaterial.user_id == current_user.id,
        )
    )
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    if not material.parsed_structure:
        raise HTTPException(status_code=400, detail="Material has no parsed structure. Re-upload or try again.")

    import json as _json
    parsed = _json.loads(material.parsed_structure)

    topics = parsed.get("topics", [])

    if payload.mode == "topic":
        if not payload.topic:
            raise HTTPException(status_code=400, detail="Topic name is required in topic mode.")
        topic_data = None
        for t in topics:
            if t.get("name") == payload.topic:
                topic_data = t
                break
        if topic_data is None:
            available = [t.get("name", "") for t in topics]
            raise HTTPException(
                status_code=404,
                detail=f"Topic '{payload.topic}' not found. Available topics: {', '.join(available)}",
            )
        context_parts = []
        context_parts.append(f"Topic: {topic_data['name']}")
        for st in topic_data.get("subtopics", []):
            context_parts.append(f"  - {st}")
        for cc in topic_data.get("key_concepts", []):
            context_parts.append(f"    * {cc}")
        context = "\n".join(context_parts)

        if payload.asset_type == "mcq":
            prompt = MCQ_TOPIC_GENERATOR.format(topic=payload.topic, context=context, count=payload.count, difficulty=payload.difficulty)
        elif payload.asset_type == "flashcard":
            prompt = FLASHCARD_TOPIC_GENERATOR.format(topic=payload.topic, context=context, count=payload.count)
        elif payload.asset_type == "essay":
            prompt = ESSAY_TOPIC_GENERATOR.format(topic=payload.topic, context=context, count=payload.count)
        elif payload.asset_type == "diagram":
            prompt = DIAGRAM_GENERATOR.format(topic=payload.topic, context=context, education_level=payload.education_level or "secondary")
        elif payload.asset_type == "video":
            prompt = VIDEO_SCRIPT_GENERATOR.format(topic=payload.topic, context=context, education_level=payload.education_level or "secondary")
        else:
            raise HTTPException(status_code=400, detail=f"Unknown asset type: {payload.asset_type}")

    else:
        context_parts = []
        for topic in topics:
            context_parts.append(f"Topic: {topic['name']}")
            for st in topic.get("subtopics", []):
                context_parts.append(f"  - {st}")
            for cc in topic.get("key_concepts", []):
                context_parts.append(f"    * {cc}")
        context = "\n".join(context_parts)

        if payload.asset_type == "mcq":
            # Reuse the exam context builder so pre-generated MCQs draw on
            # the real material rather than only the topic outline, and
            # so the requested difficulty actually reaches the prompt.
            prompt = MCQ_ALL_TOPICS_GENERATOR.format(
                context=_build_mcq_context(material),
                count=payload.count,
                exam_style=EXAM_STYLE_GUIDES.get(
                    material.exam_type, EXAM_STYLE_GUIDES["custom"]
                ),
                difficulty=DIFFICULTY_GUIDES.get(
                    payload.difficulty, DIFFICULTY_GUIDES["medium"]
                ),
            )
        elif payload.asset_type == "flashcard":
            prompt = FLASHCARD_ALL_TOPICS_GENERATOR.format(context=context, count=payload.count)
        elif payload.asset_type == "essay":
            prompt = ESSAY_ALL_TOPICS_GENERATOR.format(context=context, count=payload.count)
        elif payload.asset_type == "diagram":
            prompt = DIAGRAM_GENERATOR.format(topic="All Topics", context=context, education_level=payload.education_level or "secondary")
        elif payload.asset_type == "video":
            prompt = VIDEO_SCRIPT_GENERATOR.format(topic="All Topics", context=context, education_level=payload.education_level or "secondary")
        else:
            raise HTTPException(status_code=400, detail=f"Unknown asset type: {payload.asset_type}")

    ai_result = await route_ai(prompt, task_type="fast", db=db)

    content = None
    try:
        content = _json.loads(ai_result["response"])
    except Exception:
        logger.error("Asset generator returned non-JSON: %s", ai_result["response"][:200])
        raise HTTPException(status_code=502, detail="AI returned invalid format. Try again.")

    if payload.asset_type == "mcq" and isinstance(content, dict) and isinstance(
        content.get("questions"), list
    ):
        # Store the same normalized shape the exam engine grades against,
        # so MCQs generated as an asset stay consistent with exam MCQs.
        content = {"questions": _normalize_exam_questions(content["questions"])}

    # Videos cost more than text assets — the same source of truth the
    # unlock endpoint enforces, so the advertised price always matches.
    points_cost = (
        VIDEO_UNLOCK_POINTS_COST if payload.asset_type == "video" else UNLOCK_POINTS_COST
    )

    asset = StudyAsset(
        material_id=payload.material_id,
        asset_type=payload.asset_type,
        content_json=_json.dumps(content),
        points_to_unlock=points_cost,
        # Single-topic generation keeps its topic name so quiz results
        # roll up into `StudyProgress` for that topic. All-topics assets
        # leave it NULL — their questions span topics and can't be
        # attributed to any single one.
        topic=payload.topic if payload.mode == "topic" else None,
    )
    db.add(asset)
    await db.commit()
    await db.refresh(asset)

    return GenerateAssetResponse(assets=[content])


# ── Study progress (per-topic mastery) ─────────────────────────────────

# Mastery is monotonic: a topic that was once "mastered" stays mastered
# even if a later retake scores lower. Rank order drives both the
# non-demotion rule in the upsert and the read-path aggregation.
_STATUS_RANK: dict[str, int] = {
    "not_started": 0,
    "reviewing": 1,
    "mastered": 2,
}


def _topic_index_for(material: StudyMaterial, topic_name: str) -> int:
    """Resolve a topic's position in the material's parsed structure.

    Falls back to 0 when the name isn't in the (possibly re-parsed)
    structure — the unique key is the topic *name*, so a stale index
    still lands on the right row.
    """
    import json as _json

    try:
        parsed = _json.loads(material.parsed_structure or "{}")
    except ValueError:
        return 0
    for idx, topic in enumerate(parsed.get("topics", []) or []):
        if isinstance(topic, dict) and topic.get("name") == topic_name:
            return idx
    return 0


async def _upsert_topic_progress(
    db: AsyncSession,
    user_id: int,
    material: StudyMaterial,
    topic_name: str,
    status: str,
    mastery_score: int | None = None,
    topic_index: int | None = None,
) -> StudyProgress:
    """Insert or update the single progress row for (user, material, topic).

    The row is keyed by topic *name* — the identity the generator and the
    parsed structure both use. Existing rows are updated in place:
    status never demotes, mastery_score keeps the best value seen, and
    last_reviewed_at always advances. Callers own the commit so the
    write can share a transaction with the caller's own mutations.
    """
    if topic_index is None:
        topic_index = _topic_index_for(material, topic_name)

    result = await db.execute(
        select(StudyProgress).where(
            StudyProgress.user_id == user_id,
            StudyProgress.material_id == material.id,
            StudyProgress.topic_name == topic_name,
        )
    )
    progress = result.scalar_one_or_none()

    now = datetime.utcnow()
    if progress is None:
        progress = StudyProgress(
            user_id=user_id,
            material_id=material.id,
            topic_index=topic_index,
            topic_name=topic_name,
            status=status,
            mastery_score=mastery_score,
            last_reviewed_at=now,
        )
        db.add(progress)
    else:
        progress.topic_index = topic_index
        if _STATUS_RANK.get(status, 0) >= _STATUS_RANK.get(progress.status, 0):
            progress.status = status
        if mastery_score is not None and (
            progress.mastery_score is None or mastery_score > progress.mastery_score
        ):
            progress.mastery_score = mastery_score
        progress.last_reviewed_at = now

    return progress


# ── POST /study/progress ─────────────────────────────────────────────
@router.post("/progress", response_model=StudyProgressResponse, status_code=201)
async def update_progress(
    payload: StudyProgressUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(StudyMaterial).where(
            StudyMaterial.id == payload.material_id,
            StudyMaterial.user_id == current_user.id,
        )
    )
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    progress = await _upsert_topic_progress(
        db,
        current_user.id,
        material,
        payload.topic_name,
        payload.status,
        mastery_score=payload.mastery_score,
        topic_index=payload.topic_index,
    )
    await db.commit()
    await db.refresh(progress)
    return progress


@router.get("/materials/{material_id}/progress", response_model=StudyProgressListResponse)
async def get_progress(
    material_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(StudyMaterial).where(
            StudyMaterial.id == material_id,
            StudyMaterial.user_id == current_user.id,
        )
    )
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    import json as _json
    parsed = _json.loads(material.parsed_structure or '{"topics": []}')
    topics = parsed.get("topics", []) or []
    total_topics = len(topics)

    progress_result = await db.execute(
        select(StudyProgress).where(
            StudyProgress.user_id == current_user.id,
            StudyProgress.material_id == material_id,
        )
    )
    progress_rows = progress_result.scalars().all()

    # One row per topic is now enforced by the unique index, but rows
    # written before it existed (or by older code paths) can still
    # duplicate. Keep the strongest status, then the best score, then
    # the most recent review — this is what feeds the counts below.
    strongest_by_topic: dict[str, StudyProgress] = {}
    for row in progress_rows:
        current = strongest_by_topic.get(row.topic_name)
        if current is None or (
            _STATUS_RANK.get(row.status, 0),
            row.mastery_score or -1,
            row.last_reviewed_at or row.created_at,
        ) > (
            _STATUS_RANK.get(current.status, 0),
            current.mastery_score or -1,
            current.last_reviewed_at or current.created_at,
        ):
            strongest_by_topic[row.topic_name] = row

    # Every topic of the material appears in the response, not just the
    # ones with rows — untouched topics report "not_started" so the
    # dashboard can render the full set without guessing. Rows for
    # topics that no longer exist in the parsed structure are dropped
    # so counts can never exceed total_topics.
    progress: list[StudyProgressResponse] = []
    mastered = 0
    reviewing = 0
    for idx, topic in enumerate(topics):
        topic_name = str(topic.get("name", "")) if isinstance(topic, dict) else ""
        row = strongest_by_topic.pop(topic_name, None)
        if row is None:
            progress.append(
                StudyProgressResponse(
                    id=None,
                    material_id=material_id,
                    topic_index=idx,
                    topic_name=topic_name,
                    status="not_started",
                    mastery_score=None,
                    last_reviewed_at=None,
                )
            )
            continue
        if row.status == "mastered":
            mastered += 1
        elif row.status == "reviewing":
            reviewing += 1
        progress.append(
            StudyProgressResponse(
                id=row.id,
                material_id=row.material_id,
                topic_index=row.topic_index,
                topic_name=row.topic_name,
                status=row.status,
                mastery_score=row.mastery_score,
                last_reviewed_at=row.last_reviewed_at,
            )
        )

    not_started = max(0, total_topics - mastered - reviewing)

    return StudyProgressListResponse(
        material_id=material_id,
        total_topics=total_topics,
        mastered=mastered,
        reviewing=reviewing,
        not_started=not_started,
        progress=progress,
    )


# ── POST /study/examples/generate ───────────────────────────────────


@router.post("/examples/generate", response_model=GenerateAssetResponse, status_code=201)
async def generate_example(
    payload: ExampleGenerateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(StudyMaterial).where(
            StudyMaterial.id == payload.material_id,
            StudyMaterial.user_id == current_user.id,
        )
    )
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    if not material.parsed_structure:
        raise HTTPException(status_code=400, detail="Material has no parsed structure. Re-upload or try again.")

    import json as _json
    parsed = _json.loads(material.parsed_structure)
    topics = parsed.get("topics", [])

    context_parts = []
    target_topic = payload.topic
    if payload.mode == "topic" and target_topic:
        topic_data = next((t for t in topics if t.get("name") == target_topic), None)
        if not topic_data:
            available = [t.get("name", "") for t in topics]
            raise HTTPException(status_code=404, detail=f"Topic '{target_topic}' not found. Available: {', '.join(available)}")
        context_parts.append(f"Topic: {topic_data['name']}")
        for st in topic_data.get("subtopics", []):
            context_parts.append(f"  - {st}")
        for cc in topic_data.get("key_concepts", []):
            context_parts.append(f"    * {cc}")
    else:
        for topic in topics:
            context_parts.append(f"Topic: {topic['name']}")
            for st in topic.get("subtopics", []):
                context_parts.append(f"  - {st}")
            for cc in topic.get("key_concepts", []):
                context_parts.append(f"    * {cc}")
        target_topic = "All Topics"

    context = "\n".join(context_parts)
    prompt = EXAMPLE_GENERATOR.format(
        topic=target_topic,
        context=context,
        education_level=payload.education_level or "secondary",
        subject_hints=payload.subject_hints,
    )

    ai_result = await route_ai(prompt, task_type="fast", db=db)

    content = None
    try:
        content = _json.loads(ai_result["response"])
    except Exception:
        logger.error("Example generator returned non-JSON: %s", ai_result["response"][:200])
        raise HTTPException(status_code=502, detail="AI returned invalid format. Try again.")

    asset = StudyAsset(
        material_id=payload.material_id,
        asset_type="example",
        content_json=_json.dumps(content),
        points_to_unlock=UNLOCK_POINTS_COST,
    )
    db.add(asset)
    await db.commit()
    await db.refresh(asset)

    return GenerateAssetResponse(assets=[content])


# ── POST /study/examples/check ──────────────────────────────────────


@router.post("/examples/check", response_model=ExampleCheckResponse)
async def check_example(
    payload: ExampleCheckRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    asset_result = await db.execute(
        select(StudyAsset).where(
            StudyAsset.id == payload.example_id,
            StudyAsset.asset_type == "example",
        )
    )
    asset = asset_result.scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=404, detail="Example not found")

    material_result = await db.execute(
        select(StudyMaterial).where(
            StudyMaterial.id == asset.material_id,
            StudyMaterial.user_id == current_user.id,
        )
    )
    if not material_result.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Not your material")

    import json as _json
    content = _json.loads(asset.content_json)
    try_data = content.get("try_yourself", {})

    checker_prompt = f"""You are a friendly tutor checking a student's answer to a practice problem.

Problem: {try_data.get('problem', '')}
Correct final answer: {try_data.get('final_answer', '')}
Student's answer: {payload.user_answer}

Available hints (use only if the student is wrong):
{chr(10).join(f"- {h}" for h in try_data.get('hints', []))}

Solution steps:
{chr(10).join(f"{i+1}. {s}" for i, s in enumerate(try_data.get('solution_steps', [])))}

Output strict JSON only. No markdown. No backticks. No extra text.
{{
  "correct": true/false,
  "feedback": "Encouraging feedback on their answer",
  "hint": "A helpful hint if they got it wrong (null if correct)",
  "next_step_instruction": "What to do next",
  "show_answer": false
}}

Rules:
- Be encouraging, not discouraging
- If correct: congratulate and suggest moving to the next topic
- If wrong: explain what went wrong in simple terms, don't just say "incorrect"
- Use the hints provided above
- show_answer should be true only if the student has attempted 3+ times (we'll track this client-side for now)"""

    ai_result = await route_ai(checker_prompt, task_type="fast", db=db)

    check_result = None
    try:
        check_result = _json.loads(ai_result["response"])
    except Exception:
        logger.error("Example checker returned non-JSON: %s", ai_result["response"][:200])
        raise HTTPException(status_code=502, detail="AI returned invalid format. Try again.")

    return ExampleCheckResponse(
        correct=check_result.get("correct", False),
        feedback=check_result.get("feedback", "Keep trying!"),
        hint=check_result.get("hint"),
        next_step_instruction=check_result.get("next_step_instruction"),
        show_answer=check_result.get("show_answer", False),
    )


# ── POST /study/chat (streaming) ────────────────────────────────────


@router.post("/chat")
@limiter.limit("20/minute")
async def chat_study(
    request: Request,
    payload: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Streaming AI tutor chat over one study material.

    The model call happens BEFORE the response starts so a provider
    failure returns a real 503 (the client renders it as an error
    message). Errors raised mid-stream used to terminate an
    already-committed 200, leaving the client with a silent empty
    bubble.

    Per-user daily quota: this calls a paid model with no free tier,
    so the call is admitted against `study_chat_daily_limit`
    (premium gets `study_chat_premium_daily_limit`). Failed model
    calls are refunded. See services/ai_usage.py.
    """
    result = await db.execute(
        select(StudyMaterial).where(
            StudyMaterial.id == payload.material_id,
            StudyMaterial.user_id == current_user.id,
        )
    )
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    daily_limit = (
        settings.study_chat_premium_daily_limit
        if is_premium(current_user)
        else settings.study_chat_daily_limit
    )
    allowed, remaining = check_and_record(current_user.id, daily_limit)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail=f"Daily AI chat limit reached ({daily_limit}/day). Try again tomorrow.",
        )

    context = build_material_context(
        material.parsed_structure,
        material.raw_input,
        budget=_CHAT_CONTEXT_CHARS,
        outline_label="Syllabus outline (the topics this material covers):",
    )

    system_prompt = CHAT_TUTOR_SYSTEM.format(
        context=context or "No structured context available.",
        education_level=payload.education_level,
        difficulty=payload.difficulty,
    )
    language_name = LANGUAGE_NAMES.get((payload.language or "").lower())
    if language_name and language_name != "English":
        system_prompt += (
            f"\n\nReply in {language_name}. Keep key subject terms in English "
            "in parentheses where students will need the exam wording."
        )

    # Decide the model before calling, so the choice is logged and the
    # cost is intended rather than incidental. Generation tasks keep
    # using premium; chat is the one place complexity varies.
    from app.ai.routing import classify_turn

    decision = classify_turn(payload.message, material_title=material.title)
    tier = decision.model_tier if settings.ai_routing_enabled else "premium"

    try:
        ai_result = await route_ai(
            payload.message,
            task_type="chat",
            max_tokens=2000,
            db=db,
            system_prompt=system_prompt,
            history=[turn.model_dump() for turn in payload.history],
            model_tier=tier,
        )
    except HTTPException:
        # Provider failed after we admitted the call — give the slot
        # back so an outage doesn't burn the user's daily quota.
        release(current_user.id)
        raise
    text = ai_result["response"]
    logger.info(
        "study chat: user=%s material=%s tier=%s reason=%s score=%s model=%s usage=%s",
        current_user.id,
        material.id,
        tier,
        decision.reason,
        decision.score,
        ai_result.get("model"),
        ai_result.get("usage"),
    )

    async def generate():
        # Re-emit the completed answer in small chunks so the client
        # can render it progressively. React Native's fetch can't read
        # a streamed body incrementally, so upstream token streaming
        # would not reach the UI anyway.
        for word in text.split(" "):
            yield word + " "

    return StreamingResponse(generate(), media_type="text/plain")


# ── POST /study/unlock ──────────────────────────────────────────────

# Payment methods study spends accept. `points` is the legacy name for
# the spendable wallet and `sv` is its modern alias — both hit the same
# balance; `cashable` hits the withdrawable side. Both sides are the
# same unit (POINTS_PER_NAIRA = 10, so 1 pt = ₦0.10), which is why a
# price quoted in sv is paid from either wallet at face value.
_SV_METHODS = {"points", "sv"}


def _wallet_field_for(method: str) -> str:
    """The balance column a study payment debits.

    `cashable` -> `cashable_balance` when the wallet split is on (the
    user spends withdrawable earnings), otherwise the legacy
    `points_balance` — pre-split wallets only ever had the one balance.
    `sv`/`points` -> `service_credit_balance` when split, same fallback.
    """
    if not settings.wallet_split_enabled:
        return "points_balance"
    return "cashable_balance" if method == "cashable" else "service_credit_balance"


async def _debit_wallet(
    db: AsyncSession,
    user_id: int,
    method: str,
    amount: int,
) -> int:
    """Debit `amount` points from the wallet the user chose, or 402.

    Returns the wallet's new balance. The caller owns the commit so the
    debit can share a transaction with its ledger row — a rejected
    payment therefore never writes anything.
    """
    field = _wallet_field_for(method)
    label = "cashable points" if method == "cashable" else "service credits"

    result = await db.execute(
        select(getattr(User, field)).where(User.id == user_id)
    )
    balance = result.scalar_one() or 0
    if balance < amount:
        raise HTTPException(
            status_code=402,
            detail=f"Need {amount} {label}. You have {balance}.",
        )

    await db.execute(
        update(User)
        .where(User.id == user_id)
        .values({getattr(User, field): getattr(User, field) - amount})
    )
    result = await db.execute(
        select(getattr(User, field)).where(User.id == user_id)
    )
    return result.scalar_one() or 0


@router.post("/unlock", response_model=UnlockResponse)
async def unlock_asset(
    payload: UnlockRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Check if user is premium (imports at top needed)
    from app.services.subscription import is_premium
    
    asset_result = await db.execute(
        select(StudyAsset).where(StudyAsset.id == payload.asset_id)
    )
    asset = asset_result.scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    # Verify ownership: user must own the parent material
    material_result = await db.execute(
        select(StudyMaterial).where(
            StudyMaterial.id == asset.material_id,
            StudyMaterial.user_id == current_user.id,
        )
    )
    if not material_result.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Not your material")

    # Premium users unlock for free
    if is_premium(current_user):
        import json as _json
        txn = StudyTransaction(
            user_id=current_user.id,
            asset_id=asset.id,
            method="premium",
            points_spent=0,
            reward_granted=True,
        )
        db.add(txn)
        await db.commit()
        return UnlockResponse(
            unlocked=True,
            content=_json.loads(asset.content_json),
            new_balance=current_user.points_balance,
            method="premium",
            points_spent=0,
        )

    # The user picks the wallet: `sv` (alias of the legacy `points`) is
    # the spendable side, `cashable` spends withdrawable earnings. Both
    # are the same unit, so the price is identical either way — the
    # choice only decides which balance goes down.
    method = payload.method
    if method in _SV_METHODS:
        method = "points"
    if method not in {"points", "cashable"}:
        raise HTTPException(status_code=400, detail="Invalid method")

    new_balance = await _debit_wallet(
        db, current_user.id, method, asset.points_to_unlock
    )

    txn = StudyTransaction(
        user_id=current_user.id,
        asset_id=asset.id,
        method=method,
        points_spent=asset.points_to_unlock,
        reward_granted=True,
    )
    db.add(txn)
    await db.commit()

    import json as _json
    return UnlockResponse(
        unlocked=True,
        content=_json.loads(asset.content_json),
        new_balance=new_balance,
        method=method,
        points_spent=asset.points_to_unlock,
    )


# ── POST /study/materials/{material_id}/unlock-audio ───────────────────

AUDIO_UNLOCK_BASE_SV = 20
AUDIO_UNLOCK_CHAR_STEP = 500


def _audio_unlock_cost_sv(content: str | None) -> int:
    length = len(content or "")
    return AUDIO_UNLOCK_BASE_SV + max(0, (length // AUDIO_UNLOCK_CHAR_STEP) * 10)


class AudioUnlockResponse(BaseModel):
    unlocked: bool
    material_id: int
    cost_sv: int
    method: str
    new_balance: int
    url: str | None = None
    provider: str | None = None


@router.post("/materials/{material_id}/unlock-audio", response_model=AudioUnlockResponse)
async def unlock_material_audio(
    material_id: int,
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Payment is sv or cashable — the spendable wallet first, with
    # withdrawable earnings as the alternative. (The rewarded-ad method
    # the old UI advertised has no pipeline behind it and stays
    # rejected.) The request is validated explicitly so it can never
    # fall off the end of the handler into a None-return 500. `sv` is
    # stored as-is: it's this endpoint's historical value, unlike the
    # asset unlock where `sv` is an alias of the legacy `points`.
    method = str(payload.get("method") or "sv").lower()
    if method not in {"sv", "cashable"}:
        raise HTTPException(status_code=400, detail="method must be 'sv' or 'cashable'")

    material_result = await db.execute(
        select(StudyMaterial).where(
            StudyMaterial.id == material_id,
            StudyMaterial.user_id == current_user.id,
        )
    )
    material = material_result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    existing_result = await db.execute(
        select(AudioUnlock).where(
            AudioUnlock.user_id == current_user.id,
            AudioUnlock.material_id == material_id,
        )
    )
    existing = existing_result.scalar_one_or_none()
    if existing:
        # Report the balance of the wallet the unlock was actually paid
        # from — a cashable unlock must not show the sv balance as if it
        # had been charged.
        field = _wallet_field_for(
            "cashable" if existing.method == "cashable" else "sv"
        )
        balance_result = await db.execute(
            select(getattr(User, field)).where(User.id == current_user.id)
        )
        return AudioUnlockResponse(
            unlocked=True,
            material_id=material_id,
            cost_sv=0,
            method="existing",
            new_balance=balance_result.scalar_one() or 0,
            url=f"/api/v1/study/tts/audio/{material_id}_cached.mp3",
            provider="cached",
        )

    cost_sv = _audio_unlock_cost_sv(material.content)

    new_balance = await _debit_wallet(
        db, current_user.id, method, cost_sv
    )

    unlock = AudioUnlock(
        user_id=current_user.id,
        material_id=material_id,
        method=method,
        cost_sv=cost_sv,
    )
    db.add(unlock)
    await db.commit()

    return AudioUnlockResponse(
        unlocked=True,
        material_id=material_id,
        cost_sv=cost_sv,
        method=method,
        new_balance=new_balance,
        url=f"/api/v1/study/tts/audio/{material_id}_cached.mp3",
        provider="unlocked",
    )



class AudioUnlockStatusResponse(BaseModel):
    unlocked: bool
    material_id: int
    method: str | None = None
    cost_sv: int = 0


@router.get("/materials/{material_id}/audio-status", response_model=AudioUnlockStatusResponse)
async def get_audio_unlock_status(
    material_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    material_result = await db.execute(
        select(StudyMaterial).where(
            StudyMaterial.id == material_id,
            StudyMaterial.user_id == current_user.id,
        )
    )
    material = material_result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    from app.services.subscription import is_premium
    if is_premium(current_user):
        return AudioUnlockStatusResponse(unlocked=True, material_id=material_id, method="premium")

    unlock_result = await db.execute(
        select(AudioUnlock).where(
            AudioUnlock.user_id == current_user.id,
            AudioUnlock.material_id == material_id,
        )
    )
    unlock = unlock_result.scalar_one_or_none()
    if unlock:
        return AudioUnlockStatusResponse(unlocked=True, material_id=material_id, method=unlock.method, cost_sv=unlock.cost_sv)

    return AudioUnlockStatusResponse(unlocked=False, material_id=material_id, cost_sv=_audio_unlock_cost_sv(material.content))


# ── POST /study/quiz/complete ────────────────────────────────────────


BONUS_THRESHOLD = 80
BONUS_POINTS = 20


@router.post("/quiz/complete", response_model=QuizCompleteResponse)
async def complete_quiz(
    payload: QuizCompleteRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    asset_result = await db.execute(
        select(StudyAsset).where(StudyAsset.id == payload.asset_id)
    )
    asset = asset_result.scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    material_result = await db.execute(
        select(StudyMaterial).where(
            StudyMaterial.id == asset.material_id,
            StudyMaterial.user_id == current_user.id,
        )
    )
    material = material_result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=403, detail="Not your material")

    # Quiz results roll up into per-topic mastery before any bonus
    # maths — progress is the student's record, the bonus is the reward.
    # Only single-topic assets carry a topic name; all-topics quizzes
    # span topics and stay out of per-topic progress.
    if asset.topic:
        status = "mastered" if payload.score >= BONUS_THRESHOLD else "reviewing"
        await _upsert_topic_progress(
            db,
            current_user.id,
            material,
            asset.topic,
            status,
            mastery_score=payload.score,
        )
        await db.commit()

    bonus_awarded = False
    bonus_points = 0
    new_balance = current_user.service_credit_balance if settings.wallet_split_enabled else current_user.points_balance

    if payload.score >= BONUS_THRESHOLD:
        bonus_points = BONUS_POINTS
        if settings.wallet_split_enabled:
            await db.execute(
                update(User)
                .where(User.id == current_user.id)
                .values(service_credit_balance=User.service_credit_balance + bonus_points)
            )
        else:
            await db.execute(
                update(User)
                .where(User.id == current_user.id)
                .values(points_balance=User.points_balance + bonus_points)
            )
        txn = StudyTransaction(
            user_id=current_user.id,
            asset_id=asset.id,
            method="quiz_bonus",
            points_spent=-bonus_points,
            reward_granted=True,
        )
        db.add(txn)
        await db.commit()
        if settings.wallet_split_enabled:
            new_balance_result = await db.execute(
                select(User.service_credit_balance).where(User.id == current_user.id)
            )
        else:
            new_balance_result = await db.execute(
                select(User.points_balance).where(User.id == current_user.id)
            )
        new_balance = new_balance_result.scalar_one() or 0
        bonus_awarded = True

    # Send push notification for bonus (fire-and-forget)
    if bonus_awarded:
        try:
            from app.services.fcm import send_push_notification_background
            from app.services.notifications import create_notification_background
            import asyncio
            asyncio.create_task(send_push_notification_background(
                user_id=current_user.id,
                title="Quiz Bonus! 🎉",
                body=f"You scored {payload.score}% and earned +{bonus_points} points!",
                data={"type": "quiz_bonus", "score": str(payload.score), "points": str(bonus_points)},
                category="study_reminders",
            ))
            asyncio.create_task(create_notification_background(
                user_id=current_user.id,
                title="Quiz Bonus! 🎉",
                body=f"You scored {payload.score}% and earned +{bonus_points} points!",
                category="study_reminders",
                data={"type": "quiz_bonus", "score": payload.score, "points": bonus_points},
            ))
        except Exception:
            pass

    return QuizCompleteResponse(
        bonus_awarded=bonus_awarded,
        bonus_points=bonus_points,
        new_balance=new_balance,
        message=(
            f"Great job! +{bonus_points} pts for scoring {payload.score}%"
            if bonus_awarded
            else f"Score: {payload.score}%. Get {BONUS_THRESHOLD}%+ for a +{BONUS_POINTS} pts bonus!"
        ),
    )


# ── POST /study/session/start ───────────────────────────────────────


from pydantic import BaseModel


class SessionStartRequest(BaseModel):
    material_id: int


class SessionStartResponse(BaseModel):
    session_id: int
    started_at: str


class SessionEndRequest(BaseModel):
    session_id: int


class SessionEndResponse(BaseModel):
    session_id: int
    duration_seconds: int
    ended_at: str


class StudySession:
    """DB-backed session tracking using ReadingSession."""

    @classmethod
    async def start(cls, db: AsyncSession, user_id: int, material_id: int) -> int:
        session = ReadingSession(
            user_id=user_id,
            content_id=material_id,
            start_time=datetime.utcnow(),
            duration_seconds=0,
            points_earned=0,
            verified=False,
            scroll_events=0,
            total_paused_seconds=0,
        )
        db.add(session)
        await db.commit()
        await db.refresh(session)
        return session.id

    @classmethod
    async def end(cls, db: AsyncSession, session_id: int, user_id: int) -> dict | None:
        result = await db.execute(
            select(ReadingSession).where(
                ReadingSession.id == session_id,
                ReadingSession.user_id == user_id,
                ReadingSession.end_time.is_(None),
            )
        )
        session = result.scalar_one_or_none()
        if not session:
            return None

        ended_at = datetime.utcnow()
        duration = int((ended_at - session.start_time).total_seconds())
        session.end_time = ended_at
        session.duration_seconds = duration
        await db.commit()
        await db.refresh(session)

        return {
            "session_id": session.id,
            "user_id": session.user_id,
            "material_id": session.content_id,
            "started_at": session.start_time,
            "ended_at": session.end_time,
            "duration_seconds": session.duration_seconds,
        }

    @classmethod
    async def get(cls, db: AsyncSession, session_id: int, user_id: int) -> dict | None:
        result = await db.execute(
            select(ReadingSession).where(
                ReadingSession.id == session_id,
                ReadingSession.user_id == user_id,
            )
        )
        session = result.scalar_one_or_none()
        if not session:
            return None
        return {
            "session_id": session.id,
            "user_id": session.user_id,
            "material_id": session.content_id,
            "started_at": session.start_time,
            "ended_at": session.end_time,
            "duration_seconds": session.duration_seconds,
        }


@router.post("/session/start", response_model=SessionStartResponse, status_code=201)
async def start_study_session(
    payload: SessionStartRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Start a study session for time tracking"""
    # Verify material ownership
    material_result = await db.execute(
        select(StudyMaterial).where(
            StudyMaterial.id == payload.material_id,
            StudyMaterial.user_id == current_user.id,
        )
    )
    if not material_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Material not found")
    
    session_id = await StudySession.start(db, current_user.id, payload.material_id)
    
    return SessionStartResponse(
        session_id=session_id,
        started_at=datetime.utcnow().isoformat(),
    )


@router.post("/session/end", response_model=SessionEndResponse)
async def end_study_session(
    payload: SessionEndRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """End a study session and get duration"""
    session = await StudySession.end(db, payload.session_id, current_user.id)
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    if session["user_id"] != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")
    
    # Notify on study milestone: 30+ minutes
    if session.get("duration_seconds", 0) >= 30 * 60:
        try:
            from app.services.fcm import send_push_notification_background
            from app.services.notifications import create_notification_background
            import asyncio
            duration_min = session["duration_seconds"] // 60
            asyncio.create_task(send_push_notification_background(
                user_id=current_user.id,
                title="Study Milestone! 📚",
                body=f"You studied for {duration_min} minutes. Keep it up!",
                data={"type": "study_reminder", "duration_minutes": str(duration_min)},
                category="study_reminders",
            ))
            asyncio.create_task(create_notification_background(
                user_id=current_user.id,
                title="Study Milestone! 📚",
                body=f"You studied for {duration_min} minutes. Keep it up!",
                category="study_reminders",
                data={"type": "study_reminder", "duration_minutes": duration_min},
            ))
        except Exception:
            pass

    return SessionEndResponse(
        session_id=payload.session_id,
        duration_seconds=session["duration_seconds"],
        ended_at=session["ended_at"].isoformat(),
    )


# ── POST /study/tts ───────────────────────────────────────────────────
class TtsResponse(BaseModel):
    url: str
    provider: str
    cached: bool


@router.post("/tts", response_model=TtsResponse)
async def synthesize_study_tts(
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """On-demand TTS for study material text.

    Body: { "text": str, "parsed_structure"?: object, "voice"?: str,
            "provider"?: str, "material_id"?: int }
    Returns: { "url": str, "provider": str, "cached": bool }

    Uses the hybrid provider chain in services/tts_hybrid.py.
    Audio is cached to disk; repeat reads return the cached URL.
    Gated on premium or audio_unlock for the material.
    """
    # Shape before capping so the character budget is spent on narration
    # rather than on raw OCR text (page numbers, headers, artifacts).
    text = study_narration.build_narration(payload)
    if not text.strip():
        raise HTTPException(status_code=400, detail="text is required")

    material_id = payload.get("material_id")
    if material_id is not None:
        from app.services.subscription import is_premium
        if not is_premium(current_user):
            unlock_result = await db.execute(
                select(AudioUnlock).where(
                    AudioUnlock.user_id == current_user.id,
                    AudioUnlock.material_id == int(material_id),
                )
            )
            if not unlock_result.scalar_one_or_none():
                raise HTTPException(
                    status_code=403,
                    detail="Audio locked. Unlock this material to listen.",
                )

    voice = payload.get("voice") or settings.tts_default_voice
    provider = payload.get("provider") or settings.tts_default_provider

    try:
        audio, used_provider, cache_path = await tts_hybrid.synthesize_study_audio(text, voice, provider=provider)
    except Exception as exc:
        logger.error("TTS synthesis failed for user=%s: %s", current_user.id, exc)
        raise HTTPException(status_code=502, detail=f"TTS synthesis failed: {exc}")

    return TtsResponse(
        url=f"/api/v1/study/tts/audio/{cache_path.name}",
        provider=used_provider,
        cached=True,
    )


# ── GET /study/tts/audio/{filename} ──────────────────────────────────
@router.get("/tts/audio/{filename}")
async def serve_study_tts_audio(filename: str):
    """Serve cached TTS audio files. Public, cached 1 day."""
    safe_name = filename.replace("..", "_").replace("/", "_")
    candidate = AUDIO_CACHE_DIR / "tts" / "*" / safe_name
    matches = list(AUDIO_CACHE_DIR.glob(f"tts/*/{safe_name}"))
    if not matches:
        raise HTTPException(status_code=404, detail="Audio not found")
    path = matches[0]
    raw = path.read_bytes()
    # Detect format from file signature so the client gets the right
    # content-type (Cloudflare MeloTTS returns WAV, edge-tts returns MP3).
    if raw[:4] == b"RIFF" and raw[8:12] == b"WAVE":
        media_type = "audio/wav"
    elif raw[:2] == b"ID3" or raw[:3] == b"\xff\xfb" or raw[:3] == b"\xff\xf3":
        media_type = "audio/mpeg"
    else:
        media_type = "audio/mpeg"
    return Response(
        content=raw,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=86400"},
    )


# ── Export helpers ─────────────────────────────────────────────────────

def _split_paragraphs(text: str) -> list[str]:
    parts = text.split("\n\n")
    return [p.strip() for p in parts if p.strip()]


def _wrap_text(text: str, max_width: int, font) -> list[str]:
    """Very basic word-wrap for PIL bitmap fonts."""
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        test = f"{current} {word}".strip()
        try:
            bbox = font.getbbox(test)
            width = bbox[2] - bbox[0]
        except Exception:
            width = len(test) * 10
        if width > max_width and current:
            lines.append(current)
            current = word
        else:
            current = test
    if current:
        lines.append(current)
    return lines or [""]


def _ext_from_mime(mime: str) -> str:
    mapping = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/heic": ".heic",
        "application/pdf": ".pdf",
        "application/msword": ".doc",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
        "text/plain": ".txt",
    }
    return mapping.get(mime.lower().split(";", 1)[0].strip(), "")


# ── Exam Mode ────────────────────────────────────────────────────────


# Per-board exam settings. Derived from the canonical registry in
# app/exam_types.py so there is exactly one place to add or tune a board.
# Re-exported here because existing import sites reference these names.
EXAM_DURATIONS = {
    spec.key: spec.duration_minutes for spec in EXAM_TYPE_SPECS
}
EXAM_QUESTION_COUNTS = {
    spec.key: spec.question_count for spec in EXAM_TYPE_SPECS
}

def _normalize_exam_questions(raw: list[dict]) -> list[dict]:
    """Coerce AI-generated MCQs into the shape the exam engine expects.

    The generator prompts emit `correct_index` (an index into `options`)
    and no per-question id. Grading reads a literal `answer` string and a
    unique `id`, so without this step every question would default to
    id 0, `question_map` would collapse to a single entry, and every
    answer would grade as incorrect.

    Also defends against malformed AI output: questions with fewer than
    two options or an out-of-range correct index are repaired or skipped
    rather than stored as ungradeable.
    """
    out: list[dict] = []
    for i, q in enumerate(raw):
        if not isinstance(q, dict):
            continue
        options = list(q.get("options") or [])
        question_text = (q.get("question") or "").strip()
        if len(options) < 2 or not question_text:
            continue

        correct_index = q.get("correct_index")
        if correct_index is None:
            # Tolerate a generator that already emits the answer text.
            answer_text = q.get("answer") or ""
            correct_index = (
                options.index(answer_text) if answer_text in options else 0
            )

        try:
            correct_index = int(correct_index)
        except (TypeError, ValueError):
            correct_index = 0
        if correct_index < 0 or correct_index >= len(options):
            correct_index = 0

        out.append(
            {
                "id": i + 1,
                "question": question_text,
                "options": options,
                "answer": options[correct_index],
                "correct_index": correct_index,
                "explanation": q.get("explanation") or "",
                "topic": q.get("topic") or "",
            }
        )
    return out


# Character budgets for the material context. A budget — not an
# omission — is what keeps a prompt inside the model's context window:
# the tutor and the exam generator both get the student's actual
# material, and only genuinely oversized documents are sliced.
_MCQ_CONTEXT_CHARS = 12_000
_CHAT_CONTEXT_CHARS = 100_000


def build_material_context(
    parsed_structure: object,
    raw_input: str | None,
    *,
    budget: int,
    outline_label: str,
) -> str:
    """Build the study-material context for an AI prompt.

    The student's own material is the primary source. The topic outline
    is included alongside it so the model knows the structure, but it is
    a supplement, never a substitute — an outline alone is only a table
    of contents, and a model taught from headings cannot answer
    questions about the text.

    `budget` bounds the raw material so a document with no upload-time
    character cap cannot blow the context window. When the material
    exceeds it, the head is kept (it carries the opening definitions and
    framing) with a truncation marker so the model knows it is partial
    rather than silently answering as though it had everything.

    Falls back to the outline when there is no usable raw text.
    """
    import json as _json

    parsed: dict = {}
    if isinstance(parsed_structure, str) and parsed_structure.strip():
        try:
            loaded = _json.loads(parsed_structure)
        except (ValueError, TypeError):
            # A corrupted structure must degrade to the raw material,
            # not fail the whole request.
            loaded = None
        if isinstance(loaded, dict):
            parsed = loaded
    topics = parsed.get("topics") or []

    outline_parts = []
    for topic in topics:
        if not isinstance(topic, dict):
            continue
        outline_parts.append(f"Topic: {topic.get('name', '')}")
        for st in topic.get("subtopics", []):
            outline_parts.append(f"  - {st}")
        for cc in topic.get("key_concepts", []):
            outline_parts.append(f"    * {cc}")
    outline = "\n".join(outline_parts)

    raw_text = (raw_input or "").strip()

    if not raw_text:
        return outline or "(no study material available)"

    if len(raw_text) > budget:
        # Keep the head, which carries the opening definitions and
        # framing, rather than a truncated middle.
        raw_text = (
            raw_text[:budget].rstrip()
            + "\n\n[... truncated: the material is longer than the "
            "space available here ...]"
        )

    if not outline:
        return raw_text

    return (
        f"{outline_label}\n"
        f"{outline}\n\n"
        "The student's study material in full:\n"
        f"{raw_text}"
    )


def _build_mcq_context(material: StudyMaterial) -> str:
    """Context for the MCQ generator: material at the exam budget."""
    return build_material_context(
        material.parsed_structure,
        material.raw_input,
        budget=_MCQ_CONTEXT_CHARS,
        outline_label="Syllabus outline (use to distribute questions across topics):",
    )


async def _generate_exam_questions(
    material: StudyMaterial,
    exam_type: str,
    count: int,
    difficulty: str = "medium",
) -> list[dict]:
    """Generate exam questions from material using AI.

    Receives the full study material (not just the topic outline), a
    per-board style guide, and an explicit difficulty level — all three
    now reach the prompt. Returns the parsed question list normalized
    for grading, without persisting a StudyAsset.
    """
    import json as _json

    context = _build_mcq_context(material)
    exam_style = EXAM_STYLE_GUIDES.get(exam_type, EXAM_STYLE_GUIDES["custom"])
    difficulty_guide = DIFFICULTY_GUIDES.get(difficulty, DIFFICULTY_GUIDES["medium"])

    prompt = MCQ_ALL_TOPICS_GENERATOR.format(
        context=context,
        count=count,
        exam_style=exam_style,
        difficulty=difficulty_guide,
    )
    ai_result = await route_ai(prompt, task_type="fast", db=None)

    content = None
    try:
        content = _json.loads(ai_result["response"])
    except Exception:
        logger.error("Exam question generator returned non-JSON: %s", ai_result["response"][:200])
        raise HTTPException(status_code=502, detail="AI returned invalid format. Try again.")

    questions = content.get("questions", []) if isinstance(content, dict) else []
    if not questions:
        raise HTTPException(status_code=502, detail="AI returned no questions. Try again.")

    normalized = _normalize_exam_questions(questions)
    if not normalized:
        raise HTTPException(
            status_code=502,
            detail="AI returned ungradeable questions. Try again.",
        )
    return normalized


@router.post("/exam/start", response_model=ExamStartResponse)
async def start_exam(
    payload: ExamStartRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create an exam attempt, generate questions on-demand, schedule auto-submit."""
    result = await db.execute(
        select(StudyMaterial).where(
            StudyMaterial.id == payload.material_id,
            StudyMaterial.user_id == current_user.id,
        )
    )
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    if not material.parsed_structure and not material.raw_input:
        raise HTTPException(status_code=400, detail="Material has no content to generate questions from.")

    question_count = EXAM_QUESTION_COUNTS.get(payload.exam_type, 10)
    duration_seconds = EXAM_DURATIONS.get(payload.exam_type, 30) * 60

    questions = await _generate_exam_questions(
        material,
        payload.exam_type,
        question_count,
        difficulty=payload.difficulty or "medium",
    )

    import json as _json
    now = datetime.utcnow()
    expires_at = now + timedelta(seconds=duration_seconds)

    session = ExamSession(
        user_id=current_user.id,
        material_id=payload.material_id,
        exam_type=payload.exam_type,
        status="in_progress",
        started_at=now,
        expires_at=expires_at,
        total_questions=len(questions),
        questions_json=_json.dumps(questions),
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    # Schedule auto-submit via APScheduler
    try:
        import app.services.scheduled_bills as _scheduled_bills
        if _scheduled_bills.scheduler is not None and _scheduled_bills.scheduler.running:
            from app.services.scheduler import auto_submit_exam
            _scheduled_bills.scheduler.add_job(
                auto_submit_exam,
                "date",
                run_date=expires_at,
                args=[session.id],
                id=f"exam_timeout_{session.id}",
                replace_existing=True,
                misfire_grace_time=60,
            )
            logger.info("Scheduled exam auto-submit: session_id=%s expires_at=%s", session.id, expires_at.isoformat())
    except Exception as exc:
        logger.error("Failed to schedule exam auto-submit: session_id=%s err=%s", session.id, exc)

    # Strip answers from questions before returning to client
    safe_questions = []
    for q in questions:
        safe_questions.append({
            "id": q.get("id", 0),
            "question": q.get("question", ""),
            "options": q.get("options", []),
            "explanation": q.get("explanation"),
        })

    return ExamStartResponse(
        session_id=session.id,
        exam_type=payload.exam_type,
        total_questions=len(questions),
        duration_seconds=duration_seconds,
        expires_at=expires_at,
        questions=safe_questions,
    )


@router.get("/exam/{session_id}/questions")
async def get_exam_questions(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Fetch questions for an active exam session (for recovery/reconnect)."""
    result = await db.execute(
        select(ExamSession).where(
            ExamSession.id == session_id,
            ExamSession.user_id == current_user.id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Exam session not found")

    if session.status != "in_progress":
        raise HTTPException(status_code=400, detail=f"Exam is no longer active (status: {session.status})")

    import json as _json
    questions = _json.loads(session.questions_json)

    # Return saved answers alongside questions
    answers_result = await db.execute(
        select(ExamAnswer).where(ExamAnswer.session_id == session_id)
    )
    saved_answers = {row.question_id: row.selected_answer for row in answers_result.scalars().all()}

    safe_questions = []
    for q in questions:
        safe_questions.append({
            "id": q.get("id", 0),
            "question": q.get("question", ""),
            "options": q.get("options", []),
            "explanation": q.get("explanation"),
            "saved_answer": saved_answers.get(q.get("id", 0)),
        })

    return {
        "session_id": session.id,
        "status": session.status,
        "expires_at": session.expires_at.isoformat(),
        "total_questions": session.total_questions,
        "questions": safe_questions,
    }


@router.post("/exam/{session_id}/answer", response_model=ExamAnswerConfirm)
async def submit_exam_answer(
    session_id: int,
    payload: ExamAnswerSubmit,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Save a single answer for an exam question (supports auto-save)."""
    result = await db.execute(
        select(ExamSession).where(
            ExamSession.id == session_id,
            ExamSession.user_id == current_user.id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Exam session not found")

    if session.status != "in_progress":
        raise HTTPException(status_code=400, detail=f"Exam is no longer active (status: {session.status})")

    # Verify the question exists in this exam
    import json as _json
    questions = _json.loads(session.questions_json)
    question_map = {q.get("id", 0): q for q in questions}
    question = question_map.get(payload.question_id)
    if not question:
        raise HTTPException(status_code=404, detail="Question not found in this exam")

    correct_answer = question.get("answer", "")
    is_correct = payload.selected_answer == correct_answer

    # Upsert answer
    answer_result = await db.execute(
        select(ExamAnswer).where(
            ExamAnswer.session_id == session_id,
            ExamAnswer.question_id == payload.question_id,
        )
    )
    existing = answer_result.scalar_one_or_none()
    if existing:
        existing.selected_answer = payload.selected_answer
        existing.is_correct = is_correct
        existing.answered_at = datetime.utcnow()
    else:
        db.add(ExamAnswer(
            session_id=session_id,
            question_id=payload.question_id,
            selected_answer=payload.selected_answer,
            is_correct=is_correct,
        ))
    await db.commit()

    return ExamAnswerConfirm(question_id=payload.question_id, is_correct=is_correct)


@router.post("/exam/{session_id}/submit", response_model=ExamSubmitResponse)
async def submit_exam(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Finalize exam, calculate score server-side, mark as submitted.

    Exam results deliberately do NOT roll into `StudyProgress`
    (per-topic mastery): `_generate_exam_questions` draws questions
    across all topics and stores no per-question topic tag, so an exam
    score can't be attributed to individual topics the way a
    single-topic quiz (`/study/quiz/complete`) can. Per-topic exam
    roll-up needs topic-tagged exam questions first — until then,
    topical mastery comes from topic-scoped quizzes.
    """
    result = await db.execute(
        select(ExamSession).where(
            ExamSession.id == session_id,
            ExamSession.user_id == current_user.id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Exam session not found")

    if session.status not in ("in_progress",):
        raise HTTPException(status_code=400, detail=f"Exam already {session.status}")

    import json as _json
    questions = _json.loads(session.questions_json)
    question_map = {q.get("id", 0): q for q in questions}

    answers_result = await db.execute(
        select(ExamAnswer).where(ExamAnswer.session_id == session_id)
    )
    answers = {row.question_id: row for row in answers_result.scalars().all()}

    correct_count = 0
    wrong_count = 0
    for q in questions:
        qid = q.get("id", 0)
        answer = answers.get(qid)
        if answer and answer.is_correct:
            correct_count += 1
        else:
            wrong_count += 1

    total = len(questions)
    score = total > 0 and round((correct_count / total) * 100) or 0

    now = datetime.utcnow()
    session.status = "submitted"
    session.submitted_at = now
    session.score = score
    session.correct_count = correct_count
    session.wrong_count = wrong_count
    await db.commit()
    await db.refresh(session)

    # Cancel the scheduled timeout job since we submitted manually
    try:
        import app.services.scheduled_bills as _scheduled_bills
        if _scheduled_bills.scheduler is not None and _scheduled_bills.scheduler.running:
            job_id = f"exam_timeout_{session_id}"
            try:
                _scheduled_bills.scheduler.remove_job(job_id)
                logger.info("Cancelled exam timeout job: session_id=%s", session_id)
            except Exception:
                pass
    except Exception as exc:
        logger.error("Failed to cancel exam timeout job: session_id=%s err=%s", session_id, exc)

    return ExamSubmitResponse(
        session_id=session.id,
        score=score,
        correct_count=correct_count,
        wrong_count=wrong_count,
        total_questions=total,
        passed=score >= 60,
    )


@router.get("/exam/history")
async def get_exam_history(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all past exam attempts for the current user."""
    result = await db.execute(
        select(ExamSession)
        .where(ExamSession.user_id == current_user.id)
        .where(ExamSession.status.in_(["submitted", "timed_out", "flagged"]))
        .order_by(ExamSession.created_at.desc())
    )
    sessions = result.scalars().all()

    history = []
    for s in sessions:
        passed = (s.score or 0) >= 60
        history.append({
            "id": s.id,
            "exam_type": s.exam_type,
            "score": s.score,
            "correct_count": s.correct_count,
            "wrong_count": s.wrong_count,
            "total_questions": s.total_questions,
            "started_at": s.started_at.isoformat(),
            "submitted_at": s.submitted_at.isoformat() if s.submitted_at else None,
            "passed": passed,
        })

    return history


@router.get("/exam/{session_id}/result")
async def get_exam_result(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get detailed result for a completed exam attempt."""
    result = await db.execute(
        select(ExamSession).where(
            ExamSession.id == session_id,
            ExamSession.user_id == current_user.id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Exam session not found")

    if session.status not in ("submitted", "timed_out", "flagged"):
        raise HTTPException(status_code=400, detail="Exam not yet completed")

    import json as _json
    questions = _json.loads(session.questions_json)

    answers_result = await db.execute(
        select(ExamAnswer).where(ExamAnswer.session_id == session_id)
    )
    answers = {row.question_id: row for row in answers_result.scalars().all()}

    detailed_questions = []
    for q in questions:
        qid = q.get("id", 0)
        answer = answers.get(qid)
        detailed_questions.append({
            "id": qid,
            "question": q.get("question", ""),
            "options": q.get("options", []),
            "correct_answer": q.get("answer", ""),
            "selected_answer": answer.selected_answer if answer else None,
            "is_correct": answer.is_correct if answer else False,
            "explanation": q.get("explanation"),
        })

    return ExamResultDetail(
        session_id=session.id,
        exam_type=session.exam_type,
        score=session.score or 0,
        correct_count=session.correct_count,
        wrong_count=session.wrong_count,
        total_questions=session.total_questions,
        passed=(session.score or 0) >= 60,
        started_at=session.started_at,
        submitted_at=session.submitted_at,
        questions=detailed_questions,
    )



# ── Paid audio narration (episodes) ───────────────────────────────────


class AudioQuoteRequest(BaseModel):
    topic_indexes: list[int] = []
    level: str | None = None


class AudioBatchCreateRequest(BaseModel):
    topic_indexes: list[int] = []
    level: str | None = None


class AudioPositionRequest(BaseModel):
    position_seconds: float = 0.0
    completed: bool = False


def _batch_payload(batch) -> dict:
    """Serialise a batch row, including a streamable URL when ready.

    The URL is a short-lived presigned R2 link, regenerated on every
    read, so the client never holds a link that can expire.
    """
    audio_url = None
    if batch.status == "ready" and batch.audio_key:
        audio_url = r2_storage.audio_url_for(batch.audio_key)
    return {
        "id": batch.id,
        "topic_index": batch.topic_index,
        "episode_index": batch.episode_index,
        "total_episodes": batch.total_episodes,
        "level": batch.level,
        "status": batch.status,
        "cost_sv": batch.cost_sv,
        "char_count": batch.char_count,
        "estimated_seconds": batch.est_duration_seconds,
        "actual_duration_seconds": batch.actual_duration_seconds,
        "audio_url": audio_url,
        "position_seconds": batch.position_seconds,
        "completed_at": batch.completed_at.isoformat() if batch.completed_at else None,
        "refunded_at": batch.refunded_at.isoformat() if batch.refunded_at else None,
        "error_message": batch.error_message,
        "created_at": batch.created_at.isoformat() if batch.created_at else None,
    }


async def _load_material_for_user(db: AsyncSession, material_id: int, user_id: int):
    from sqlalchemy import select as _select
    result = await db.execute(
        _select(StudyMaterial).where(
            StudyMaterial.id == material_id,
            StudyMaterial.user_id == user_id,
        )
    )
    return result.scalar_one_or_none()


def _parsed_of(material) -> dict:
    """The material's parsed structure, decoded from its stored JSON."""
    if material is None:
        return {}
    parsed = material.parsed_structure
    if isinstance(parsed, dict):
        return parsed
    if isinstance(parsed, str):
        import json
        try:
            loaded = json.loads(parsed)
            return loaded if isinstance(loaded, dict) else {}
        except Exception:
            return {}
    return {}


@router.get("/audio/topics/{material_id}")
async def list_narratable_topics(
    material_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Topics available for narration, with per-topic episode counts."""
    material = await _load_material_for_user(db, material_id, current_user.id)
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    parsed = _parsed_of(material)
    topics = study_narration_topic_names(parsed)
    return {
        "material_id": material_id,
        "title": material.title,
        "topics": topics,
        "levels": list(audio_pricing.VALID_LEVELS),
        "default_level": audio_pricing.DEFAULT_LEVEL,
    }


@router.post("/audio/quote/{material_id}")
async def quote_audio_narration(
    material_id: int,
    payload: AudioQuoteRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Price a narration request. Charges nothing."""
    material = await _load_material_for_user(db, material_id, current_user.id)
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    parsed = _parsed_of(material)
    level = audio_pricing.normalise_level(payload.level)

    indexes = payload.topic_indexes or [
        t["topic_index"] for t in study_narration_topic_names(parsed)
    ]
    if not indexes:
        raise HTTPException(
            status_code=400,
            detail="This material has no narratable topics yet.",
        )

    quoted = study_audio_service.quote(
        parsed_structure=parsed, topic_indexes=indexes, level=level
    )
    quoted["balance_sv"] = await study_audio_service.read_balance(db, current_user.id)
    return quoted


@router.post("/audio/batches/{material_id}")
async def create_audio_batches(
    material_id: int,
    payload: AudioBatchCreateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Debit SV and queue the requested episodes for generation."""
    material = await _load_material_for_user(db, material_id, current_user.id)
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    parsed = _parsed_of(material)
    available = study_narration_topic_names(parsed)
    valid = {t["topic_index"] for t in available}
    indexes = [i for i in (payload.topic_indexes or []) if i in valid]
    if not indexes:
        raise HTTPException(status_code=400, detail="No valid topics selected.")

    result = await study_audio_service.create_batches(
        db,
        user_id=current_user.id,
        material_id=material_id,
        parsed_structure=parsed,
        topic_indexes=indexes,
        level=audio_pricing.normalise_level(payload.level),
    )
    if not result.get("ok"):
        raise HTTPException(
            status_code=402 if result.get("error") == "insufficient_sv" else 400,
            detail=result.get("detail", "Could not start generation."),
        )

    # Generation is client-poll-driven: the client calls
    # POST /audio/generate-next/{material_id} to drive the queue.
    return result


@router.get("/audio/batches/{material_id}")
async def list_audio_batches(
    material_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Episodes for a material, with playback positions."""
    batches = await study_audio_service.list_batches(
        db, user_id=current_user.id, material_id=material_id
    )
    items = [_batch_payload(b) for b in batches]

    # "Next" is the first episode not yet completed — playlist resume is
    # derived from the same stored position, so it costs nothing extra.
    next_id = next(
        (b["id"] for b in items if b["completed_at"] is None and b["status"] == "ready"),
        None,
    )
    return {
        "material_id": material_id,
        "episodes": items,
        "next_episode_id": next_id,
        "total_cost_sv": sum(b["cost_sv"] for b in items),
        "refunded_sv": sum(
            b["cost_sv"] for b in items if b["refunded_at"] is not None
        ),
    }


@router.post("/audio/batches/{batch_id}/position")
async def save_audio_position(
    batch_id: int,
    payload: AudioPositionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Persist playback position, so re-opening resumes where they stopped."""
    ok = await study_audio_service.save_position(
        db, batch_id, current_user.id, payload.position_seconds
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Episode not found")
    if payload.completed:
        await study_audio_service.mark_completed(db, batch_id, current_user.id)
    return {"ok": True, "position_seconds": payload.position_seconds}


@router.post("/audio/batches/{batch_id}/retry")
async def retry_audio_batch(
    batch_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Re-queue a refunded episode. Charges again — its debit was returned."""
    from sqlalchemy import select as _select

    result = await db.execute(
        _select(StudyAudioBatch).where(
            StudyAudioBatch.id == batch_id,
            StudyAudioBatch.user_id == current_user.id,
        )
    )
    batch = result.scalar_one_or_none()
    if not batch:
        raise HTTPException(status_code=404, detail="Episode not found")
    if batch.status != "failed":
        raise HTTPException(status_code=400, detail="Only failed episodes can be retried")

    retried = await study_audio_service.retry_failed(
        db,
        user_id=current_user.id,
        material_id=batch.material_id,
        parsed_structure={},
        topic_indexes=[batch.topic_index],
        level=batch.level,
    )
    if not retried.get("ok"):
        raise HTTPException(
            status_code=402 if retried.get("error") == "insufficient_sv" else 400,
            detail=retried.get("detail", "Could not retry."),
        )
    # Generation is client-poll-driven via /audio/generate-next.
    return retried


async def _generate_one_episode(db: AsyncSession, batch) -> None:
    """Generate, synthesise, store, and mark ready one episode.

    Runs inside the request that polled for work. Any failure marks the
    batch failed, which refunds its debit — the user is never charged for
    audio they cannot hear, and there is no fallback to reading raw
    material.
    """
    await study_audio_service.mark_generating(db, batch.id)

    material = await _load_material_for_user(db, batch.material_id, batch.user_id)
    if material is None:
        raise RuntimeError("Material not found")

    parsed = _parsed_of(material)

    script, level, char_count = await study_narration.generate_episode_script(
        material_title=material.title,
        parsed_structure=parsed,
        topic_index=batch.topic_index,
        level=batch.level,
        episode_index=batch.episode_index,
        total_episodes=batch.total_episodes,
    )

    if not r2_storage.is_configured():
        # Refusing to store on the ephemeral Render filesystem: the file
        # would vanish on the next spin-down and the user would have
        # paid for audio that no longer exists.
        raise RuntimeError(
            "Cloudflare R2 is not configured; audio cannot be stored durably."
        )

    voice = settings.tts_default_voice
    provider = settings.tts_default_provider
    audio, used_provider, cache_path = await tts_hybrid.synthesize_study_audio(
        script, voice, provider=provider
    )

    key = r2_storage.object_key(cache_path.name)
    r2_storage.upload_bytes(key, audio, content_type="audio/mpeg")

    await study_audio_service.mark_ready(
        db,
        batch.id,
        script_text=script,
        char_count=char_count,
        audio_key=key,
        provider=used_provider,
        duration_seconds=audio_pricing.estimate_duration_seconds(char_count),
    )
    await db.commit()


@router.post("/audio/generate-next/{material_id}")
async def generate_next_audio_episode(
    material_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate the next queued episode for a material.

    Generation is driven by the client, not by a background task or a
    cron worker: `main.py` documents that Render's free tier cannot
    reliably run in-process background tasks, and an in-request worker
    is restart-safe because all progress lives in Postgres.

    One episode per call keeps each request short. A failure marks the
    batch failed and refunds it, so the client can safely retry.
    """
    result = await db.execute(
        select(StudyAudioBatch).where(
            StudyAudioBatch.material_id == material_id,
            StudyAudioBatch.user_id == current_user.id,
            StudyAudioBatch.status == "queued",
        ).order_by(StudyAudioBatch.id)
    )
    batch = result.scalars().first()

    if batch is None:
        return {"processed": None, "remaining": 0}

    await _generate_one_episode(db, batch)

    remaining_result = await db.execute(
        select(StudyAudioBatch.id).where(
            StudyAudioBatch.material_id == material_id,
            StudyAudioBatch.user_id == current_user.id,
            StudyAudioBatch.status == "queued",
        )
    )
    return {
        "processed": batch.id,
        "topic_index": batch.topic_index,
        "episode_index": batch.episode_index,
        "remaining": len(remaining_result.scalars().all()),
    }


def _rehydrate_topics(parsed: dict) -> list[dict]:
    """Return the topic list from a parsed structure, defensively."""
    topics = parsed.get("topics") if isinstance(parsed, dict) else None
    return topics if isinstance(topics, list) else []


def study_narration_topic_names(parsed: dict) -> list[dict]:
    """Describe each narratable topic for the client."""
    topics = _rehydrate_topics(parsed)
    items: list[dict] = []
    for index, topic in enumerate(topics):
        if not isinstance(topic, dict):
            continue
        name = " ".join(str(topic.get("name") or "").split()).strip()
        source = study_narration.build_topic_source(parsed, index)
        items.append(
            {
                "topic_index": index,
                "name": name or f"Topic {index + 1}",
                "subtopics": [
                    " ".join(str(s).split()).strip()
                    for s in (topic.get("subtopics") or [])
                    if isinstance(s, str) and str(s).strip()
                ],
                "char_count": len(source),
                "episodes": study_narration.episodes_for_topic(len(source)),
            }
        )
    if not items:
        source = study_narration.build_topic_source(parsed, 0)
        if source:
            items.append(
                {
                    "topic_index": 0,
                    "name": "Full material",
                    "subtopics": [],
                    "char_count": len(source),
                    "episodes": study_narration.episodes_for_topic(len(source)),
                }
            )
    return items
