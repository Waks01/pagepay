"""Study endpoints for Phase 3: AI Exam Prep.

SOW upload → AI parsing → asset generation (MCQ/flashcard/essay) →
ad-or-points gated unlock → streaming study chat.
"""

import logging
import uuid
import asyncio
import io
import json
import re
import base64
from datetime import datetime

import fitz
import httpx

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import or_, select, update, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.prompts import (
    CHAT_TUTOR_SYSTEM,
    CHAT_TUTOR_SYSTEM_PRIMARY,
    CHAT_TUTOR_SYSTEM_SECONDARY,
    CHAT_TUTOR_SYSTEM_TERTIARY,
    CHAT_TUTOR_SYSTEM_RESEARCH,
    DIAGRAM_GENERATOR,
    ESSAY_ALL_TOPICS_GENERATOR,
    ESSAY_GENERATOR,
    ESSAY_TOPIC_GENERATOR,
    EXAMPLE_GENERATOR,
    FLASHCARD_ALL_TOPICS_GENERATOR,
    FLASHCARD_GENERATOR,
    FLASHCARD_TOPIC_GENERATOR,
    MCQ_ALL_TOPICS_GENERATOR,
    MCQ_GENERATOR,
    MCQ_TOPIC_GENERATOR,
    SOW_PARSER,
    VIDEO_SCRIPT_GENERATOR,
)
from app.ai.router import route_ai, call_cf_vision, calculate_ai_cost_neurons, should_use_premium_model
from app.models import (
    AudioUnlock,
    SowUploadJob,
    StudyAsset,
    StudyMaterial,
    StudyProgress,
    StudyTransaction,
    User,
    ReadingSession,
    StudyExamSession,
    StudyExamQuestion,
    StudyExamAnswer,
    StudyFigure,
    AudioTopic,
    AudioBatch,
    AudioEpisode,
    AiUsageLog,
)
from app.database import AsyncSessionLocal, get_db
from app.routers.auth import get_current_user
from app.config import settings
from app.services.sanitize import (
    safe_filename,
    sanitize_for_display,
)
from app.services.tts_hybrid import AUDIO_CACHE_DIR, synthesize_study_audio
from app.schemas import (
    ChatRequest,
    ChatResponse,
    ExampleCheckRequest,
    ExampleCheckResponse,
    ExampleGenerateRequest,
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
    ExamStartRequest,
    ExamStartResponse,
    ExamQuestionsResponse,
    ExamAnswerSubmitRequest,
    ExamAnswerSubmitResponse,
    ExamSubmitRequest,
    ExamSubmitResponse,
    ExamHistoryResponse,
    ExamResultResponse,
    PageImageResponse,
    PageImagesListResponse,
    FigureResponse,
    FiguresListResponse,
    AudioTopicsResponseSchema,
    AudioQuoteSchema,
    AudioBatchesResponseSchema,
    AudioBatchCreateResultSchema,
    AudioEpisodeSchema,
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


# ── Pydantic models for preview endpoints ───────────────────────────

class PdfPagePreview(BaseModel):
    page: int
    total: int
    # Raw base64 PNG bytes (no data: prefix). The frontend reconstructs
    # the data URI itself: `data:image/jpeg;base64,${page.image_base64}`.
    # Field name + shape must match the frontend's PdfPagePreview type
    # (page/src/app/(app)/study/index.tsx) — the old `image` field left
    # every thumbnail blank because the client read `image_base64`.
    image_base64: str


class PdfPreviewResponse(BaseModel):
    pages: list[PdfPagePreview]
    total: int
    truncated: bool


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
        exam_type=payload.exam_type,
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
    return. OCR (Gemini Vision) + SOW AI parsing then run in a
    background task. The client polls
    `GET /api/v1/study/sow/jobs/{job_id}` to drive its progress bar
    through the 80→100 window.
    """
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
    if not settings.cf_account_id or not settings.cf_ai_api_key:
        logger.error("[sow/upload-image] Cloudflare Workers AI credentials not configured")
        raise HTTPException(status_code=503, detail="Cloudflare Workers AI not configured for image upload")

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


@router.post("/sow/upload-images", response_model=SowUploadJobAccepted, status_code=202)
async def upload_sow_images(
    files: list[UploadFile] = File(...),
    exam_type: str | None = Form(default=None),
    education_level: str | None = Form(default=None),
    request: Request = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload multiple SOW images at once. Each image is OCR'd in sequence;
    all OCR outputs are merged into a single raw_input; the merged text is
    sent to the SOW parser once; and one StudyMaterial is created with
    page_count reflecting the number of uploaded images.

    FormData keys: "files" (repeated), optional "exam_type", optional "education_level".
    Response: SowUploadJobAccepted with job_id and status="queued".
    """
    content_length = request.headers.get("content-length") if request else None
    logger.info(
        "[sow/upload-images] HIT user=%s file_count=%s exam_type=%s education_level=%s length=%s",
        current_user.id,
        len(files),
        exam_type,
        education_level,
        content_length,
    )

    # Validation: 1 ≤ len(files) ≤ 10
    if not files or len(files) == 0:
        logger.warning("[sow/upload-images] no files provided")
        raise HTTPException(status_code=400, detail="At least one file is required")
    if len(files) > 10:
        logger.warning("[sow/upload-images] too many files: %d > 10", len(files))
        raise HTTPException(
            status_code=413,
            detail=f"Too many files (max 10)",
        )

    if not settings.cf_account_id or not settings.cf_ai_api_key:
        logger.error("[sow/upload-images] Cloudflare Workers AI credentials not configured")
        raise HTTPException(status_code=503, detail="Cloudflare Workers AI not configured for image upload")

    # Validate each file: content-type, size, read contents
    file_data_list = []  # list of (contents: bytes, safe_name: str, content_type: str)
    total_bytes = 0

    for idx, file in enumerate(files):
        logger.info("[sow/upload-images] validating file %d: %s", idx, file.filename)

        # Content-type allowlist
        ctype = (file.content_type or "").lower().split(";", 1)[0].strip()
        if ctype not in ALLOWED_IMAGE_TYPES:
            logger.warning("[sow/upload-images] file %d unsupported ctype: %s", idx, ctype)
            raise HTTPException(
                status_code=415,
                detail=f"File {idx + 1}: unsupported image type {ctype!r}. Use JPEG, PNG, WEBP, or HEIC.",
            )

        safe_name = safe_filename(file.filename, fallback=f"image_{idx}.jpg")

        try:
            contents = await file.read()
        except Exception as e:
            logger.exception("[sow/upload-images] file %d read failed: %s", idx, e)
            raise HTTPException(
                status_code=400,
                detail=f"File {idx + 1}: could not read uploaded file",
            )

        if not contents:
            logger.warning("[sow/upload-images] file %d is empty", idx)
            raise HTTPException(
                status_code=400,
                detail=f"File {idx + 1}: empty file",
            )

        if len(contents) > MAX_SOW_IMAGE_BYTES:
            logger.warning(
                "[sow/upload-images] file %d too large: %d > %d",
                idx, len(contents), MAX_SOW_IMAGE_BYTES,
            )
            raise HTTPException(
                status_code=413,
                detail=f"File {idx + 1}: image too large (max {MAX_SOW_IMAGE_BYTES // (1024*1024)} MB)",
            )

        total_bytes += len(contents)
        file_data_list.append((contents, safe_name, ctype))
        logger.info("[sow/upload-images] file %d OK: %s bytes", idx, len(contents))

    logger.info(
        "[sow/upload-images] all files validated: count=%d total_bytes=%d",
        len(file_data_list),
        total_bytes,
    )

    # Create job row and dispatch background worker
    job = SowUploadJob(id=str(uuid.uuid4()), user_id=current_user.id, status="queued")
    db.add(job)
    await db.commit()
    await db.refresh(job)

    logger.info(
        "[sow/upload-images] job queued: id=%s user=%s dispatching multi-image worker",
        job.id,
        current_user.id,
    )

    asyncio.create_task(
        _process_sow_multi_image_job(
            job_id=job.id,
            user_id=current_user.id,
            exam_type=exam_type,
            education_level=education_level,
            file_data_list=file_data_list,
        )
    )

    return SowUploadJobAccepted(job_id=job.id, status="queued")


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
    """
    pages = json.loads(selected_pages) if selected_pages else None
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
            selected_pages=pages,
        )
    )

    return SowUploadJobAccepted(job_id=job.id, status="queued")


@router.post("/sow/preview-pdf", response_model=PdfPreviewResponse)
async def preview_sow_pdf(
    file: UploadFile = File(...),
    exam_type: str | None = Form(default=None),
    request: Request = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Preview a PDF by rendering **every** page as a PNG image.

    Renders all pages (no cap) so the user can page through the whole
    document and deselect the pages they don't want uploaded. The old
    20-page cap silently dropped pages 21+ from the selection UI even
    though `total` reported the real count — a user could not see or
    exclude later pages, which is the whole point of the preview.

    Each page is returned as raw base64 PNG bytes in `image_base64`
    (no `data:` prefix); the frontend builds the data URI itself.
    """
    content_length = request.headers.get("content-length") if request else None
    logger.info(
        "[sow/preview-pdf] HIT user=%s exam_type=%s filename=%s ctype=%s length=%s",
        current_user.id,
        exam_type,
        file.filename,
        file.content_type,
        content_length,
    )

    safe_name = safe_filename(file.filename, fallback="document.pdf")
    logger.info("[sow/preview-pdf] safe_name=%s", safe_name)

    try:
        contents = await file.read()
    except Exception as e:
        logger.exception("[sow/preview-pdf] file.read() failed: %s", e)
        raise HTTPException(status_code=400, detail=f"Could not read uploaded file: {e}")

    logger.info(
        "[sow/preview-pdf] read %s bytes (limit=%s)",
        len(contents),
        MAX_SOW_DOC_BYTES,
    )

    if not contents:
        logger.warning("[sow/preview-pdf] empty file")
        raise HTTPException(status_code=400, detail="Empty file")
    if len(contents) > MAX_SOW_DOC_BYTES:
        logger.warning(
            "[sow/preview-pdf] too large: %s > %s",
            len(contents),
            MAX_SOW_DOC_BYTES,
        )
        raise HTTPException(
            status_code=413,
            detail=f"PDF too large (max {MAX_SOW_DOC_BYTES // (1024*1024)} MB)",
        )

    pages: list[PdfPagePreview] = []

    try:
        doc = fitz.open(stream=contents, filetype="pdf")
        total_pages = len(doc)

        if total_pages == 0:
            logger.warning("[sow/preview-pdf] PDF has no pages")
            raise HTTPException(status_code=400, detail="PDF has no pages")

        logger.info(
            "[sow/preview-pdf] rendering ALL %s pages (no cap)",
            total_pages,
        )

        for i in range(total_pages):
            page = doc.load_page(i)
            # Render at 150 DPI
            mat = fitz.Matrix(150 / 72, 150 / 72)
            pix = page.get_pixmap(matrix=mat)
            png_bytes = pix.tobytes("png")
            b64 = base64.b64encode(png_bytes).decode("utf-8")
            pages.append(
                PdfPagePreview(
                    page=i + 1,
                    total=total_pages,
                    image_base64=b64,
                )
            )

        doc.close()

        logger.info(
            "[sow/preview-pdf] DONE user=%s pages=%s total=%s",
            current_user.id,
            len(pages),
            total_pages,
        )

        return PdfPreviewResponse(
            pages=pages,
            total=total_pages,
            truncated=False,
        )

    except fitz.FileDataError as e:
        logger.error("[sow/preview-pdf] fitz.FileDataError: %s", e)
        raise HTTPException(status_code=400, detail=f"Could not read PDF: {e}")
    except Exception as e:
        logger.error("[sow/preview-pdf] exception: %s", e)
        raise HTTPException(status_code=400, detail=f"Could not read PDF: {e}")


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


async def _ocr_image(
    contents: bytes, content_type: str
) -> tuple[str, float]:
    """Extract text from image using Cloudflare Workers AI Vision."""
    try:
        description, cost = await call_cf_vision(contents, "Extract all text and content from this image")
        return description, cost
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=f"Vision API unavailable: {str(e)[:100]}")


