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
from typing import Callable

import httpx

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, or_, select, update
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
    FIGURE_DESCRIPTION_PROMPT,
    FLASHCARD_ALL_TOPICS_GENERATOR,
    FLASHCARD_GENERATOR,
    FLASHCARD_TOPIC_GENERATOR,
    LANGUAGE_NAMES,
    MCQ_ALL_TOPICS_GENERATOR,
    MCQ_GENERATOR,
    MCQ_TOPIC_GENERATOR,
    SOW_PARSER,
    VIDEO_SCRIPT_GENERATOR,
    VISION_OCR_PROMPT,
)
from app.ai.router import route_ai
from app.exam_types import (
    EXAM_DURATIONS,
    EXAM_QUESTION_COUNTS,
    EXAM_TYPE_KEYS,
    EXAM_TYPE_SPECS,
    normalize_exam_type,
)
from app.services.ai_cost import log_usage, model_cost_usd
from app.services import tts_hybrid
from app.models import (
    AiUsageLog,
    AudioUnlock,
    ExamAnswer,
    ExamSession,
    SowUploadJob,
    StudyAsset,
    StudyAudioBatch,
    StudyMaterial,
    StudyProgress,
    StudyFigure,
    StudyPage,
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
from app.services import study_explanation
from app.services import page_artifacts
from app.services import r2_storage
import app.services.tts_hybrid as tts_hybrid
from app.limiter import limiter
from app.services.ai_usage import check_and_record, peek_count, release
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
    MaterialFigure,
    MaterialPage,
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

# Called with (percent, stage) as an upload advances. The stage is a
# stable machine-readable code the client translates into a label, so
# the progress bar can say *what* is happening instead of just moving.
ProgressCallback = Callable[[int, str], None]

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

# PDF → image → OCR rendering budget.
#
# The preview renderer above produces 900px thumbnails so the phone can
# flip through a document fast. That resolution is too low for OCR —
# small print turns to mush — so the extraction path renders its own,
# wider pages. 1400px keeps body text legible to the vision model while
# staying small enough that a page costs ~150-300 KB of base64.
_OCR_PAGE_MAX_WIDTH = 1400
_OCR_PAGE_JPEG_QUALITY = 75

# Each Cloudflare vision call is a full round trip, so pages are OCR'd
# concurrently. Four at a time keeps a 12-page scan at roughly three
# rounds instead of twelve, without hammering the API.
_OCR_PAGE_CONCURRENCY = 4

# Hard cap on how many pages one document may OCR. The preview endpoint
# already caps at 20 pages for the same reason: past that the upload
# stops being a "SOW" and starts being a book, and the request would
# run long enough to hit the platform's request timeout.
_OCR_MAX_PAGES = 20

# How deep the explanation and the narration are pitched. "primary" is
# the default: a student who uploads a syllabus wants it explained to
# them the way a good teacher would, not the way a paper is written.
_EDUCATION_LEVELS: frozenset[str] = frozenset({
    "primary",
    "secondary",
    "tertiary",
    "research",
})


def _normalise_education_level(value: str | None) -> str:
    """Clamp an education level to one the prompts know how to pitch."""
    level = (value or "").strip().lower()
    if level in _EDUCATION_LEVELS:
        return level
    fallback = (settings.study_education_default_level or "primary").strip().lower()
    return fallback if fallback in _EDUCATION_LEVELS else "primary"


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

    # The teaching layer: the same material rewritten in plain language
    # for a beginner. It is an extra model call, and a failure here
    # must not lose the upload — the faithful structure is the source of
    # truth and the app falls back to it.
    explanation = await _build_explanation_safely(
        title=title,
        source_text=payload.text,
        figures=[],
        level=_normalise_education_level(payload.education_level),
    )

    material = StudyMaterial(
        user_id=current_user.id,
        title=title,
        exam_type=exam_type,
        raw_input=payload.text,
        parsed_structure=_json.dumps(parsed) if parsed else None,
        explanation_structure=_json.dumps(explanation) if explanation else None,
        ai_model_used=ai_result.get("provider"),
        education_level=_normalise_education_level(payload.education_level),
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
    education_level: str | None = Form(default=None),
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
            education_level=_normalise_education_level(education_level),
        )
    )

    return SowUploadJobAccepted(job_id=job.id, status="queued")


# ── PDF page rendering ───────────────────────────────────────────────
# Rendering every page of a PDF at full resolution as base64 PNG is a
# memory bomb: a 20-page scheme of work at 150 DPI is ~60-90 MB of JSON
# that the client then decodes into ~120 MB of bitmaps, which Android
# answers by killing the app process ("the app closed after I picked the
# PDF"). Previews therefore render a capped number of pages at thumbnail
# resolution as JPEG, and tell the client how many pages were skipped so
# it can say so instead of silently hiding the rest of the document.
_PDF_PREVIEW_MAX_PAGES = 20
_PDF_PREVIEW_MAX_WIDTH = 900     # px — readable as a thumbnail, cheap to decode
_PDF_PREVIEW_JPEG_QUALITY = 70


def _render_pdf_pages(pdf, max_pages: int = _PDF_PREVIEW_MAX_PAGES) -> dict:
    """Render up to `max_pages` of an open PyMuPDF document as JPEG pages.

    Returns `{pages, total, truncated, page_limit}`. `page_limit` lets the
    client offer a "load more" affordance instead of pretending the
    document ended at the cap.
    """
    import base64 as _base64

    pages: list[dict] = []
    total = len(pdf)
    truncated = total > max_pages

    for page_num in range(min(total, max_pages)):
        page = pdf[page_num]
        # Scale by page width so any page size lands near the target
        # width instead of depending on the document's DPI.
        zoom = _PDF_PREVIEW_MAX_WIDTH / max(page.rect.width, 1)
        pix = page.get_pixmap(matrix=_fitz_matrix(zoom))
        img_bytes = pix.tobytes("jpeg", jpg_quality=_PDF_PREVIEW_JPEG_QUALITY)
        pages.append({
            "page": page_num + 1,
            "total": total,
            "image_base64": _base64.b64encode(img_bytes).decode("ascii"),
            "width": pix.width,
            "height": pix.height,
        })

    return {
        "pages": pages,
        "total": total,
        "truncated": truncated,
        "page_limit": max_pages,
    }


def _fitz_matrix(zoom: float):
    import fitz

    return fitz.Matrix(zoom, zoom)