async def _extract_document_text(contents: bytes, filename: str, selected_pages: list[int] | None = None) -> str:
    """Branch on extension and extract plain text from PDF / DOCX / TXT.

    For PDFs, if selected_pages is provided, extract only those pages (1-indexed).
    Otherwise, extract all pages. For DOCX and TXT, ignore selected_pages.

    Raises a `ValueError` with a user-safe category on any failure;
    the document worker translates that into the right
    `error_message` on the job row.
    """
    fname = filename.lower()
    if fname.endswith(".pdf"):
        try:
            import pypdf
            from io import BytesIO
            reader = pypdf.PdfReader(BytesIO(contents))
            if selected_pages is None:
                return "\n".join(p.extract_text() or "" for p in reader.pages)
            else:
                return "\n".join(reader.pages[page_num - 1].extract_text() or "" for page_num in selected_pages)
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
    """Best-effort JSON parse of the SOW parser's output. Returns None
    on failure (the AI may occasionally return non-JSON — we log it
    and store the raw material with no parsed structure)."""
    import json as _json
    try:
        return _json.loads(response_text)
    except Exception:
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


async def _extract_figures_from_pdf(
    pdf_bytes: bytes,
    selected_pages: list[int] | None = None,
) -> tuple[list[dict], int]:
    """Extract embedded images and drawn diagrams from a PDF.
    
    Returns:
        (figures_list, page_count)
        
    where each figure is:
        {
            'figure_index': int (0-based),
            'page_number': int (1-based),
            'image_data': bytes (PNG),
            'width': int,
            'height': int,
            'image_mime_type': str,
        }
    
    Diagrams are detected by checking each page for embedded images.
    If no images found and selected_pages given, render those pages.
    Raises RuntimeError on failure; callers should catch and log.
    """
    figures = []
    figure_index = 0
    
    try:
        pdf = fitz.open(stream=pdf_bytes, filetype="pdf")
        page_count = len(pdf)
        
        pages_to_process = range(page_count)
        if selected_pages:
            pages_to_process = [p - 1 for p in selected_pages if 1 <= p <= page_count]
        
        for page_num in pages_to_process:
            page = pdf[page_num]
            
            # Extract embedded images
            image_list = page.get_images()
            for img_index, img in enumerate(image_list):
                xref = img[0]
                pix = fitz.Pixmap(pdf, xref)
                
                if pix.n - pix.alpha < 4:  # GRAY or RGB
                    img_data = pix.tobytes("png")
                else:  # CMYK
                    pix = fitz.Pixmap(fitz.csRGB, pix)
                    img_data = pix.tobytes("png")
                
                figures.append({
                    'figure_index': figure_index,
                    'page_number': page_num + 1,
                    'image_data': img_data,
                    'width': pix.width,
                    'height': pix.height,
                    'image_mime_type': 'image/png',
                })
                figure_index += 1
        
        pdf.close()
        return figures, page_count
        
    except Exception as exc:
        logger.error("PDF figure extraction failed: %s", exc)
        raise RuntimeError("pdf_figure_extraction_failed") from exc


async def _extract_figures_from_image(
    image_bytes: bytes,
    content_type: str,
) -> tuple[list[dict], int]:
    """Treat the entire uploaded image as a single figure.
    
    Returns:
        (figures_list, page_count=1)
        
    where figures_list has one entry.
    Raises RuntimeError on failure; callers should catch and log.
    """
    figures = []
    
    try:
        # Open image as a fitz document for size extraction
        doc = fitz.open(stream=image_bytes, filetype="image")
        page = doc[0]
        pix = page.get_pixmap()
        
        # Store the image data directly (already the original bytes)
        figures.append({
            'figure_index': 0,
            'page_number': 1,
            'image_data': image_bytes,
            'width': pix.width,
            'height': pix.height,
            'image_mime_type': content_type or 'image/jpeg',
        })
        
        doc.close()
        return figures, 1
        
    except Exception as exc:
        logger.error("Image figure extraction failed: %s", exc)
        raise RuntimeError("image_figure_extraction_failed") from exc


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
        "[sow/upload-image worker] START job=%s user=%s bytes=%s cloudinary_available=%s",
        job_id, user_id, len(contents), "cloudinary" in dir(),
    )
    logger.info("[sow/upload-image worker] study_router_cloudinary_imports=%s", "cloudinary" in globals())
    try:
        await _mark_job_status(job_id, "processing")

        # Check Cloudflare credentials
        if not settings.cf_account_id or not settings.cf_ai_api_key:
            raise RuntimeError("cloudflare_not_configured")

        try:
            extracted_text, vision_neurons_cost = await _ocr_image(contents, content_type)
            logger.info(
                "[sow/upload-image worker] OCR done job=%s text_len=%s cost_neurons=%s",
                job_id, len(extracted_text or ""), vision_neurons_cost,
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
            
            # Log Cloudflare vision cost
            vision_log = AiUsageLog(
                user_id=user_id,
                operation="vision_extract",
                model="@cf/meta/llama-3.2-11b-vision-instruct",
                input_tokens=len(contents),  # bytes as proxy for input size
                cost_neurons=vision_neurons_cost,
                meta={
                    'job_id': job_id,
                    'material_id': material_id,
                    'file_size': len(contents),
                    'content_type': content_type,
                }
            )
            db.add(vision_log)
            await db.commit()

        # Extract figures from the image
        try:
            figures, page_ct = await _extract_figures_from_image(contents, content_type)
            async with AsyncSessionLocal() as db:
                material = await db.get(StudyMaterial, material_id)
                if material:
                    material.page_count = page_ct
                    material.figure_count = len(figures)
                    
                    for fig in figures:
                        study_fig = StudyFigure(
                            material_id=material_id,
                            figure_index=fig['figure_index'],
                            page_number=fig['page_number'],
                            image_data=fig['image_data'],
                            width=fig['width'],
                            height=fig['height'],
                            image_mime_type=fig['image_mime_type'],
                        )
                        db.add(study_fig)
                    
                    await db.commit()
                    logger.info(
                        "[sow/upload-image worker] figures extracted: count=%s",
                        len(figures),
                    )
        except Exception as exc:
            logger.error("Figure extraction failed for job %s: %s", job_id, exc)
            # Don't fail the job; just skip figures

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
    selected_pages: list[int] | None = None,
) -> None:
    """Background worker for the document SOW upload. Same shape as
    the image worker — runs extraction + AI parse, writes the
    material, updates the job row.
    """
    logger.info(
        "[sow/upload-document worker] START job=%s user=%s bytes=%s cloudinary_available=%s",
        job_id, user_id, len(contents), "cloudinary" in dir(),
    )
    logger.info("[sow/upload-document worker] study_router_cloudinary_imports=%s", "cloudinary" in globals())
    try:
        await _mark_job_status(job_id, "processing")

        try:
            extracted_text = await _extract_document_text(contents, safe_name, selected_pages=selected_pages)
            logger.info(
                "[sow/upload-document worker] extract done job=%s selected_pages=%s text_len=%s",
                job_id, selected_pages, len(extracted_text or ""),
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
            material = StudyMaterial(
                user_id=user_id,
                title=title,
                exam_type=exam_type,
                raw_input=f"[DOCUMENT: {safe_name}]\n{extracted_text}",
                parsed_structure=_json.dumps(parsed) if parsed else None,
                original_file_data=contents,
                file_mime_type="application/pdf",
                ai_model_used=provider,
            )
            db.add(material)
            await db.commit()
            await db.refresh(material)
            material_id = material.id

        # Extract figures from the PDF
        try:
            figures, page_ct = await _extract_figures_from_pdf(contents, selected_pages)
            async with AsyncSessionLocal() as db:
                material = await db.get(StudyMaterial, material_id)
                if material:
                    material.page_count = page_ct
                    material.figure_count = len(figures)
                    
                    for fig in figures:
                        study_fig = StudyFigure(
                            material_id=material_id,
                            figure_index=fig['figure_index'],
                            page_number=fig['page_number'],
                            image_data=fig['image_data'],
                            width=fig['width'],
                            height=fig['height'],
                            image_mime_type=fig['image_mime_type'],
                        )
                        db.add(study_fig)
                    
                    await db.commit()
                    logger.info(
                        "[sow/upload-document worker] figures extracted: count=%s page_count=%s",
                        len(figures), page_ct,
                    )
        except Exception as exc:
            logger.error("Figure extraction failed for job %s: %s", job_id, exc)
            # Don't fail the job; just skip figures

        logger.info(
            "[sow/upload-document worker] DONE job=%s material_id=%s",
            job_id, material_id,
        )
        await _mark_job_status(job_id, "completed", material_id=material_id)
    except Exception as exc:
        logger.exception("SOW document job %s failed", job_id)
        await _mark_job_status(job_id, "failed", error=str(exc) or exc.__class__.__name__)


async def _process_sow_multi_image_job(
    job_id: str,
    user_id: int,
    exam_type: str | None,
    education_level: str | None,
    file_data_list: list[tuple[bytes, str, str]],  # (contents, safe_name, content_type)
) -> None:
    """Background worker for multi-image SOW upload.

    Processes each image in sequence: OCR all, merge OCR texts, parse once,
    create one StudyMaterial with page_count = len(file_data_list).

    Each tuple in file_data_list is (contents: bytes, safe_name: str, content_type: str).
    Never raises — all errors end in _mark_job_status(job_id, "failed", error=...).
    """
    logger.info(
        "[sow/upload-images worker] START job=%s user=%s file_count=%s education_level=%s",
        job_id, user_id, len(file_data_list), education_level,
    )

    try:
        await _mark_job_status(job_id, "processing")

        # Check Cloudflare credentials
        if not settings.cf_account_id or not settings.cf_ai_api_key:
            raise RuntimeError("cloudflare_not_configured")

        # OCR each image in sequence
        ocr_results = []  # list of (safe_name, extracted_text)
        total_vision_cost = 0.0
        for idx, (contents, safe_name, content_type) in enumerate(file_data_list):
            logger.info(
                "[sow/upload-images worker] OCR START file %d/%d: %s",
                idx + 1, len(file_data_list), safe_name,
            )
            try:
                extracted_text, vision_cost = await _ocr_image(contents, content_type)
                total_vision_cost += vision_cost
                logger.info(
                    "[sow/upload-images worker] OCR done file %d text_len=%s cost=%s",
                    idx + 1, len(extracted_text or ""), vision_cost,
                )
                if not extracted_text or not extracted_text.strip():
                    logger.warning(
                        "[sow/upload-images worker] OCR empty for file %d: %s",
                        idx + 1, safe_name,
                    )
                    ocr_results.append((safe_name, ""))
                else:
                    ocr_results.append((safe_name, extracted_text.strip()))
            except Exception as exc:
                logger.error(
                    "[sow/upload-images worker] OCR failed file %d: %s",
                    idx + 1, exc,
                )
                raise RuntimeError("multi_image_ocr_failed") from exc

        # Merge all OCR outputs
        merged_lines = []
        for idx, (safe_name, text) in enumerate(ocr_results):
            merged_lines.append(f"[IMAGE {idx + 1}: {safe_name}]")
            merged_lines.append(text)
            merged_lines.append("")  # blank line between images

        merged_text = "\n".join(merged_lines).strip()
        logger.info(
            "[sow/upload-images worker] merged OCR: %d images, %d chars",
            len(file_data_list), len(merged_text),
        )

        # Fail if merged text is empty after stripping
        if not merged_text:
            logger.warning("[sow/upload-images worker] merged_text is empty")
            raise RuntimeError("multi_image_ocr_all_empty")

        # Run SOW parser on merged text
        try:
            parsed, provider, _ = await _run_sow_parser(merged_text)
            logger.info(
                "[sow/upload-images worker] parser done: provider=%s keys=%s",
                provider,
                list((parsed or {}).keys()) if isinstance(parsed, dict) else None,
            )
        except Exception as exc:
            logger.error("[sow/upload-images worker] parser failed: %s", exc)
            raise RuntimeError("ai_parser_failed") from exc

        title = (parsed or {}).get("title", "Untitled Material") if isinstance(parsed, dict) else "Untitled Material"

        # Store the first image as original_file_data; log that we only store the first
        first_contents, first_safe_name, first_content_type = file_data_list[0]
        logger.info(
            "[sow/upload-images worker] storing first image as original_file_data: %s",
            first_safe_name,
        )

        import json as _json
        async with AsyncSessionLocal() as db:
            material = StudyMaterial(
                user_id=user_id,
                title=title,
                exam_type=exam_type,
                education_level=education_level,
                raw_input=merged_text,
                parsed_structure=_json.dumps(parsed) if parsed else None,
                original_file_data=first_contents,
                file_mime_type=first_content_type or "image/jpeg",
                ai_model_used=provider,
                page_count=len(file_data_list),
            )
            db.add(material)
            await db.commit()
            await db.refresh(material)
            material_id = material.id
            
            # Log the total vision cost for all images in the batch
            if total_vision_cost > 0:
                vision_log = AiUsageLog(
                    user_id=user_id,
                    operation="vision_extract_batch",
                    model="@cf/meta/llama-3.2-11b-vision-instruct",
                    input_tokens=len(merged_text),
                    cost_neurons=total_vision_cost,
                    meta={
                        "image_count": len(file_data_list),
                        "education_level": education_level,
                    }
                )
                db.add(vision_log)
                await db.commit()

        logger.info(
            "[sow/upload-images worker] material created: id=%s page_count=%d cost=%s",
            material_id, len(file_data_list), total_vision_cost,
        )

        # Extract figures from all images
        try:
            all_figures = []
            figure_index = 0

            for idx, (contents, safe_name, content_type) in enumerate(file_data_list):
                try:
                    figures, _ = await _extract_figures_from_image(contents, content_type)
                    # Update figure_index to be global across all images
                    for fig in figures:
                        fig["figure_index"] = figure_index
                        fig["page_number"] = idx + 1  # page_number is 1-based per image
                        all_figures.append(fig)
                        figure_index += 1
                except Exception as exc:
                    logger.error(
                        "[sow/upload-images worker] figure extraction failed for file %d: %s",
                        idx + 1, exc,
                    )
                    # Don't fail; continue with other images

            if all_figures:
                async with AsyncSessionLocal() as db:
                    material = await db.get(StudyMaterial, material_id)
                    if material:
                        material.figure_count = len(all_figures)

                        for fig in all_figures:
                            study_fig = StudyFigure(
                                material_id=material_id,
                                figure_index=fig["figure_index"],
                                page_number=fig["page_number"],
                                image_data=fig["image_data"],
                                width=fig["width"],
                                height=fig["height"],
                                image_mime_type=fig["image_mime_type"],
                            )
                            db.add(study_fig)

                        await db.commit()
                        logger.info(
                            "[sow/upload-images worker] figures stored: count=%d",
                            len(all_figures),
                        )
        except Exception as exc:
            logger.error("[sow/upload-images worker] figure batch storage failed: %s", exc)
            # Don't fail the job; just skip figures

        logger.info(
            "[sow/upload-images worker] DONE job=%s material_id=%s",
            job_id, material_id,
        )
        await _mark_job_status(job_id, "completed", material_id=material_id)

    except Exception as exc:
        logger.exception("[sow/upload-images worker] job %s failed", job_id)
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
        page_count=material.page_count,
        figure_count=material.figure_count,
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
        material.exam_type = payload.exam_type.strip() or None

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
        page_count=material.page_count,
        figure_count=material.figure_count,
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

    try:
        import fitz  # PyMuPDF
        pdf = fitz.open(stream=material.original_file_data, filetype="pdf")
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
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"PDF rendering failed: {exc}") from exc


# ── GET /study/materials/{id}/page-images ──────────────────────────────