def _render_pdf_pages_for_ocr(contents: bytes, page_numbers: list[int]) -> list[bytes]:
    """Render the given 1-indexed PDF pages to JPEG blobs for OCR.

    Uses PyMuPDF — the same renderer the preview endpoint uses — so a
    PDF that previews on the phone is guaranteed to be OCR-able here.
    The pages are rendered wider than the preview thumbnails
    (`_OCR_PAGE_MAX_WIDTH`) because 900px thumbnails are too soft for
    the vision model to read small print.

    Returns one JPEG blob per requested page, in the order requested.
    Pages outside the document are skipped rather than raising.
    """
    import fitz

    rendered: list[bytes] = []
    with fitz.open(stream=contents, filetype="pdf") as pdf:
        total = len(pdf)
        for page_number in page_numbers:
            if page_number < 1 or page_number > total:
                continue
            page = pdf[page_number - 1]
            zoom = _OCR_PAGE_MAX_WIDTH / max(page.rect.width, 1)
            pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
            rendered.append(pix.tobytes("jpeg", jpg_quality=_OCR_PAGE_JPEG_QUALITY))
    return rendered


def _resolve_pdf_page_numbers(contents: bytes, selected_pages: str | None) -> list[int]:
    """Work out which 1-indexed PDF pages to read.

    `selected_pages` is the JSON array the client sends after the user
    picks pages in the preview. An empty or invalid selection must not
    silently produce an empty document, so it falls back to every page.
    """
    import fitz

    with fitz.open(stream=contents, filetype="pdf") as pdf:
        total_pages = len(pdf)

    page_numbers = list(range(1, total_pages + 1))
    if selected_pages:
        try:
            import json as _json
            wanted = [i for i in sorted(set(_json.loads(selected_pages))) if 1 <= i <= total_pages]
            page_numbers = wanted or page_numbers
        except Exception:
            pass
    return page_numbers


async def _ocr_pdf_pages(
    contents: bytes,
    page_numbers: list[int],
    on_page: ProgressCallback | None = None,
) -> str:
    """Render PDF pages to images and OCR each one with Cloudflare Vision.

    A PDF is a layout document, so the page is treated as a picture and
    handed to the same vision model the image-upload route uses. Reading
    the PDF's embedded text instead would only work for documents that
    happen to carry a text layer — a scan or a photo carries none, and
    the AI would receive nothing at all.

    Pages are OCR'd concurrently (bounded by `_OCR_PAGE_CONCURRENCY`)
    because each vision call is a full round trip — twelve pages done
    serially would take a minute. A page that fails is logged and
    skipped; only a total failure raises.
    """
    page_images = _render_pdf_pages_for_ocr(contents, page_numbers)
    if not page_images:
        raise ValueError("pdf_render_failed")

    semaphore = asyncio.Semaphore(_OCR_PAGE_CONCURRENCY)
    total = len(page_images)
    completed = 0

    async def ocr_one(image: bytes) -> str:
        nonlocal completed
        try:
            async with semaphore:
                return await _ocr_image_with_cloudflare(image, "image/jpeg")
        finally:
            # Count the page whether it succeeded or not — otherwise a
            # failed page leaves the progress bar stuck.
            completed += 1
            if on_page is not None:
                on_page(completed, total)

    results = await asyncio.gather(
        *(ocr_one(image) for image in page_images),
        return_exceptions=True,
    )

    chunks: list[str] = []
    failures = 0
    for index, result in enumerate(results):
        if isinstance(result, BaseException):
            failures += 1
            logger.warning(
                "[sow/document] OCR failed for page %s: %s",
                page_numbers[index] if index < len(page_numbers) else index + 1,
                result,
            )
            continue
        if result and result.strip():
            chunks.append(result.strip())

    if not chunks:
        raise ValueError("pdf_ocr_failed")
    if failures:
        logger.warning(
            "[sow/document] %s of %s PDF pages failed OCR — continuing with the rest",
            failures, total,
        )
    return "\n\n".join(chunks)


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
        return _render_pdf_pages(pdf)
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
    education_level: str | None = Form(default=None),
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
            education_level=_normalise_education_level(education_level),
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
        progress=row.progress,
        stage=row.stage,
        updated_at=row.updated_at,
    )


# ── Background workers ───────────────────────────────────────────────