@router.get("/materials/{material_id}/page-images", response_model=PageImagesListResponse)
async def get_material_page_images(
    material_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return rendered PDF pages as data URIs in frontend-expected format.
    
    Same as /pages but with cleaner response shape:
    - image_url is a data URI (data:image/png;base64,...)
    - Includes total page count
    - includes is_scan flag for UI hints
    """
    logger.info("[page-images] material_id=%s user=%s", material_id, current_user.id)
    
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
    if "pdf" not in mime.lower():
        raise HTTPException(status_code=400, detail="Only PDF materials are supported")

    try:
        pdf = fitz.open(stream=material.original_file_data, filetype="pdf")
        pages = []
        total = len(pdf)
        
        for page_num in range(total):
            page = pdf[page_num]
            pix = page.get_pixmap(dpi=150)
            img_bytes = pix.tobytes("png")
            image_url = f"data:image/png;base64,{base64.b64encode(img_bytes).decode('ascii')}"
            
            pages.append(PageImageResponse(
                page=page_num + 1,
                total=total,
                image_url=image_url,
                width=pix.width,
                height=pix.height,
                is_scan=False,  # Could detect via OCR; defaulting to False
            ))
        
        pdf.close()
        return PageImagesListResponse(pages=pages)
        
    except Exception as exc:
        logger.error("Page image rendering failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"PDF rendering failed: {exc}") from exc


# ── GET /study/materials/{id}/figures ──────────────────────────────────


@router.get("/materials/{material_id}/figures", response_model=FiguresListResponse)
async def get_material_figures(
    material_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return extracted figures (diagrams) as data URIs.
    
    Figures are extracted during upload and stored in StudyFigure table.
    Each figure returned as a data URI for direct embedding in the frontend.
    """
    logger.info("[figures] material_id=%s user=%s", material_id, current_user.id)
    
    # Verify user owns material
    result = await db.execute(
        select(StudyMaterial).where(
            StudyMaterial.id == material_id,
            StudyMaterial.user_id == current_user.id,
        )
    )
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    # Fetch all figures for this material
    figures_result = await db.execute(
        select(StudyFigure)
        .where(StudyFigure.material_id == material_id)
        .order_by(StudyFigure.figure_index)
    )
    figures = figures_result.scalars().all()

    figure_list = []
    for fig in figures:
        image_url = f"data:{fig.image_mime_type};base64,{base64.b64encode(fig.image_data).decode('ascii')}"
        
        figure_list.append(FigureResponse(
            figure_index=fig.figure_index,
            page=fig.page_number,
            image_url=image_url,
            width=fig.width,
            height=fig.height,
            description=fig.description,
            caption=fig.caption,
        ))
    
    return FiguresListResponse(figures=figure_list)


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
            prompt = MCQ_ALL_TOPICS_GENERATOR.format(context=context, count=payload.count, difficulty=payload.difficulty)
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

    points_cost = VIDEO_UNLOCK_POINTS_COST if payload.asset_type == "video" else UNLOCK_POINTS_COST

    asset = StudyAsset(
        material_id=payload.material_id,
        asset_type=payload.asset_type,
        content_json=_json.dumps(content),
        points_to_unlock=points_cost,
    )
    db.add(asset)
    await db.commit()
    await db.refresh(asset)

    return GenerateAssetResponse(assets=[content])


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

    progress = StudyProgress(
        user_id=current_user.id,
        material_id=payload.material_id,
        topic_index=payload.topic_index,
        topic_name=payload.topic_name,
        status=payload.status,
        mastery_score=payload.mastery_score,
    )
    db.add(progress)
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
    total_topics = len(parsed.get("topics", []))

    progress_result = await db.execute(
        select(StudyProgress).where(
            StudyProgress.user_id == current_user.id,
            StudyProgress.material_id == material_id,
        )
    )
    progress_rows = progress_result.scalars().all()

    mastered = sum(1 for p in progress_rows if p.status == "mastered")
    reviewing = sum(1 for p in progress_rows if p.status == "reviewing")
    not_started = total_topics - mastered - reviewing

    return StudyProgressListResponse(
        material_id=material_id,
        total_topics=total_topics,
        mastered=mastered,
        reviewing=reviewing,
        not_started=max(0, not_started),
        progress=[
            StudyProgressResponse(
                id=p.id,
                material_id=p.material_id,
                topic_index=p.topic_index,
                topic_name=p.topic_name,
                status=p.status,
                mastery_score=p.mastery_score,
                last_reviewed_at=p.last_reviewed_at,
            )
            for p in progress_rows
        ],
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
async def chat_study(
    payload: ChatRequest,
    education_level: str | None = None,
    difficulty: str = "medium",
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

    context = ""
    if material.parsed_structure:
        import json as _json
        parsed = _json.loads(material.parsed_structure)
        context_parts = []
        for topic in parsed.get("topics", []):
            context_parts.append(f"Topic: {topic['name']}")
            for st in topic.get("subtopics", []):
                context_parts.append(f"  - {st}")
        context = "\n".join(context_parts)

    # Select the correct prompt template based on education level
    level = (education_level or "secondary").lower()
    if level == "primary":
        prompt_template = CHAT_TUTOR_SYSTEM_PRIMARY
    elif level == "secondary":
        prompt_template = CHAT_TUTOR_SYSTEM_SECONDARY
    elif level == "tertiary":
        prompt_template = CHAT_TUTOR_SYSTEM_TERTIARY
    elif level == "research":
        prompt_template = CHAT_TUTOR_SYSTEM_RESEARCH
    else:
        prompt_template = CHAT_TUTOR_SYSTEM_SECONDARY  # fallback
    
    system_prompt = prompt_template.format(
        context=context or "No structured context available.",
        difficulty=difficulty,
    )
    full_prompt = f"{system_prompt}\n\nStudent question: {payload.message}"

    # Calculate and log cost upfront based on input size
    input_size_chars = len(full_prompt)
    
    # Determine which model will be used via tier routing
    use_premium = should_use_premium_model(full_prompt)
    
    # Apply the same tier split as route_ai
    import random
    tier_roll = random.randint(0, 99)
    if tier_roll < 70:
        use_premium = False
    elif tier_roll < 90:
        use_premium = True
    else:
        use_premium = True
    
    from app.ai.router import CF_MODELS
    model_used = CF_MODELS["chat"] if use_premium else CF_MODELS["chat_standard"]
    cost_neurons = calculate_ai_cost_neurons("chat", input_size_chars, use_granite=not use_premium)
    
    log_entry = AiUsageLog(
        user_id=current_user.id,
        operation="chat_tutor",
        model=model_used,
        input_tokens=input_size_chars,
        cost_neurons=cost_neurons,
        meta={
            "education_level": education_level or "secondary",
            "difficulty": difficulty,
            "tier": "standard" if not use_premium else "premium",
        }
    )
    db.add(log_entry)
    await db.commit()

    async def generate():
        ai_result = await route_ai(full_prompt, task_type="chat", max_tokens=2000, db=db)
        text = ai_result["response"]
        # Stream token-by-token in small chunks for the frontend
        words = text.split(" ")
        chunk = []
        for word in words:
            chunk.append(word)
            yield " ".join(chunk) + " "
            chunk = []
        if chunk:
            yield " ".join(chunk)

    return StreamingResponse(generate(), media_type="text/plain")


# ── POST /study/unlock ──────────────────────────────────────────────


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

    if payload.method == "points":
        if settings.wallet_split_enabled:
            balance_result = await db.execute(
                select(User.service_credit_balance).where(User.id == current_user.id)
            )
            balance = balance_result.scalar_one() or 0
            if balance < asset.points_to_unlock:
                raise HTTPException(
                    status_code=402,
                    detail=f"Need {asset.points_to_unlock} service credits. You have {balance}.",
                )
            await db.execute(
                update(User)
                .where(User.id == current_user.id)
                .values(service_credit_balance=User.service_credit_balance - asset.points_to_unlock)
            )
        else:
            balance_result = await db.execute(
                select(User.points_balance).where(User.id == current_user.id)
            )
            balance = balance_result.scalar_one() or 0
            if balance < asset.points_to_unlock:
                raise HTTPException(
                    status_code=402,
                    detail=f"Need {asset.points_to_unlock} pts. You have {balance}.",
                )
            await db.execute(
                update(User)
                .where(User.id == current_user.id)
                .values(points_balance=User.points_balance - asset.points_to_unlock)
            )

        txn = StudyTransaction(
            user_id=current_user.id,
            asset_id=asset.id,
            method="points",
            points_spent=asset.points_to_unlock,
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

        import json as _json
        return UnlockResponse(
            unlocked=True,
            content=_json.loads(asset.content_json),
            new_balance=new_balance,
            method="points",
            points_spent=asset.points_to_unlock,
        )

    raise HTTPException(status_code=400, detail="Invalid method")


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
    method = str(payload.get("method") or "sv").lower()
    if method not in {"sv", "ad"}:
        raise HTTPException(status_code=400, detail="method must be 'sv' or 'ad'")

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
    if existing_result.scalar_one_or_none():
        return AudioUnlockResponse(
            unlocked=True,
            material_id=material_id,
            cost_sv=0,
            method="existing",
            new_balance=(
                current_user.service_credit_balance
                if settings.wallet_split_enabled
                else current_user.points_balance
            ),
            url=f"/api/v1/study/tts/audio/{material_id}_cached.mp3",
            provider="cached",
        )

    cost_sv = _audio_unlock_cost_sv(material.content)

    if method == "sv":
        if settings.wallet_split_enabled:
            balance_result = await db.execute(
                select(User.service_credit_balance).where(User.id == current_user.id)
            )
            balance = balance_result.scalar_one() or 0
            if balance < cost_sv:
                raise HTTPException(
                    status_code=402,
                    detail=f"Need {cost_sv} sv to unlock audio. You have {balance}.",
                )
            await db.execute(
                update(User)
                .where(User.id == current_user.id)
                .values(service_credit_balance=User.service_credit_balance - cost_sv)
            )
        else:
            balance_result = await db.execute(
                select(User.points_balance).where(User.id == current_user.id)
            )
            balance = balance_result.scalar_one() or 0
            if balance < cost_sv:
                raise HTTPException(
                    status_code=402,
                    detail=f"Need {cost_sv} pts to unlock audio. You have {balance}.",
                )
            await db.execute(
                update(User)
                .where(User.id == current_user.id)
                .values(points_balance=User.points_balance - cost_sv)
            )

        unlock = AudioUnlock(
            user_id=current_user.id,
            material_id=material_id,
            method="sv",
            cost_sv=cost_sv,
        )
        db.add(unlock)
        await db.commit()

        new_balance = (
            current_user.service_credit_balance
            if settings.wallet_split_enabled
            else current_user.points_balance
        )
        return AudioUnlockResponse(
            unlocked=True,
            material_id=material_id,
            cost_sv=cost_sv,
            method="sv",
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
    if not material_result.scalar_one_or_none():
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
    if not material_result.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Not your material")

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



# ─────────────────────────────────────────────────────────────────────
# ─ EXAM ENDPOINTS (Phase 3: Critical Gap Fill) ──────────────────────
# ─────────────────────────────────────────────────────────────────────


@router.post("/exam/start", response_model=ExamStartResponse, status_code=201)
async def start_exam(
    payload: ExamStartRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """POST /study/exam/start - Start a new exam session.
    
    Creates an exam session for a material. Fetches the parsed structure
    from the material and generates questions via the AI router, then
    returns them to the client. Session expires in 1 hour.
    
    Returns the session ID, total question count, duration, expiry time,
    and all questions ready to display.
    """
    material_id = payload.material_id
    
    # Fetch material
    result = await db.execute(
        select(StudyMaterial).where(
            StudyMaterial.id == material_id,
            StudyMaterial.user_id == current_user.id,
        )
    )
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")
    
    # Parse material structure
    import json as _json
    try:
        parsed = _json.loads(material.parsed_structure) if material.parsed_structure else {}
    except Exception:
        logger.error("Failed to parse material structure for material=%s", material_id)
        raise HTTPException(status_code=400, detail="Material has no valid parsed structure")
    
    if not isinstance(parsed, dict) or not parsed.get("topics"):
        raise HTTPException(status_code=400, detail="Material has no topics to generate exam from")
    
    # Generate exam questions via AI
    exam_type = material.exam_type or "general"
    education_level = material.parsed_structure or "secondary"
    
    # Call AI router to generate exam questions
    # Prompt will ask for 20 MCQ questions from the material
    prompt = f"""Generate 20 multiple-choice exam questions from the following material.

Material Type: {exam_type}
Education Level: {education_level}

Topics:
{_json.dumps(parsed.get('topics', [])[:10], indent=2)}

For each question, provide:
1. question: The question text
2. options: Array of 4 options (A, B, C, D text)
3. correct_answer: The correct option index (0-3)
4. explanation: Brief explanation of the correct answer

Return ONLY a valid JSON array of question objects. No markdown, no extra text."""
    
    try:
        ai_result = await route_ai(prompt, task_type="heavy")
        questions_text = ai_result.get("response", "")
        
        # Parse the AI response
        import re as _re
        json_match = _re.search(r'\[\s*\{.*\}\s*\]', questions_text, _re.DOTALL)
        if not json_match:
            raise ValueError("No JSON array found in AI response")
        
        questions_data = _json.loads(json_match.group())
        if not isinstance(questions_data, list):
            raise ValueError("AI response is not a list")
    except Exception as exc:
        logger.error("AI exam generation failed: %s", exc)
        raise HTTPException(status_code=502, detail="Failed to generate exam questions")
    
    if not questions_data:
        raise HTTPException(status_code=502, detail="Generated exam has no questions")
    
    # Limit to reasonable count
    total_questions = min(len(questions_data), 50)
    duration_seconds = max(60, total_questions * 90)  # ~90 seconds per question
    
    # Create exam session
    now = datetime.utcnow()
    expires_at = now + __import__('datetime').timedelta(seconds=duration_seconds + 300)  # 5 min buffer
    
    session = StudyExamSession(
        user_id=current_user.id,
        material_id=material_id,
        exam_type=exam_type,
        status="in_progress",
        total_questions=total_questions,
        duration_seconds=duration_seconds,
        started_at=now,
        expires_at=expires_at,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    
    # Store questions
    exam_questions = []
    for idx, q_data in enumerate(questions_data[:total_questions]):
        try:
            # Normalize options - handle both string arrays and individual fields
            options = q_data.get("options", [])
            if not isinstance(options, list):
                options = [str(options)]
            
            # Ensure we have exactly 4 options
            while len(options) < 4:
                options.append(f"Option {len(options) + 1}")
            options = options[:4]
            
            q = StudyExamQuestion(
                session_id=session.id,
                question_index=idx,
                question_text=str(q_data.get("question", "")),
                options=_json.dumps(options),
                correct_answer=str(q_data.get("correct_answer", "0")),
                explanation=str(q_data.get("explanation", "")),
            )
            db.add(q)
            exam_questions.append(q)
        except Exception as exc:
            logger.warning("Failed to process question %s: %s", idx, exc)
            continue
    
    await db.commit()
    
    # Refresh all questions to get IDs
    for q in exam_questions:
        await db.refresh(q)
    
    # Format response
    questions_response = []
    for q in exam_questions:
        options_list = _json.loads(q.options)
        questions_response.append(
            ExamQuestionIn(
                id=q.id,
                question=q.question_text,
                options=options_list,
                explanation=q.explanation,
            )
        )
    
    logger.info(
        "[exam/start] DONE session=%s user=%s material=%s questions=%s duration=%s",
        session.id, current_user.id, material_id, len(questions_response), duration_seconds,
    )
    
    return ExamStartResponse(
        session_id=session.id,
        exam_type=exam_type,
        total_questions=len(questions_response),
        duration_seconds=duration_seconds,
        expires_at=expires_at,
        questions=questions_response,
    )


@router.get("/exam/{session_id}/questions", response_model=ExamQuestionsResponse)
async def get_exam_questions(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """GET /study/exam/{sessionId}/questions - Fetch all exam questions.
    
    Scoped to the current user. Returns an error if the exam has expired.
    """
    result = await db.execute(
        select(StudyExamSession).where(
            StudyExamSession.id == session_id,
            StudyExamSession.user_id == current_user.id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Exam session not found")
    
    # Check expiry
    if session.expires_at < datetime.utcnow():
        session.status = "expired"
        await db.commit()
        raise HTTPException(status_code=410, detail="Exam has expired")
    
    # Fetch questions
    q_result = await db.execute(
        select(StudyExamQuestion)
        .where(StudyExamQuestion.session_id == session_id)
        .order_by(StudyExamQuestion.question_index)
    )
    questions = q_result.scalars().all()
    
    import json as _json
    questions_response = [
        ExamQuestionIn(
            id=q.id,
            question=q.question_text,
            options=_json.loads(q.options),
            explanation=q.explanation,
        )
        for q in questions
    ]
    
    return ExamQuestionsResponse(
        session_id=session.id,
        status=session.status,
        expires_at=session.expires_at,
        total_questions=session.total_questions,
        questions=questions_response,
    )


@router.post("/exam/{session_id}/answer", response_model=ExamAnswerSubmitResponse)
async def submit_exam_answer(
    session_id: int,
    payload: ExamAnswerSubmitRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """POST /study/exam/{sessionId}/answer - Submit an answer to a question.
    
    Records the user's selected answer. Does NOT grade yet (grading happens
    on exam submit). Returns the question ID and is_correct=None until submit.
    """
    # Verify session exists and belongs to user
    result = await db.execute(
        select(StudyExamSession).where(
            StudyExamSession.id == session_id,
            StudyExamSession.user_id == current_user.id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Exam session not found")
    
    # Check expiry
    if session.expires_at < datetime.utcnow():
        session.status = "expired"
        await db.commit()
        raise HTTPException(status_code=410, detail="Exam has expired")
    
    if session.status != "in_progress":
        raise HTTPException(status_code=409, detail="Exam is not in progress")
    
    # Verify question belongs to this session
    q_result = await db.execute(
        select(StudyExamQuestion).where(
            StudyExamQuestion.id == payload.question_id,
            StudyExamQuestion.session_id == session_id,
        )
    )
    question = q_result.scalar_one_or_none()
    if not question:
        raise HTTPException(status_code=404, detail="Question not found in this exam")
    
    # Store or update answer
    a_result = await db.execute(
        select(StudyExamAnswer).where(
            StudyExamAnswer.session_id == session_id,
            StudyExamAnswer.question_id == payload.question_id,
        )
    )
    answer = a_result.scalar_one_or_none()
    
    if answer:
        answer.selected_answer = payload.selected_answer
    else:
        answer = StudyExamAnswer(
            session_id=session_id,
            question_id=payload.question_id,
            selected_answer=payload.selected_answer,
        )
        db.add(answer)
    
    await db.commit()
    await db.refresh(answer)
    
    return ExamAnswerSubmitResponse(
        question_id=payload.question_id,
        is_correct=None,
    )


@router.post("/exam/{session_id}/submit", response_model=ExamSubmitResponse)
async def submit_exam(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """POST /study/exam/{sessionId}/submit - Submit exam and calculate score.
    
    Grades all answers, calculates score, and locks the session.
    Returns the final score, counts, and pass/fail status (pass = score >= 60).
    """
    result = await db.execute(
        select(StudyExamSession).where(
            StudyExamSession.id == session_id,
            StudyExamSession.user_id == current_user.id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Exam session not found")
    
    if session.status == "submitted":
        raise HTTPException(status_code=409, detail="Exam already submitted")
    
    if session.status != "in_progress":
        raise HTTPException(status_code=409, detail="Exam is not in progress")
    
    # Fetch all answers and questions
    answers_result = await db.execute(
        select(StudyExamAnswer)
        .where(StudyExamAnswer.session_id == session_id)
    )
    answers = answers_result.scalars().all()
    
    questions_result = await db.execute(
        select(StudyExamQuestion)
        .where(StudyExamQuestion.session_id == session_id)
    )
    questions_by_id = {q.id: q for q in questions_result.scalars().all()}
    
    # Grade answers
    correct_count = 0
    import json as _json
    
    for answer in answers:
        question = questions_by_id.get(answer.question_id)
        if not question:
            continue
        
        # Compare answer (case-insensitive, trim whitespace)
        correct_ans = str(question.correct_answer).strip().lower()
        user_ans = str(answer.selected_answer or "").strip().lower()
        is_correct = correct_ans == user_ans
        
        answer.is_correct = is_correct
        if is_correct:
            correct_count += 1
    
    # Calculate score (0-100)
    total_answered = len(answers)
    score = 0
    if total_answered > 0:
        score = int((correct_count / session.total_questions) * 100)
    
    passed = score >= 60
    
    # Update session
    session.status = "submitted"
    session.submitted_at = datetime.utcnow()
    session.score = score
    session.correct_count = correct_count
    session.wrong_count = session.total_questions - correct_count
    session.passed = passed
    
    await db.commit()
    await db.refresh(session)
    
    logger.info(
        "[exam/submit] DONE session=%s user=%s score=%s correct=%s/%s passed=%s",
        session.id, current_user.id, score, correct_count, session.total_questions, passed,
    )
    
    return ExamSubmitResponse(
        session_id=session.id,
        score=score,
        correct_count=correct_count,
        wrong_count=session.total_questions - correct_count,
        total_questions=session.total_questions,
        passed=passed,
    )


@router.get("/exam/history", response_model=ExamHistoryResponse)
async def get_exam_history(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """GET /study/exam/history - Fetch exam history for the user.
    
    Returns all exam sessions (submitted or expired) in reverse chronological order.
    """
    result = await db.execute(
        select(StudyExamSession)
        .where(StudyExamSession.user_id == current_user.id)
        .order_by(StudyExamSession.started_at.desc())
    )
    sessions = result.scalars().all()
    
    exams = [
        ExamHistoryItem(
            id=s.id,
            exam_type=s.exam_type,
            score=s.score,
            correct_count=s.correct_count,
            wrong_count=s.wrong_count,
            total_questions=s.total_questions,
            started_at=s.started_at,
            submitted_at=s.submitted_at,
            passed=s.passed,
        )
        for s in sessions
    ]
    
    return ExamHistoryResponse(exams=exams)


@router.get("/exam/{session_id}/result", response_model=ExamResultResponse)
async def get_exam_result(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """GET /study/exam/{sessionId}/result - Fetch full exam results with review.
    
    Returns the session data plus all questions with user's answers and
    correctness for post-exam review.
    """
    result = await db.execute(
        select(StudyExamSession).where(
            StudyExamSession.id == session_id,
            StudyExamSession.user_id == current_user.id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Exam session not found")
    
    if session.status != "submitted":
        raise HTTPException(status_code=409, detail="Exam results not available yet (not submitted)")
    
    # Fetch questions and answers
    q_result = await db.execute(
        select(StudyExamQuestion)
        .where(StudyExamQuestion.session_id == session_id)
        .order_by(StudyExamQuestion.question_index)
    )
    questions = q_result.scalars().all()
    
    a_result = await db.execute(
        select(StudyExamAnswer)
        .where(StudyExamAnswer.session_id == session_id)
    )
    answers_by_q = {a.question_id: a for a in a_result.scalars().all()}
    
    import json as _json
    result_questions = []
    for q in questions:
        answer = answers_by_q.get(q.id)
        result_questions.append(
            ExamQuestionResult(
                id=q.id,
                question=q.question_text,
                options=_json.loads(q.options),
                correct_answer=q.correct_answer,
                selected_answer=answer.selected_answer if answer else None,
                is_correct=answer.is_correct if answer else None,
                explanation=q.explanation,
            )
        )
    
    return ExamResultResponse(
        session_id=session.id,
        exam_type=session.exam_type,
        score=session.score or 0,
        correct_count=session.correct_count,
        wrong_count=session.wrong_count,
        total_questions=session.total_questions,
        passed=session.passed or False,
        started_at=session.started_at,
        submitted_at=session.submitted_at,
        questions=result_questions,
    )


# ─────────────────────────────────────────────────────────────────────


@router.post("/tts", response_model=TtsResponse)
async def synthesize_study_tts(
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """On-demand TTS for study material text.

    Body: { "text": str, "voice"?: str, "provider"?: str, "material_id"?: int }
    Returns: { "url": str, "provider": str, "cached": bool }

    Uses the hybrid provider chain in services/tts_hybrid.py.
    Audio is cached to disk; repeat reads return the cached URL.
    Gated on premium or audio_unlock for the material.
    """
    text = payload.get("text") or ""
    if not text.strip():
        raise HTTPException(status_code=400, detail="text is required")
    if len(text) > 4000:
        text = text[:4000]

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
        audio, used_provider, duration_seconds = await synthesize_study_audio(text, voice, provider=provider)
    except Exception as exc:
        logger.error("TTS synthesis failed for user=%s: %s", current_user.id, exc)
        raise HTTPException(status_code=502, detail=f"TTS synthesis failed: {exc}")

    # Cache is stored with Cloudflare provider
    import hashlib
    cache_key = hashlib.sha256(f"cloudflare:{voice}:{text}".encode()).hexdigest()[:16]
    cache_name = f"{cache_key}.mp3"
    return TtsResponse(
        url=f"/api/v1/study/tts/audio/{cache_name}",
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
    return FileResponse(
        path,
        media_type="audio/mpeg",
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


# ── Phase D: Audio/Podcast Narration ─────────────────────────────────

import json as _json_module


def _extract_topics_from_structure(parsed: dict) -> list[dict]:
    """Extract topics from parsed_structure JSON.
    
    Looks for keys: 'topics', 'chapters', 'units', 'sections' (in that order).
    Returns a list of dicts with 'name' and optional 'content' keys.
    """
    for key in ['topics', 'chapters', 'units', 'sections']:
        if key in parsed:
            items = parsed[key]
            if isinstance(items, list):
                return items
    return []


def _calculate_episode_cost_sv(char_count: int) -> int:
    """Calculate cost in SV for a given character count.
    
    Cost formula: ceil((char_count / 1000) * 0.43 * 10) SV
    This rounds up to nearest integer.
    """
    import math
    cost_float = (char_count / 1000.0) * 0.43 * 10
    return math.ceil(cost_float)


def _calculate_estimated_seconds(char_count: int) -> int:
    """Calculate estimated playback seconds at 15 chars/sec."""
    return int(char_count / 15)


def _split_topic_into_episodes(topic_content: str, topic_index: int) -> list[dict]:
    """Split topic text into episodes (max 5,400 chars per episode).
    
    Returns list of dicts with:
      - episode_index: 0-based episode number for this topic
      - total_episodes: total episodes for this topic
      - char_count: chars in this episode
      - estimated_seconds: estimated playback time
      - cost_sv: cost in SV for this episode
    """
    chunk_size = 5400
    total_length = len(topic_content)
    episodes = []
    
    for i in range(0, total_length, chunk_size):
        chunk = topic_content[i:i+chunk_size]
        char_count = len(chunk)
        cost_sv = _calculate_episode_cost_sv(char_count)
        estimated_seconds = _calculate_estimated_seconds(char_count)
        
        episodes.append({
            'episode_index': len(episodes),
            'total_episodes': None,  # Will be set below
            'char_count': char_count,
            'estimated_seconds': estimated_seconds,
            'cost_sv': cost_sv,
        })
    
    # Update total_episodes for all
    total = len(episodes)
    for ep in episodes:
        ep['total_episodes'] = total
    
    return episodes if episodes else [{
        'episode_index': 0,
        'total_episodes': 1,
        'char_count': 0,
        'estimated_seconds': 0,
        'cost_sv': 0,
    }]


@router.get("/audio/topics/{material_id}", response_model=AudioTopicsResponseSchema)
async def fetch_audio_topics(
    material_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Fetch narratable topics for a study material.
    
    Extracts topics from parsed_structure, calculates episode counts and costs.
    Returns all topics with education levels available for this material.
    """
    result = await db.execute(
        select(StudyMaterial).where(
            StudyMaterial.id == material_id,
            StudyMaterial.user_id == current_user.id,
        )
    )
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")
    
    if not material.parsed_structure:
        raise HTTPException(status_code=400, detail="Material has no parsed structure")
    
    parsed = _json_module.loads(material.parsed_structure)
    topics_data = _extract_topics_from_structure(parsed)
    
    # Build response topics
    response_topics = []
    for topic_index, topic_item in enumerate(topics_data):
        topic_name = topic_item.get('name', f'Topic {topic_index}')
        # Extract content from topic (could be in 'content', 'text', 'description', etc.)
        topic_content = (
            topic_item.get('content') or
            topic_item.get('text') or
            topic_item.get('description') or
            ''
        )
        if isinstance(topic_item, str):
            topic_content = topic_item
        
        char_count = len(topic_content)
        episodes = _split_topic_into_episodes(topic_content, topic_index)
        total_episodes = len(episodes)
        total_cost = sum(ep['cost_sv'] for ep in episodes)
        total_estimated = sum(ep['estimated_seconds'] for ep in episodes)
        
        response_topics.append(AudioTopicSchema(
            topic_index=topic_index,
            topic_name=topic_name,
            episodes=total_episodes,
            char_count=char_count,
            estimated_seconds=total_estimated,
            cost_sv=total_cost,
        ))
    
    # Default education level
    default_level = material.education_level or 'primary'
    if default_level not in ['primary', 'secondary', 'tertiary', 'research']:
        default_level = 'primary'
    
    return AudioTopicsResponseSchema(
        material_id=material_id,
        title=material.title,
        topics=response_topics,
        levels=['primary', 'secondary', 'tertiary', 'research'],
        default_level=default_level,
    )


@router.post("/audio/quote/{material_id}", response_model=AudioQuoteSchema)
async def quote_audio_narration(
    material_id: int,
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Quote the cost of narrating selected topics."""
    result = await db.execute(
        select(StudyMaterial).where(
            StudyMaterial.id == material_id,
            StudyMaterial.user_id == current_user.id,
        )
    )
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")
    
    if not material.parsed_structure:
        raise HTTPException(status_code=400, detail="Material has no parsed structure")
    
    topic_indexes = payload.get('topic_indexes', [])
    if not topic_indexes or not isinstance(topic_indexes, list):
        raise HTTPException(status_code=400, detail="topic_indexes must be a non-empty list")
    
    level = payload.get('level', material.education_level or 'primary')
    
    parsed = _json_module.loads(material.parsed_structure)
    topics_data = _extract_topics_from_structure(parsed)
    
    # Validate and collect selected topics
    selected_topics = []
    for idx in topic_indexes:
        if not isinstance(idx, int) or idx < 0 or idx >= len(topics_data):
            raise HTTPException(status_code=400, detail=f"topic_index {idx} out of range")
        selected_topics.append((idx, topics_data[idx]))
    
    # Calculate costs
    total_char_count = 0
    total_episodes = 0
    total_cost_sv = 0
    response_topics = []
    
    for topic_index, topic_item in selected_topics:
        topic_name = topic_item.get('name', f'Topic {topic_index}')
        topic_content = (
            topic_item.get('content') or
            topic_item.get('text') or
            topic_item.get('description') or
            ''
        )
        if isinstance(topic_item, str):
            topic_content = topic_item
        
        char_count = len(topic_content)
        episodes = _split_topic_into_episodes(topic_content, topic_index)
        topic_episodes = len(episodes)
        topic_cost = sum(ep['cost_sv'] for ep in episodes)
        
        total_char_count += char_count
        total_episodes += topic_episodes
        total_cost_sv += topic_cost
        
        response_topics.append(AudioTopicSchema(
            topic_index=topic_index,
            topic_name=topic_name,
            episodes=topic_episodes,
            char_count=char_count,
            estimated_seconds=sum(ep['estimated_seconds'] for ep in episodes),
            cost_sv=topic_cost,
        ))
    
    estimated_seconds = _calculate_estimated_seconds(total_char_count)
    balance_sv = current_user.service_credit_balance
    
    return AudioQuoteSchema(
        level=level,
        topics=response_topics,
        topic_count=len(selected_topics),
        episode_count=total_episodes,
        total_char_count=total_char_count,
        total_cost_sv=total_cost_sv,
        estimated_seconds=estimated_seconds,
        balance_sv=balance_sv,
    )


@router.post("/audio/batches/{material_id}", response_model=AudioBatchCreateResultSchema)
async def create_audio_batches(
    material_id: int,
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a batch of audio episodes to be generated.
    
    Checks balance, creates batch and episodes in 'queued' status.
    Returns 402 if balance insufficient.
    """
    result = await db.execute(
        select(StudyMaterial).where(
            StudyMaterial.id == material_id,
            StudyMaterial.user_id == current_user.id,
        )
    )
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")
    
    if not material.parsed_structure:
        raise HTTPException(status_code=400, detail="Material has no parsed structure")
    
    topic_indexes = payload.get('topic_indexes', [])
    if not topic_indexes or not isinstance(topic_indexes, list):
        raise HTTPException(status_code=400, detail="topic_indexes must be a non-empty list")
    
    level = payload.get('level', material.education_level or 'primary')
    
    parsed = _json_module.loads(material.parsed_structure)
    topics_data = _extract_topics_from_structure(parsed)
    
    # Validate topic indexes
    for idx in topic_indexes:
        if not isinstance(idx, int) or idx < 0 or idx >= len(topics_data):
            raise HTTPException(status_code=400, detail=f"topic_index {idx} out of range")
    
    # Calculate total cost
    total_cost_sv = 0
    all_episodes_data = []  # (topic_index, episode_data)
    
    # Validate non-empty topics
    for topic_index in topic_indexes:
        topic_item = topics_data[topic_index]
        topic_content = (
            topic_item.get('content') or
            topic_item.get('text') or
            topic_item.get('description') or
            ''
        )
        if isinstance(topic_item, str):
            topic_content = topic_item
        
        # Validate that topic has non-empty content
        if not topic_content or not topic_content.strip():
            raise HTTPException(
                status_code=422,
                detail=f"Topic at index {topic_index} has empty content"
            )
    
    for topic_index in topic_indexes:
        topic_item = topics_data[topic_index]
        topic_content = (
            topic_item.get('content') or
            topic_item.get('text') or
            topic_item.get('description') or
            ''
        )
        if isinstance(topic_item, str):
            topic_content = topic_item
        
        episodes = _split_topic_into_episodes(topic_content, topic_index)
        for episode in episodes:
            total_cost_sv += episode['cost_sv']
            all_episodes_data.append((topic_index, episode))
    
    # Check balance
    if current_user.service_credit_balance < total_cost_sv:
        raise HTTPException(
            status_code=402,
            detail=f"Insufficient balance. Need {total_cost_sv} SV, have {current_user.service_credit_balance} SV."
        )
    
    # Create batch record
    from app.models import AudioBatch, AudioEpisode
    batch = AudioBatch(
        material_id=material_id,
        user_id=current_user.id,
        topic_indexes=_json_module.dumps(topic_indexes),
        total_episodes=len(all_episodes_data),
        total_cost_sv=total_cost_sv,
        status='queued',
    )
    db.add(batch)
    await db.flush()  # Flush to get batch.id
    
    # Create episode records
    episode_records = []
    for topic_index, episode in all_episodes_data:
        ep = AudioEpisode(
            batch_id=batch.id,
            material_id=material_id,
            topic_index=topic_index,
            episode_index=episode['episode_index'],
            total_episodes=episode['total_episodes'],
            level=level,
            status='queued',
            cost_sv=episode['cost_sv'],
            char_count=episode['char_count'],
            estimated_seconds=episode['estimated_seconds'],
        )
        episode_records.append(ep)
        db.add(ep)
    
    await db.commit()
    await db.refresh(batch)
    
    # Refresh episodes to get IDs
    for ep in episode_records:
        await db.refresh(ep)
    
    # Log batch creation for persistent cost tracking
    log_entry = AiUsageLog(
        user_id=current_user.id,
        operation="audio_batch_create",
        model="@cf/myshell-ai/melotts",
        input_tokens=sum(ep['char_count'] for _, ep in all_episodes_data),
        cost_neurons=total_cost_sv * 1000.0 / 11.0,  # Convert SV to Neurons: 1000 neurons = $0.011 ≈ 1 SV
        meta={
            'batch_id': batch.id,
            'material_id': material_id,
            'total_episodes': len(episode_records),
            'total_cost_sv': total_cost_sv,
        }
    )
    db.add(log_entry)
    
    logger.info(
        "[AUDIO_BATCH] Batch created: user_id=%s, batch_id=%s, material_id=%s, "
        "total_episodes=%s, total_cost_sv=%s, topic_count=%s",
        current_user.id, batch.id, material_id, len(episode_records), 
        total_cost_sv, len(topic_indexes)
    )
    
    await db.flush()
    
    # Build response
    episode_schemas = [
        AudioEpisodeSchema(
            id=ep.id,
            topic_index=ep.topic_index,
            episode_index=ep.episode_index,
            total_episodes=ep.total_episodes,
            level=ep.level,
            status=ep.status,
            cost_sv=ep.cost_sv,
            char_count=ep.char_count,
            estimated_seconds=ep.estimated_seconds,
            actual_duration_seconds=None,
            audio_url=None,
            position_seconds=0,
            completed_at=None,
            refunded_at=None,
            error_message=None,
            created_at=ep.created_at,
        )
        for ep in episode_records
    ]
    
    return AudioBatchCreateResultSchema(
        ok=True,
        cost_sv=total_cost_sv,
        balance_sv=current_user.service_credit_balance - total_cost_sv,
        created=len(episode_records),
        episodes=episode_schemas,
    )


@router.get("/audio/batches/{material_id}", response_model=AudioBatchesResponseSchema)
async def fetch_audio_batches(
    material_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Fetch all audio batches and episodes for this user+material."""
    from app.models import AudioBatch, AudioEpisode
    
    # Verify material exists and belongs to user
    mat_result = await db.execute(
        select(StudyMaterial).where(
            StudyMaterial.id == material_id,
            StudyMaterial.user_id == current_user.id,
        )
    )
    material = mat_result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")
    
    # Fetch all batches for this user+material
    batch_result = await db.execute(
        select(AudioBatch).where(
            AudioBatch.material_id == material_id,
            AudioBatch.user_id == current_user.id,
        ).order_by(AudioBatch.created_at.desc())
    )
    batches = batch_result.scalars().all()
    
    # Fetch all episodes for these batches
    if batches:
        batch_ids = [b.id for b in batches]
        ep_result = await db.execute(
            select(AudioEpisode).where(
                AudioEpisode.batch_id.in_(batch_ids)
            ).order_by(AudioEpisode.batch_id, AudioEpisode.topic_index, AudioEpisode.episode_index)
        )
        episodes = ep_result.scalars().all()
    else:
        episodes = []
    
    # Find next queued episode
    next_episode_id = None
    for ep in episodes:
        if ep.status == 'queued':
            next_episode_id = ep.id
            break
    
    # Calculate totals
    total_cost_sv = sum(b.total_cost_sv for b in batches)
    refunded_sv = sum(b.refunded_sv for b in batches)
    
    # Build response
    episode_schemas = [
        AudioEpisodeSchema(
            id=ep.id,
            topic_index=ep.topic_index,
            episode_index=ep.episode_index,
            total_episodes=ep.total_episodes,
            level=ep.level,
            status=ep.status,
            cost_sv=ep.cost_sv,
            char_count=ep.char_count,
            estimated_seconds=ep.estimated_seconds,
            actual_duration_seconds=ep.actual_duration_seconds,
            audio_url=ep.audio_url,
            position_seconds=ep.position_seconds,
            completed_at=ep.completed_at,
            refunded_at=ep.refunded_at,
            error_message=ep.error_message,
            created_at=ep.created_at,
        )
        for ep in episodes
    ]
    
    return AudioBatchesResponseSchema(
        material_id=material_id,
        episodes=episode_schemas,
        next_episode_id=next_episode_id,
        total_cost_sv=total_cost_sv,
        refunded_sv=refunded_sv,
    )


@router.post("/audio/generate-next/{material_id}")
async def generate_next_audio_episode(
    material_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate the next queued audio episode.
    
    Calls TTS, stores audio, deducts cost from balance.
    On failure, refunds the cost.
    """
    from app.models import AudioBatch, AudioEpisode
    
    # Find next queued episode for this material
    ep_result = await db.execute(
        select(AudioEpisode).where(
            AudioEpisode.material_id == material_id,
            AudioEpisode.status == 'queued',
        ).order_by(AudioEpisode.created_at).limit(1)
    )
    episode = ep_result.scalar_one_or_none()
    
    if not episode:
        return {
            'processed': None,
            'remaining': 0,
        }
    
    # Fetch the material to get topic content
    mat_result = await db.execute(
        select(StudyMaterial).where(StudyMaterial.id == material_id)
    )
    material = mat_result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")
    
    # Verify ownership
    if material.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    
    # Extract topic content
    parsed = _json_module.loads(material.parsed_structure or '{}')
    topics_data = _extract_topics_from_structure(parsed)
    
    if episode.topic_index >= len(topics_data):
        # Topic index out of range
        episode.status = 'failed'
        episode.error_message = 'Topic index out of range in material'
        await db.commit()
        return {
            'processed': episode.id,
            'error': 'topic_index_mismatch',
            'remaining': 0,
        }
    
    topic_item = topics_data[episode.topic_index]
    topic_content = (
        topic_item.get('content') or
        topic_item.get('text') or
        topic_item.get('description') or
        ''
    )
    if isinstance(topic_item, str):
        topic_content = topic_item
    
    # Extract the chunk for this episode
    chunk_size = 5400
    start = episode.episode_index * chunk_size
    end = start + chunk_size
    episode_text = topic_content[start:end]
    
    # Update status to 'generating'
    episode.status = 'generating'
    await db.commit()
    
    # Call TTS (Cloudflare Workers AI)
    try:
        audio_bytes, used_provider, duration_seconds = await synthesize_study_audio(episode_text, voice='default')
        
        # Store audio
        episode.audio_data = audio_bytes
        # Set audio_url as endpoint path
        episode.audio_url = f'/api/v1/study/audio/episodes/{episode.id}/audio'
        episode.status = 'ready'
        episode.completed_at = datetime.utcnow()
        
        # Set active_episode_id if not already set
        batch = await db.get(AudioBatch, episode.batch_id)
        if batch and not batch.active_episode_id:
            batch.active_episode_id = episode.id
        
        # Deduct cost from user balance
        await db.execute(
            update(User).where(User.id == current_user.id).values(
                service_credit_balance=User.service_credit_balance - episode.cost_sv
            )
        )
        
        # Log cost deduction for persistent cost tracking
        # Cost calculation: duration_seconds * 0.5 * education_level_multiplier (in PRIMARY = 1.0)
        log_entry = AiUsageLog(
            user_id=current_user.id,
            operation="audio_episode_generate",
            model="@cf/myshell-ai/melotts",
            input_tokens=episode.char_count,
            cost_neurons=episode.cost_sv * 1000.0 / 11.0,  # Convert SV to Neurons
            meta={
                'batch_id': episode.batch_id,
                'episode_id': episode.id,
                'material_id': material_id,
                'cost_sv': episode.cost_sv,
                'duration_seconds': duration_seconds,
            }
        )
        db.add(log_entry)
        
        logger.info(
            "[AUDIO_COST] Episode generated: user_id=%s, episode_id=%s, batch_id=%s, "
            "material_id=%s, cost_sv=%s, char_count=%s, provider=%s, duration_seconds=%.2f",
            current_user.id, episode.id, episode.batch_id, material_id, 
            episode.cost_sv, episode.char_count, used_provider, duration_seconds
        )
        
        await db.commit()
        
        # Count remaining queued episodes
        remaining_result = await db.execute(
            select(func.count(AudioEpisode.id)).where(
                AudioEpisode.material_id == material_id,
                AudioEpisode.status == 'queued',
            )
        )
        remaining = remaining_result.scalar() or 0
        
        return {
            'processed': episode.id,
            'topic_index': episode.topic_index,
            'episode_index': episode.episode_index,
            'remaining': remaining,
        }
    
    except Exception as e:
        logger.error(f"TTS synthesis failed for episode {episode.id}: {e}")
        
        # Mark as failed
        episode.status = 'failed'
        episode.error_message = str(e)
        episode.refunded_at = datetime.utcnow()
        
        # Refund cost
        await db.execute(
            update(User).where(User.id == current_user.id).values(
                service_credit_balance=User.service_credit_balance + episode.cost_sv
            )
        )
        
        # Update batch refunded_sv
        batch = await db.get(AudioBatch, episode.batch_id)
        if batch:
            batch.refunded_sv += episode.cost_sv
        
        await db.commit()
        
        # Log refund for persistent cost tracking
        log_entry = AiUsageLog(
            user_id=current_user.id,
            operation="audio_episode_retry",
            model="@cf/myshell-ai/melotts",
            input_tokens=episode.char_count,
            cost_neurons=episode.cost_sv * 1000.0 / 11.0,  # Convert SV to Neurons
            meta={
                'batch_id': episode.batch_id,
                'episode_id': episode.id,
                'material_id': material_id,
                'refunded_sv': episode.cost_sv,
                'error': str(e)[:100],
            }
        )
        db.add(log_entry)
        
        logger.warning(
            "[AUDIO_REFUND] Episode failed and refunded: user_id=%s, episode_id=%s, "
            "batch_id=%s, material_id=%s, refunded_sv=%s, error=%s",
            current_user.id, episode.id, episode.batch_id, material_id, 
            episode.cost_sv, str(e)[:100]
        )
        
        await db.commit()
        
        # Count remaining queued
        remaining_result = await db.execute(
            select(func.count(AudioEpisode.id)).where(
                AudioEpisode.material_id == material_id,
                AudioEpisode.status == 'queued',
            )
        )
        remaining = remaining_result.scalar() or 0
        
        return {
            'processed': episode.id,
            'error': 'generation_failed',
            'refunded': True,
            'remaining': remaining,
        }


@router.post("/audio/batches/{batch_id}/position")
async def save_audio_position(
    batch_id: int,
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Save playback position for the active episode in a batch."""
    from app.models import AudioBatch, AudioEpisode
    
    # Verify batch belongs to current user
    batch_result = await db.execute(
        select(AudioBatch).where(AudioBatch.id == batch_id)
    )
    batch = batch_result.scalar_one_or_none()
    if not batch or batch.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Batch not found")
    
    position_seconds = payload.get('position_seconds', 0)
    completed = payload.get('completed', False)
    
    if position_seconds < 0:
        raise HTTPException(status_code=400, detail="position_seconds must be non-negative")
    
    # Find the episode to update
    # Priority: explicit episode_id in payload, then batch.active_episode_id, then first episode
    episode = None
    
    if 'episode_id' in payload:
        # Use provided episode_id
        ep_result = await db.execute(
            select(AudioEpisode).where(
                AudioEpisode.id == payload['episode_id'],
                AudioEpisode.batch_id == batch_id
            )
        )
        episode = ep_result.scalar_one_or_none()
        if not episode:
            raise HTTPException(status_code=404, detail="Episode not found in this batch")
    elif batch.active_episode_id:
        # Use active_episode_id if set
        ep_result = await db.execute(
            select(AudioEpisode).where(AudioEpisode.id == batch.active_episode_id)
        )
        episode = ep_result.scalar_one_or_none()
    else:
        # Fallback: use first episode by order
        ep_result = await db.execute(
            select(AudioEpisode).where(
                AudioEpisode.batch_id == batch_id
            ).order_by(AudioEpisode.topic_index, AudioEpisode.episode_index).limit(1)
        )
        episode = ep_result.scalar_one_or_none()
    
    if episode:
        # Update position for this episode
        episode.position_seconds = position_seconds
        
        # Also update active_episode_id on the batch if we're updating a specific episode
        if 'episode_id' in payload:
            batch.active_episode_id = episode.id
        
        if completed:
            episode.completed_at = datetime.utcnow()
    
    await db.commit()
    
    return {'ok': True}


@router.post("/audio/batches/{batch_id}/retry")
async def retry_audio_batch(
    batch_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Retry all failed episodes in a batch.
    
    Recalculates costs using current rates. Checks that user has sufficient
    balance to retry failed episodes. Returns 402 if balance insufficient.
    """
    from app.models import AudioBatch, AudioEpisode
    
    # Verify batch belongs to user
    batch_result = await db.execute(
        select(AudioBatch).where(AudioBatch.id == batch_id)
    )
    batch = batch_result.scalar_one_or_none()
    if not batch or batch.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Batch not found")
    
    # Find failed episodes
    failed_result = await db.execute(
        select(AudioEpisode).where(
            AudioEpisode.batch_id == batch_id,
            AudioEpisode.status == 'failed',
        )
    )
    failed_episodes = failed_result.scalars().all()
    
    if not failed_episodes:
        raise HTTPException(status_code=400, detail="No failed episodes to retry")
    
    # Recalculate costs using current rate formula
    total_retry_cost = sum(_calculate_episode_cost_sv(ep.char_count) for ep in failed_episodes)
    
    # Check balance before allowing retry
    if current_user.service_credit_balance < total_retry_cost:
        raise HTTPException(
            status_code=402,
            detail=f"Insufficient balance to retry. Need {total_retry_cost} SV, have {current_user.service_credit_balance} SV."
        )
    
    # Reset episodes
    for ep in failed_episodes:
        ep.status = 'queued'
        ep.error_message = None
        ep.refunded_at = None
    
    # Deduct cost from balance for retry
    await db.execute(
        update(User).where(User.id == current_user.id).values(
            service_credit_balance=User.service_credit_balance - total_retry_cost
        )
    )
    
    # Update batch: clear refunded_sv for retried episodes
    batch.refunded_sv = max(0, batch.refunded_sv - total_retry_cost)
    
    await db.commit()
    
    return {'ok': True}


@router.get("/audio/episodes/{episode_id}/audio")
async def serve_episode_audio(
    episode_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Serve audio file for a specific episode."""
    from app.models import AudioEpisode, AudioBatch
    
    ep_result = await db.execute(
        select(AudioEpisode).where(AudioEpisode.id == episode_id)
    )
    episode = ep_result.scalar_one_or_none()
    if not episode:
        raise HTTPException(status_code=404, detail="Episode not found")
    
    # Verify ownership
    batch_result = await db.execute(
        select(AudioBatch).where(AudioBatch.id == episode.batch_id)
    )
    batch = batch_result.scalar_one_or_none()
    if not batch or batch.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    if not episode.audio_data:
        raise HTTPException(status_code=404, detail="Audio not yet generated")
    
    return Response(
        content=episode.audio_data,
        media_type='audio/mpeg',
        headers={
            'Cache-Control': 'public, max-age=86400',
            'Content-Disposition': f'inline; filename="episode_{episode_id}.mp3"',
        }
    )




@router.post("/ads/revenue")
async def report_ad_revenue(request: Request):
    """Telemetry endpoint for ad impression monetary values.

    The frontend reports ad revenue micros so we can verify that rewards
    are funded by ad revenue. This endpoint intentionally does no DB writes;
    it only acknowledges receipt.
    """
    try:
        await request.json()
    except Exception:
        pass
    return {"status": "ok"}