def _sniff_image_content_type(contents: bytes, fallback: str = "image/jpeg") -> str:
    """The real image type of some bytes.

    The content type on an upload is client-supplied and not to be
    trusted: the phone's image picker coerces anything it does not
    recognise to `image/jpeg`, including HEIC. Sending HEIC bytes in a
    data URI that claims JPEG makes the vision model refuse the image,
    and the material is lost with an "OCR failed" the student cannot
    act on. The bytes know what they are.
    """
    if not contents:
        return fallback
    if contents[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if contents[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if contents[:4] == b"RIFF" and contents[8:12] == b"WEBP":
        return "image/webp"
    if contents[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if contents[:4] == b"%PDF":
        return "application/pdf"
    if len(contents) > 12 and contents[4:8] == b"ftyp":
        brand = contents[8:12]
        if brand in (b"heic", b"heix", b"hevc", b"heim", b"heis", b"mif1"):
            return "image/heic"
        if brand in (b"avif", b"avis"):
            return "image/avif"
    return fallback


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
    real_type = _sniff_image_content_type(contents, content_type or "image/jpeg")
    data_uri = f"data:{real_type};base64,{b64}"
    url = (
        f"https://api.cloudflare.com/client/v4/accounts/"
        f"{settings.cloudflare_account_id}/ai/run/@cf/meta/llama-3.2-11b-vision-instruct"
    )
    headers = {
        "Authorization": f"Bearer {settings.cloudflare_api_token}",
        "Content-Type": "application/json",
    }
    body = {
        "prompt": VISION_OCR_PROMPT,
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


async def _describe_figure_with_cloudflare(image_bytes: bytes) -> str:
    """Ask the vision model what one cropped figure shows.

    The crop is a real picture of the student's own material. Its
    description is what the teaching layer explains and what the
    narration speaks, so a student who cannot see the diagram still
    gets everything it contains.

    Returns an empty string on failure — a figure without a description
    is still a figure.
    """
    import base64
    import httpx

    if not image_bytes:
        return ""

    b64 = base64.b64encode(image_bytes).decode()
    # A crop off a PDF page is PNG; an uploaded photo is whatever the
    # phone sent. The bytes decide.
    real_type = _sniff_image_content_type(image_bytes, "image/png")
    data_uri = f"data:{real_type};base64,{b64}"
    url = (
        f"https://api.cloudflare.com/client/v4/accounts/"
        f"{settings.cloudflare_account_id}/ai/run/@cf/meta/llama-3.2-11b-vision-instruct"
    )
    headers = {
        "Authorization": f"Bearer {settings.cloudflare_api_token}",
        "Content-Type": "application/json",
    }
    body = {
        "prompt": FIGURE_DESCRIPTION_PROMPT,
        "image": data_uri,
        "max_tokens": 800,
        "temperature": 0.2,
    }
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            resp = await client.post(url, json=body, headers=headers)
        if resp.status_code != 200:
            logger.warning("[figure] vision HTTP %s", resp.status_code)
            return ""
        data = resp.json()
        return (data.get("result", {}).get("response", "") or "").strip()
    except Exception as exc:
        logger.warning("[figure] vision description failed: %s", exc)
        return ""


async def _describe_figures(artifacts: list) -> list:
    """Describe every cropped figure, a few at a time.

    Each call is a full round trip to the vision model, so they run
    concurrently. A figure that cannot be described keeps an empty
    description rather than failing the upload.
    """
    if not artifacts:
        return []

    semaphore = asyncio.Semaphore(4)

    async def describe(artifact):
        async with semaphore:
            artifact.description = await _describe_figure_with_cloudflare(
                artifact.image_bytes or b""
            )
        # The crop is only needed for the description call; the key and
        # the URL are what get stored.
        artifact.image_bytes = None

    await asyncio.gather(*(describe(a) for a in artifacts), return_exceptions=True)
    return artifacts


async def _extract_document_text(
    contents: bytes,
    filename: str,
    selected_pages: str | None = None,
    on_progress: ProgressCallback | None = None,
) -> str:
    """Branch on extension and extract plain text from PDF / DOCX / TXT.

    Raises a `ValueError` with a user-safe category on any failure;
    the document worker translates that into the right
    `error_message` on the job row.

    A PDF is rendered page by page and read with the same vision model
    the image-upload route uses — a PDF is a layout document, and
    reading its embedded text would only work for documents that
    happen to carry a text layer. A scan or a photo carries none, and
    the AI would receive nothing at all.

    For PDFs, `selected_pages` is a JSON array of 1-indexed page numbers
    to include. If omitted or empty, all pages are read.
    """
    fname = filename.lower()
    if fname.endswith(".pdf"):
        try:
            page_numbers = _resolve_pdf_page_numbers(contents, selected_pages)
            ocr_pages = page_numbers[:_OCR_MAX_PAGES]
            if len(ocr_pages) < len(page_numbers):
                logger.info(
                    "[sow/document] OCR page cap reached — reading %s of %s pages",
                    len(ocr_pages), len(page_numbers),
                )

            def _on_page(done: int, total: int) -> None:
                if on_progress is not None:
                    on_progress(20 + int(50 * done / max(total, 1)), "reading_pages")

            extracted = await _ocr_pdf_pages(contents, ocr_pages, on_page=_on_page)
            if not extracted.strip():
                raise ValueError("pdf_ocr_empty")
            return extracted
        except ValueError:
            raise
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


# The retry prompt. The parser is asked for a document that fills the
# whole output budget, so a long document can run the model out of
# tokens mid-object and the JSON comes back truncated. The fix is not a
# better prompt, it is a second attempt that says so explicitly.
_SOW_REPAIR_PROMPT = """You returned JSON that could not be parsed.

Here is what you returned:
<<<
{raw_response}
>>>

Return the SAME document again, as valid JSON only:
- Start with {{ and end with }}
- No markdown fences, no commentary, no explanation before or after
- Every string must be escaped, including quotes and newlines
- If you were cut off, return what you have and close every open bracket and brace
- Keep the same title, topics and content_blocks you produced

Output the JSON only."""


async def _run_sow_parser(extracted_text: str) -> tuple[dict | None, str | None, str | None]:
    """Run the SOW parser AI prompt. Returns (parsed, provider, raw_response).

    Pulled out of the workers so the image + document paths share the
    exact same parsing logic.

    A response that is not valid JSON is retried once with an explicit
    "valid JSON only" instruction, which is what the phase 3 spec
    called for. Without the retry a long document simply loses its
    structure and the student gets a blank material with no error
    shown.
    """
    prompt = SOW_PARSER.format(raw_text=extracted_text)
    ai_result = await route_ai(prompt, task_type="heavy")
    raw_response = ai_result.get("response", "")
    parsed = _parse_ai_response(raw_response)

    if parsed is None and raw_response:
        logger.warning("[sow] parser returned invalid JSON, retrying once")
        try:
            repair = await route_ai(
                _SOW_REPAIR_PROMPT.format(raw_response=raw_response[:6000]),
                task_type="heavy",
            )
            repaired = _parse_ai_response(repair.get("response", ""))
            if repaired is not None:
                logger.info("[sow] parser repair succeeded")
                return repaired, repair.get("provider"), repair.get("response", "")
            logger.error("[sow] parser repair also returned invalid JSON")
        except Exception as exc:
            logger.error("[sow] parser repair failed: %s", exc)

    return parsed, ai_result.get("provider"), raw_response


async def _mark_job_status(
    job_id: str,
    status: str,
    *,
    material_id: int | None = None,
    error: str | None = None,
    progress: int | None = None,
    stage: str | None = None,
) -> None:
    """Update a job row using its own session.

    The worker runs in a background task with no shared session, so
    each status flip opens `AsyncSessionLocal` briefly.

    `progress` (0-100) and `stage` let the polling client show a real
    progress bar with a stage label instead of guessing at the
    remaining time.
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
        if progress is not None:
            row.progress = progress
        if stage is not None:
            row.stage = stage
        row.updated_at = datetime.utcnow()
        await db.commit()


def _figure_notes(figures: list) -> str:
    """Render the figure descriptions for the AI prompts.

    The OCR pass can only say a figure exists; the crop tells the
    model what it actually contains. Both go to the parser and to the
    teaching layer, so a diagram is never reduced to a stray label.
    """
    lines = []
    for figure in figures:
        description = (figure.description or "").strip()
        if not description:
            continue
        lines.append(
            f"[FIGURE page {figure.page} | figure {figure.index}]: {description}"
        )
    if not lines:
        return ""
    return "\n\nFigures found on the pages:\n" + "\n".join(lines)


async def _build_explanation_safely(
    *,
    title: str,
    source_text: str,
    figures: list,
    level: str,
) -> dict | None:
    """Build the teaching layer, without ever failing the upload.

    The faithful layer is the source of truth; the teaching layer is
    the extra. If the model is unavailable or answers with nonsense,
    the material is still saved with everything that was read from the
    page.
    """
    try:
        figure_dicts = [
            {
                "figure_index": figure.index,
                "page": figure.page,
                "description": figure.description,
                "caption": figure.caption,
            }
            for figure in figures
        ]
        return await study_explanation.build_explanation(
            title=title,
            raw_text=source_text,
            figures=figure_dicts,
            level=level,
        )
    except Exception as exc:
        logger.warning("[sow] explanation layer failed: %s", exc)
        return None


async def _build_material_artifacts(
    *,
    key_prefix: str,
    contents: bytes,
    is_pdf: bool,
    content_type: str,
    extracted_text: str,
    max_pages: int = _OCR_MAX_PAGES,
) -> tuple[list, list]:
    """Render the pages, crop the figures, and describe every figure.

    Runs after the text has been read. Nothing here is allowed to fail
    the upload: a material with no page images or no figures is still a
    valid material, and the app falls back to rendering the source file
    on demand.
    """
    pages: list = []
    figures: list = []

    try:
        if is_pdf:
            pages = page_artifacts.build_page_artifacts(
                contents, key_prefix=key_prefix, max_pages=max_pages
            )
            figures = page_artifacts.build_figure_artifacts(
                contents, key_prefix=key_prefix, max_pages=max_pages
            )
        else:
            pages = page_artifacts.build_image_artifacts(
                contents, key_prefix=key_prefix, content_type=content_type
            )
            # A photo of a textbook page is one image with no geometry
            # to read a figure out of. When the OCR pass reported a
            # diagram, the whole image is treated as that figure so it
            # still gets a proper description.
            if "[FIGURE:" in (extracted_text or "").upper():
                figures.append(
                    page_artifacts.FigureArtifact(
                        index=1,
                        page=1,
                        bbox=(0.0, 0.0, 0.0, 0.0),
                        width=0,
                        height=0,
                        image_bytes=contents,
                    )
                )
    except Exception as exc:
        logger.warning("[sow] artifact build failed: %s", exc)

    await _describe_figures(figures)
    return pages, figures


async def _persist_material(
    *,
    user_id: int,
    title: str,
    exam_type: str | None,
    raw_input: str,
    parsed_structure: dict | None,
    explanation_structure: dict | None,
    contents: bytes,
    file_mime_type: str,
    ai_model_used: str | None,
    education_level: str,
    pages: list,
    figures: list,
) -> int:
    """Write the material and its page/figure artifacts, and return its id."""
    import json as _json

    async with AsyncSessionLocal() as db:
        material = StudyMaterial(
            user_id=user_id,
            title=title,
            exam_type=exam_type,
            raw_input=raw_input,
            parsed_structure=_json.dumps(parsed_structure) if parsed_structure else None,
            explanation_structure=(
                _json.dumps(explanation_structure) if explanation_structure else None
            ),
            original_file_data=contents,
            file_mime_type=file_mime_type,
            ai_model_used=ai_model_used,
            education_level=education_level,
        )
        db.add(material)
        await db.commit()
        await db.refresh(material)

        for page in pages:
            db.add(
                StudyPage(
                    material_id=material.id,
                    page=page.page,
                    width=page.width,
                    height=page.height,
                    image_key=page.image_key,
                    image_url=page.image_url,
                    is_scan=page.is_scan,
                )
            )
        for figure in figures:
            db.add(
                StudyFigure(
                    material_id=material.id,
                    page=figure.page,
                    figure_index=figure.index,
                    bbox=_json.dumps(list(figure.bbox)),
                    width=figure.width,
                    height=figure.height,
                    image_key=figure.image_key,
                    image_url=figure.image_url,
                    description=figure.description or None,
                    caption=figure.caption or None,
                )
            )
        await db.commit()
        return material.id


async def _process_sow_image_job(
    job_id: str,
    user_id: int,
    exam_type: str | None,
    contents: bytes,
    safe_name: str,
    content_type: str,
    education_level: str | None = None,
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
    level = education_level or settings.study_education_default_level
    try:
        await _mark_job_status(job_id, "processing", progress=10, stage="reading_pages")

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

        await _mark_job_status(job_id, "processing", progress=45, stage="reading_pages")
        pages, figures = await _build_material_artifacts(
            key_prefix=job_id,
            contents=contents,
            is_pdf=False,
            content_type=content_type,
            extracted_text=extracted_text,
            max_pages=1,
        )
        notes = _figure_notes(figures)
        source_text = f"{extracted_text}{notes}"

        await _mark_job_status(job_id, "processing", progress=70, stage="parsing_ai")
        try:
            parsed, provider, _ = await _run_sow_parser(source_text)
            logger.info(
                "[sow/upload-image worker] parser done job=%s provider=%s keys=%s",
                job_id, provider, list((parsed or {}).keys()) if isinstance(parsed, dict) else None,
            )
        except Exception as exc:
            logger.error("SOW parser AI failed for job %s: %s", job_id, exc)
            raise RuntimeError("ai_parser_failed") from exc

        title = (parsed or {}).get("title", safe_name) if isinstance(parsed, dict) else safe_name

        await _mark_job_status(job_id, "processing", progress=85, stage="parsing_ai")
        explanation = await _build_explanation_safely(
            title=title,
            source_text=source_text,
            figures=figures,
            level=level,
        )

        await _mark_job_status(job_id, "processing", progress=92, stage="saving")
        material_id = await _persist_material(
            user_id=user_id,
            title=title,
            exam_type=exam_type,
            raw_input=f"[IMAGE: {safe_name}]\n{source_text}",
            parsed_structure=parsed,
            explanation_structure=explanation,
            contents=contents,
            file_mime_type=content_type or "image/jpeg",
            ai_model_used=provider,
            education_level=level,
            pages=pages,
            figures=figures,
        )

        logger.info(
            "[sow/upload-image worker] DONE job=%s material_id=%s",
            job_id, material_id,
        )
        await _mark_job_status(
            job_id, "completed", material_id=material_id, progress=100, stage="completed"
        )
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
    education_level: str | None = None,
) -> None:
    """Background worker for the document SOW upload. Same shape as
    the image worker — runs extraction + AI parse, writes the
    material, updates the job row.

    Progress is reported as it happens: `reading_pages` while the
    document is read (or OCR'd page by page), `parsing_ai` while the
    model works, `saving` while the material is written. The client
    polls those to drive its progress bar.
    """
    level = education_level or settings.study_education_default_level
    logger.info(
        "[sow/upload-document worker] START job=%s user=%s bytes=%s cloudinary_available=%s",
        job_id, len(contents), "cloudinary" in dir(),
    )
    logger.info("[sow/upload-document worker] study_router_cloudinary_imports=%s", "cloudinary" in globals())
    try:
        await _mark_job_status(job_id, "processing", progress=5, stage="queued")

        last_reported = {"progress": 5}

        async def report(progress: int, stage: str) -> None:
            """Push progress to the job row, coalescing near-identical updates."""
            if progress <= last_reported["progress"] and stage == "reading_pages":
                return
            last_reported["progress"] = progress
            await _mark_job_status(job_id, "processing", progress=progress, stage=stage)

        try:
            extracted_text = await _extract_document_text(
                contents,
                safe_name,
                selected_pages=selected_pages,
                on_progress=report,
            )
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

        await _mark_job_status(job_id, "processing", progress=55, stage="reading_pages")
        pages, figures = await _build_material_artifacts(
            key_prefix=job_id,
            contents=contents,
            is_pdf=safe_name.lower().endswith(".pdf"),
            content_type="application/pdf",
            extracted_text=extracted_text,
        )
        notes = _figure_notes(figures)
        source_text = f"{extracted_text}{notes}"

        await _mark_job_status(job_id, "processing", progress=72, stage="parsing_ai")
        try:
            parsed, provider, _ = await _run_sow_parser(source_text)
            logger.info(
                "[sow/upload-document worker] parser done job=%s provider=%s",
                job_id, provider,
            )
        except Exception as exc:
            logger.exception("SOW parser AI failed for job %s: %s", job_id, exc)
            await _mark_job_status(job_id, "failed", error="ai_parser_failed")
            return

        title = (parsed or {}).get("title", safe_name) if isinstance(parsed, dict) else safe_name

        await _mark_job_status(job_id, "processing", progress=85, stage="parsing_ai")
        explanation = await _build_explanation_safely(
            title=title,
            source_text=source_text,
            figures=figures,
            level=level,
        )

        await _mark_job_status(job_id, "processing", progress=92, stage="saving")
        filename_lower = safe_name.lower()
        if filename_lower.endswith(".pdf"):
            inferred_mime = "application/pdf"
        elif filename_lower.endswith((".docx", ".doc")):
            inferred_mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        elif filename_lower.endswith(".txt"):
            inferred_mime = "text/plain"
        else:
            inferred_mime = "application/octet-stream"
        material_id = await _persist_material(
            user_id=user_id,
            title=title,
            exam_type=exam_type,
            raw_input=f"[DOCUMENT: {safe_name}]\n{source_text}",
            parsed_structure=parsed,
            explanation_structure=explanation,
            contents=contents,
            file_mime_type=inferred_mime,
            ai_model_used=provider,
            education_level=level,
            pages=pages,
            figures=figures,
        )

        logger.info(
            "[sow/upload-document worker] DONE job=%s material_id=%s",
            job_id, material_id,
        )
        await _mark_job_status(
            job_id, "completed", material_id=material_id, progress=100, stage="completed"
        )
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


async def _count_rows(db: AsyncSession, model, material_id: int) -> int:
    """How many rows of `model` belong to this material."""
    result = await db.execute(
        select(func.count(model.id)).where(model.material_id == material_id)
    )
    return int(result.scalar() or 0)


def _fresh_url(image_key: str | None, stored: str | None) -> str | None:
    """A usable URL for a stored object, minted at read time.

    A presigned R2 URL expires after an hour, so a URL saved on the
    row would leave the student looking at a broken image the next
    morning. When the bucket is public the URL is stable anyway.
    """
    if not image_key:
        return stored
    try:
        minted = r2_storage.audio_url_for(image_key)
    except Exception:
        minted = None
    return minted or stored


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
    explanation = (
        _json.loads(material.explanation_structure)
        if material.explanation_structure
        else None
    )

    page_count = await _count_rows(db, StudyPage, material_id)
    figure_count = await _count_rows(db, StudyFigure, material_id)

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
        explanation_structure=explanation,
        education_level=material.education_level or "primary",
        page_count=page_count,
        figure_count=figure_count,
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
    explanation = (
        _json.loads(material.explanation_structure)
        if material.explanation_structure
        else None
    )

    page_count = await _count_rows(db, StudyPage, material_id)
    figure_count = await _count_rows(db, StudyFigure, material_id)

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
        explanation_structure=explanation,
        education_level=material.education_level or "primary",
        page_count=page_count,
        figure_count=figure_count,
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
        rendered = _render_pdf_pages(pdf)
        pdf.close()
        return rendered
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("[pages] PDF rendering failed material_id=%s err=%s", material_id, exc)
        raise HTTPException(status_code=500, detail=f"PDF rendering failed: {exc}") from exc


# ── GET /study/materials/{id}/page-images ─────────────────────────────
#
# The stored page renders, as plain URLs. These were written to object
# storage when the material was uploaded, so the app loads them from
# the CDN instead of pulling a base64 blob of every page through the
# API each time the reader opens.


@router.get("/materials/{material_id}/page-images", response_model=list[MaterialPage])
async def get_material_page_images(
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

    rows = await db.execute(
        select(StudyPage)
        .where(StudyPage.material_id == material_id)
        .order_by(StudyPage.page)
    )
    pages = rows.scalars().all()
    return [
        MaterialPage(
            page=page.page,
            # Minted per read: a presigned URL expires, and a stored
            # one would leave the student with broken images tomorrow.
            image_url=_fresh_url(page.image_key, page.image_url),
            width=page.width,
            height=page.height,
            is_scan=page.is_scan,
        )
        for page in pages
    ]


# ── GET /study/materials/{id}/figures ──────────────────────────────────
#
# Every diagram found on the material's pages, with the plain-language
# description of what it shows. The app renders the crop inline in the
# lesson and speaks the description in the narration, so a student who
# cannot see the picture still gets everything it contains.


@router.get("/materials/{material_id}/figures", response_model=list[MaterialFigure])
async def get_material_figures(
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

    rows = await db.execute(
        select(StudyFigure)
        .where(StudyFigure.material_id == material_id)
        .order_by(StudyFigure.figure_index)
    )
    figures = rows.scalars().all()
    return [
        MaterialFigure(
            figure_index=figure.figure_index,
            page=figure.page,
            image_url=_fresh_url(figure.image_key, figure.image_url),
            width=figure.width,
            height=figure.height,
            description=figure.description,
            caption=figure.caption,
        )
        for figure in figures
    ]


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

    # Charge at generation, not at unlock. Generation is the expensive
    # step — the model call costs ~NGN2.13 regardless of whether the
    # student ever reads the result — so a free generate with a paid
    # unlock let anyone burn compute by generating repeatedly and
    # unlocking nothing. Premium keeps generating free, matching its
    # free unlocks.
    #
    # Debit happens BEFORE the model call so a rejected payment writes
    # nothing and costs no tokens.
    if is_premium(current_user):
        points_cost = 0
    else:
        points_cost = (
            VIDEO_UNLOCK_POINTS_COST
            if payload.asset_type == "video"
            else UNLOCK_POINTS_COST
        )
        await _debit_wallet(db, current_user.id, "points", points_cost)
        db.add(
            StudyTransaction(
                user_id=current_user.id,
                # Set once the asset row exists, so the unlock endpoint
                # can recognise a generation the user already paid for.
                asset_id=None,
                method="generate",
                points_spent=points_cost,
                reward_granted=True,
            )
        )
        await db.commit()

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

    try:
        ai_result = await route_ai(prompt, task_type="fast", db=db)
    except HTTPException:
        # Provider failed after we took payment — refund, so an outage
        # never costs the student for content that does not exist.
        if points_cost:
            await _refund_chat_payment(db, current_user.id, points_cost)
        raise

    content = None
    try:
        content = _json.loads(ai_result["response"])
    except Exception:
        logger.error("Asset generator returned non-JSON: %s", ai_result["response"][:200])
        if points_cost:
            await _refund_chat_payment(db, current_user.id, points_cost)
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
    await db.flush()

    # Backfill the pending transaction so the unlock endpoint can see this
    # generation was already paid for.
    pending = await db.execute(
        select(StudyTransaction)
        .where(StudyTransaction.user_id == current_user.id)
        .where(StudyTransaction.asset_id.is_(None))
        .where(StudyTransaction.method == "generate")
        .order_by(StudyTransaction.id.desc())
        .limit(1)
    )
    row = pending.scalar_one_or_none()
    if row is not None:
        row.asset_id = asset.id
    await db.commit()
    await db.refresh(asset)

    # Record generation cost against what we charged for it. The premium
    # path charges 0 and still costs money, which is exactly the gap this
    # table exists to surface.
    gen_usage = ai_result.get("usage") or {}
    await log_usage(
        db,
        user_id=current_user.id,
        endpoint="generate",
        model=ai_result.get("model") or "",
        prompt_tokens=gen_usage.get("prompt_tokens") or 0,
        completion_tokens=gen_usage.get("completion_tokens") or 0,
        sv_charged=points_cost,
    )

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
    (premium gets `study_chat_premium_daily_limit`). Beyond that quota a
    student can buy a turn with SV — priced by the tier the question
    routes to, so the price tracks the cost. Failed model
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

    # Classify once. The tier drives both the price of a paid turn and
    # which model answers, so it has to be settled before either.
    from app.ai.routing import classify_turn

    decision = classify_turn(payload.message, material_title=material.title)
    tier = decision.model_tier if settings.ai_routing_enabled else "premium"

    # A turn is billable when the free quota is already spent. Decide
    # before touching any counter, so a rejected payment can't consume a
    # free slot.
    used = peek_count(current_user.id)
    paid_daily_limit = settings.study_chat_paid_daily_limit
    is_billable = used >= daily_limit

    paid_price = 0
    if is_billable:
        turn_price = (
            settings.study_chat_sv_premium
            if tier == "premium"
            else settings.study_chat_sv_standard
        )
        if used >= daily_limit + paid_daily_limit:
            raise HTTPException(
                status_code=429,
                detail=(
                    f"Daily chat limit reached ({daily_limit} free + "
                    f"{paid_daily_limit} paid). Try again tomorrow."
                ),
            )
        if not payload.pay_for_turn:
            # Rejected before any state changes, so the free quota stays
            # intact and the client can offer the pay path.
            raise HTTPException(
                status_code=429,
                detail=(
                    f"Daily free chat limit reached ({daily_limit}/day). "
                    f"This question costs {turn_price} SV."
                ),
                headers={"X-Chat-Turn-Price": str(turn_price)},
            )
        # Pay first, then commit with its ledger row, so an unaffordable
        # balance writes nothing at all.
        paid_price = turn_price
        new_balance = await _debit_wallet(
            db, current_user.id, "points", paid_price
        )
        db.add(
            StudyTransaction(
                user_id=current_user.id,
                asset_id=None,
                method="chat",
                points_spent=paid_price,
                reward_granted=True,
            )
        )
        await db.commit()

    # Admit the slot against the limit that applies to this turn.
    allowed, remaining = check_and_record(
        current_user.id,
        daily_limit + (paid_daily_limit if is_billable else 0),
    )
    if not allowed:
        # Priced and paid but couldn't be admitted — refund.
        if is_billable:
            await _refund_chat_payment(db, current_user.id, paid_price)
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
        # back so an outage doesn't burn the user's daily quota, and
        # refund the SV so a failed turn is never paid for.
        release(current_user.id)
        if is_billable and paid_price:
            await _refund_chat_payment(db, current_user.id, paid_price)
        raise
    text = ai_result["response"]
    usage = ai_result.get("usage") or {}
    logger.info(
        "study chat: user=%s material=%s tier=%s reason=%s score=%s "
        "billable=%s sv=%s model=%s usage=%s",
        current_user.id,
        material.id,
        tier,
        decision.reason,
        decision.score,
        is_billable,
        paid_price,
        ai_result.get("model"),
        usage,
    )
    # Record the call so margin is measurable. Fire-and-forget: a
    # logging failure must not fail an answer the student already has.
    await log_usage(
        db,
        user_id=current_user.id,
        endpoint="chat",
        model=ai_result.get("model") or "",
        prompt_tokens=usage.get("prompt_tokens") or 0,
        completion_tokens=usage.get("completion_tokens") or 0,
        tier=tier,
        sv_charged=paid_price,
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


async def _refund_chat_payment(
    db: AsyncSession, user_id: int, amount: int
) -> None:
    """Refund a paid operation when the model call failed.

    Used by both paid chat turns and asset generation: an outage must
    never cost the student for content that was never delivered. Credits
    back to the spendable wallet the debit came from and commits, so a
    failure path never leaves a half-written ledger.
    """
    if amount <= 0:
        return
    field = _wallet_field_for("points")
    await db.execute(
        update(User)
        .where(User.id == user_id)
        .values({getattr(User, field): getattr(User, field) + amount})
    )
    await db.commit()


async def _paid_at_generation(
    db: AsyncSession, user_id: int, asset_id: int
) -> bool:
    """True when the user already paid to generate this asset.

    Generation is charged up front, so reading one of your own generated
    assets must not be billed again.
    """
    row = await db.execute(
        select(StudyTransaction.id)
        .where(
            StudyTransaction.user_id == user_id,
            StudyTransaction.asset_id == asset_id,
            StudyTransaction.method == "generate",
        )
        .limit(1)
    )
    return row.scalar_one_or_none() is not None


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

    # Already paid for at generation. Generation is charged up front, so
    # an asset the user generated themselves must not be charged a
    # second time to read it.
    already_generated = await _paid_at_generation(db, current_user.id, asset.id)

    # Premium users unlock for free
    if already_generated or is_premium(current_user):
        import json as _json
        txn = StudyTransaction(
            user_id=current_user.id,
            asset_id=asset.id,
            method="generate" if already_generated else "premium",
            points_spent=0,
            reward_granted=True,
        )
        db.add(txn)
        await db.commit()
        return UnlockResponse(
            unlocked=True,
            content=_json.loads(asset.content_json),
            new_balance=current_user.points_balance,
            method="generate" if already_generated else "premium",
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


def _audio_content_type(raw: bytes) -> str:
    """The real container of an audio blob.

    MeloTTS answers with WAV and edge-tts with MP3, and the same
    function serves both. Guessing wrong makes some players refuse the
    file, so the header is read.
    """
    if not raw:
        return "audio/mpeg"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WAVE":
        return "audio/wav"
    if raw[:4] == b"OggS":
        return "audio/ogg"
    if raw[:4] == b"fLaC":
        return "audio/flac"
    if raw[:3] == b"ID3" or raw[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"):
        return "audio/mpeg"
    return "audio/mpeg"


def _narration_structure_for(material) -> dict:
    """The structure the narration should speak.

    The teaching layer is preferred: it is the same material rewritten
    in plain language, with every diagram described in words, which is
    exactly what a narration wants to read out. The faithful layer
    supplies the topic list, because the teaching layer carries blocks
    but no topics of its own.

    When there is no teaching layer the faithful structure is used
    unchanged, so narration still works for anything uploaded before
    the teaching layer existed.
    """
    import json as _json

    parsed = {}
    if material.parsed_structure:
        try:
            loaded = _json.loads(material.parsed_structure)
            if isinstance(loaded, dict):
                parsed = loaded
        except Exception:
            parsed = {}

    if not material.explanation_structure:
        return parsed
    try:
        explanation = _json.loads(material.explanation_structure)
    except Exception:
        return parsed
    if not isinstance(explanation, dict):
        return parsed
    blocks = explanation.get("blocks")
    if not isinstance(blocks, list) or not blocks:
        return parsed

    merged = dict(parsed)
    merged["blocks"] = blocks
    return merged


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

    parsed = _narration_structure_for(material)

    script, level, char_count = await study_narration.generate_episode_script(
        material_title=material.title,
        parsed_structure=parsed,
        topic_index=batch.topic_index,
        level=batch.level,
        episode_index=batch.episode_index,
        total_episodes=batch.total_episodes,
        db=db,
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
    # The container depends on which provider answered: MeloTTS hands
    # back WAV, edge-tts hands back MP3. Labelling a WAV as
    # audio/mpeg makes some players refuse to open it, so the bytes
    # are sniffed instead of assumed.
    r2_storage.upload_bytes(key, audio, content_type=_audio_content_type(audio))

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

    try:
        await _generate_one_episode(db, batch)
    except Exception as exc:
        # The batch is left in `generating` unless it is failed here.
        # The user has already been debited for it, so an unhandled
        # failure means a charge for audio that will never arrive, and
        # the batch sits in `generating` until the sweeper comes for it
        # half an hour later. Fail it and refund it now.
        logger.exception("[audio] episode generation failed batch=%s", batch.id)
        await study_audio_service.mark_failed(
            db, batch.id, reason=str(exc) or "generation_failed"
        )
        await db.commit()
        return {
            "processed": None,
            "remaining": 0,
            "error": "generation_failed",
            "refunded": True,
        }

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

# ── GET /study/ai-usage/summary ─────────────────────────────────────


@router.get("/ai-usage/summary")
async def ai_usage_summary(
    days: int = 30,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Per-user AI cost and margin over a window.

    The whole metering model is only defensible if it can be measured:
    cost per active user, split free vs paid, and what we charged
    against what the call cost. Returns the total, percentiles, the
    split by endpoint, and the count of free calls that still cost
    money (the premium gap).
    """
    from datetime import datetime, timedelta

    since = datetime.utcnow() - timedelta(days=min(max(days, 1), 365))

    rows = (
        await db.execute(
            select(
                AiUsageLog.endpoint,
                AiUsageLog.model,
                AiUsageLog.tier,
                func.count(AiUsageLog.id),
                func.coalesce(func.sum(AiUsageLog.prompt_tokens), 0),
                func.coalesce(func.sum(AiUsageLog.completion_tokens), 0),
                func.coalesce(func.sum(AiUsageLog.sv_charged), 0),
                func.coalesce(func.sum(AiUsageLog.cost_usd), 0.0),
            )
            .where(AiUsageLog.created_at >= since)
            .group_by(AiUsageLog.endpoint, AiUsageLog.model, AiUsageLog.tier)
        )
    ).all()

    total_cost_usd = 0.0
    total_sv = 0
    total_calls = 0
    free_cost_calls = 0
    free_cost_usd = 0.0
    by_endpoint: dict[str, dict] = {}

    for endpoint, model, tier, calls, ptok, ctok, sv, cost in rows:
        total_cost_usd += cost
        total_sv += int(sv or 0)
        total_calls += int(calls or 0)
        if not sv:
            free_cost_calls += int(calls or 0)
            free_cost_usd += cost
        bucket = by_endpoint.setdefault(
            endpoint, {"calls": 0, "cost_usd": 0.0, "sv_charged": 0}
        )
        bucket["calls"] += int(calls or 0)
        bucket["cost_usd"] += cost
        bucket["sv_charged"] += int(sv or 0)

    # Revenue in USD, so margin is comparable to cost_usd.
    revenue_usd = 0.0
    if total_sv:
        revenue_usd = (total_sv / settings.points_per_naira) / 1332.5

    per_user = (
        await db.execute(
            select(
                AiUsageLog.user_id,
                func.coalesce(func.sum(AiUsageLog.cost_usd), 0.0),
                func.coalesce(func.sum(AiUsageLog.sv_charged), 0),
            )
            .where(AiUsageLog.created_at >= since)
            .group_by(AiUsageLog.user_id)
        )
    ).all()

    per_user_costs = sorted(cost for _, cost, _ in per_user)

    def _pct(values: list[float], p: float) -> float:
        if not values:
            return 0.0
        idx = min(len(values) - 1, int(p * len(values)))
        return values[idx]

    return {
        "window_days": min(max(days, 1), 365),
        "calls": total_calls,
        "total_cost_usd": round(total_cost_usd, 6),
        "revenue_usd": round(revenue_usd, 6),
        "margin_usd": round(revenue_usd - total_cost_usd, 6),
        "margin_ratio": round(
            (revenue_usd / total_cost_usd) if total_cost_usd else 0.0, 3
        ),
        "per_user_cost": {
            "p50": round(_pct(per_user_costs, 0.50), 6),
            "p90": round(_pct(per_user_costs, 0.90), 6),
            "p99": round(_pct(per_user_costs, 0.99), 6),
            "max": round(per_user_costs[-1] if per_user_costs else 0.0, 6),
            "active_users": len(per_user_costs),
        },
        "free_calls_still_costing": {
            "calls": free_cost_calls,
            "cost_usd": round(free_cost_usd, 6),
        },
        "by_endpoint": {
            endpoint: {
                "calls": data["calls"],
                "cost_usd": round(data["cost_usd"], 6),
                "sv_charged": data["sv_charged"],
            }
            for endpoint, data in by_endpoint.items()
        },
    }

# ── GET /study/ads/complete (AdMob SSV) ───────────────────────────


@router.get("/ads/complete")
async def admob_reward_callback(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """AdMob rewarded-ad Server-Side Verification callback.

    AdMob GETs this URL when a rewarded view is earned. The signature
    is verified against Google's rotating public keys and the caller is
    confirmed by reverse DNS before anything is credited, then the
    transaction_id is deduped because AdMob retries up to five times.

    No auth dependency: the signature is the credential. Requires the
    SSV callback URL registered on the rewarded ad unit in the AdMob UI.
    """
    from app.services import admob_ssv

    # Raw bytes off the ASGI scope, not request.url.query: clients and
    # proxies are free to re-normalise the parsed form (percent-decoding
    # and re-encoding), which would change the string the signature
    # covers. AdMob signs the query exactly as it is sent.
    raw_query = request.scope.get("query_string", b"").decode("utf-8", "replace")
    client_ip = request.client.host if request.client else ""

    try:
        await admob_ssv.fetch_verifier_keys()
        params = await admob_ssv.verify_callback(raw_query, client_ip)
    except admob_ssv.SSVError as exc:
        logger.warning("AdMob SSV rejected from %s: %s", client_ip, exc)
        return Response(status_code=400, content="verification failed")

    try:
        user_id = int(params["user_id"])
        transaction_id = int(params["transaction_id"])
    except ValueError:
        logger.warning("AdMob SSV sent non-integer ids: %s", raw_query[:120])
        return Response(status_code=400, content="bad ids")

    payout = admob_ssv.payout_points()

    # Idempotency. AdMob retries, so a replayed callback must not
    # double-credit. The transaction_id is the only available key, so
    # the row that carries it is the ad ledger row.
    existing = await db.execute(
        select(StudyTransaction.id)
        .where(
            StudyTransaction.user_id == user_id,
            StudyTransaction.asset_id == transaction_id,
            StudyTransaction.method == "ad",
        )
        .limit(1)
    )
    if existing.scalar_one_or_none() is not None:
        logger.info("AdMob SSV duplicate transaction_id=%s ignored", transaction_id)
        return Response(status_code=200, content="ok")

    user_row = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user_row is None:
        # Unknown user: acknowledge so AdMob stops retrying, but never
        # invent a wallet to credit.
        logger.warning("AdMob SSV for unknown user=%s", user_id)
        return Response(status_code=200, content="ok")

    db.add(
        StudyTransaction(
            user_id=user_row.id,
            asset_id=transaction_id,
            method="ad",
            points_spent=0,
            reward_granted=True,
        )
    )
    # Spendable only. A withdrawable ad reward is a payout the ad did
    # not fund — the same guard as bills commission and the allowance.
    if settings.wallet_split_enabled:
        user_row.service_credit_balance = (user_row.service_credit_balance or 0) + payout
    else:
        user_row.points_balance = (user_row.points_balance or 0) + payout
    await db.commit()

    logger.info(
        "AdMob SSV credited user=%s sv=%d transaction_id=%s",
        user_row.id, payout, transaction_id,
    )
    return Response(status_code=200, content="ok")

class AdRevenueRequest(BaseModel):
    """Impression-level ad revenue, reported by the client.

    This is the number that tells us whether ad-watching actually funds
    the rewards we pay out. `value_micros` is the impression's value in
    micro units - 5000 means $0.005.

    The client is not trusted for money: this is telemetry for the
    ad-revenue-vs-reward-cost check, never a balance. A student could
    send anything here.
    """

    format: str = "rewarded"
    value_micros: int = 0
    currency: str = "USD"
    precision: str = "UNKNOWN"


@router.post("/ads/revenue")
async def record_ad_revenue(
    payload: AdRevenueRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Record an ad impression's revenue.

    Stored as an AiUsageLog row with endpoint "ad_revenue" and the
    impression value as a cost, so the ad margin check lives in the same
    place as the AI cost check rather than in a spreadsheet.
    """
    from app.services.ai_cost import log_usage

    await log_usage(
        db,
        user_id=current_user.id,
        endpoint="ad_revenue",
        model=payload.format,
        prompt_tokens=0,
        completion_tokens=0,
        # value_micros -> USD. Recorded as a negative cost because this
        # is revenue offsetting the AI spend, not more of it.
        cost_usd=-(payload.value_micros / 1_000_000),
    )
    return {"ok": True}