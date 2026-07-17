"""Study endpoints for Phase 3: AI Exam Prep.

SOW upload → AI parsing → asset generation (MCQ/flashcard/essay) →
ad-or-points gated unlock → streaming study chat.
"""

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.prompts import (
    CHAT_TUTOR_SYSTEM,
    MCQ_GENERATOR,
    FLASHCARD_GENERATOR,
    ESSAY_GENERATOR,
    SOW_PARSER,
)
from app.ai.router import route_ai
from app.database import get_db
from app.models import StudyAsset, StudyMaterial, StudyTransaction, User, ReadingSession
from app.routers.auth import get_current_user
from app.services.sanitize import (
    safe_filename,
    sanitize_for_display,
)
from app.schemas import (
    ChatRequest,
    ChatResponse,
    GenerateAssetRequest,
    GenerateAssetResponse,
    MaterialDetail,
    MaterialSummary,
    QuizCompleteRequest,
    QuizCompleteResponse,
    SowUploadRequest,
    SowUploadResponse,
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
MAX_SOW_DOC_BYTES: int = 10 * 1024 * 1024    # 10 MB

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

UNLOCK_POINTS_COST = 50


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


@router.post("/sow/upload-image", response_model=SowUploadResponse, status_code=201)
async def upload_sow_image(
    file: UploadFile = File(...),
    exam_type: str | None = Form(default=None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload a SOW image. OCR via Gemini Vision then parse as text."""
    api_key = None
    from app.config import settings
    api_key = settings.gemini_api_key
    if not api_key:
        raise HTTPException(status_code=503, detail="Gemini not configured for image upload")

    # Content-type allowlist — `file.content_type` is set by the
    # client and is attacker-controlled. Reject anything other than
    # the types Gemini Vision actually accepts.
    ctype = (file.content_type or "").lower().split(";", 1)[0].strip()
    if ctype not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported image type: {ctype!r}. Use JPEG, PNG, WEBP, or HEIC.",
        )

    # Sanitize the filename BEFORE we read the body so a hostile
    # path-traversal filename never touches the DB or the log.
    safe_name = safe_filename(file.filename, fallback="upload.jpg")

    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(contents) > MAX_SOW_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Image too large (max {MAX_SOW_IMAGE_BYTES // (1024*1024)} MB)",
        )

    # Use Gemini Vision for OCR
    import base64
    import httpx
    from app.ai.prompts import SOW_PARSER

    b64 = base64.b64encode(contents).decode()
    url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    headers = {"x-goog-api-key": api_key}
    body = {
        "contents": [{
            "parts": [
                {"text": "Extract all text from this image. Return the raw text exactly as written, preserving structure (headings, bullet points, numbering)."},
                {"inline_data": {"mime_type": file.content_type or "image/jpeg", "data": b64}},
            ]
        }],
        "generationConfig": {"maxOutputTokens": 8000, "temperature": 0.1},
    }

    extracted_text = ""
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(url, json=body, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                extracted_text = data["candidates"][0]["content"]["parts"][0]["text"]
    except Exception as exc:
        logger.error("Gemini Vision OCR failed: %s", exc)
        raise HTTPException(status_code=502, detail="Image OCR failed") from exc

    if not extracted_text.strip():
        raise HTTPException(status_code=400, detail="Could not extract text from image")

    # Now parse the extracted text
    prompt = SOW_PARSER.format(raw_text=extracted_text)
    ai_result = await route_ai(prompt, task_type="heavy", db=db)

    parsed = None
    try:
        import json as _json
        parsed = _json.loads(ai_result["response"])
    except Exception:
        logger.error("SOW parser returned non-JSON: %s", ai_result["response"][:200])

    title = (parsed or {}).get("title", safe_name) if isinstance(parsed, dict) else safe_name

    material = StudyMaterial(
        user_id=current_user.id,
        title=title,
        exam_type=exam_type,
        raw_input=f"[IMAGE: {safe_name}]\n{extracted_text}",
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


@router.post("/sow/upload-document", response_model=SowUploadResponse, status_code=201)
async def upload_sow_document(
    file: UploadFile = File(...),
    exam_type: str | None = Form(default=None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload a SOW document (PDF, DOCX, TXT). Extract text then parse."""
    # Sanitize filename before we read the body — the path-traversal
    # filename is the most likely attack vector, the body size is
    # secondary.
    safe_name = safe_filename(file.filename, fallback="document")

    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(contents) > MAX_SOW_DOC_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Document too large (max {MAX_SOW_DOC_BYTES // (1024*1024)} MB)",
        )

    extracted_text = ""
    # Use the sanitized name for the extension check too — if a
    # malicious user names a PDF "evil.jpg", the sanitized name
    # still ends in .jpg and is correctly rejected by the parser
    # branch below.
    filename = safe_name

    # Determine file type and extract text
    if filename.lower().endswith('.pdf'):
        # Extract text from PDF
        try:
            import pypdf
            from io import BytesIO
            pdf_reader = pypdf.PdfReader(BytesIO(contents))
            text_parts = []
            for page in pdf_reader.pages:
                text_parts.append(page.extract_text())
            extracted_text = "\n".join(text_parts)
        except Exception as exc:
            logger.error("PDF extraction failed: %s", exc)
            raise HTTPException(status_code=400, detail="Could not extract text from PDF. Try uploading as image or text.") from exc

    elif filename.lower().endswith(('.docx', '.doc')):
        # Extract text from Word document
        try:
            import docx
            from io import BytesIO
            doc = docx.Document(BytesIO(contents))
            text_parts = [para.text for para in doc.paragraphs]
            extracted_text = "\n".join(text_parts)
        except Exception as exc:
            logger.error("DOCX extraction failed: %s", exc)
            raise HTTPException(status_code=400, detail="Could not extract text from Word document. Try uploading as PDF or text.") from exc

    elif filename.lower().endswith('.txt'):
        # Plain text file
        try:
            extracted_text = contents.decode('utf-8')
        except UnicodeDecodeError:
            try:
                extracted_text = contents.decode('latin-1')
            except Exception as exc:
                logger.error("Text file decode failed: %s", exc)
                raise HTTPException(status_code=400, detail="Could not decode text file.") from exc
    else:
        raise HTTPException(status_code=400, detail="Unsupported file type. Upload PDF, DOCX, or TXT.")

    if not extracted_text.strip():
        raise HTTPException(status_code=400, detail="Could not extract text from document")

    # Parse the extracted text with AI
    from app.ai.prompts import SOW_PARSER
    prompt = SOW_PARSER.format(raw_text=extracted_text)
    ai_result = await route_ai(prompt, task_type="heavy", db=db)

    parsed = None
    try:
        import json as _json
        parsed = _json.loads(ai_result["response"])
    except Exception:
        logger.error("SOW parser returned non-JSON: %s", ai_result["response"][:200])

    title = (parsed or {}).get("title", filename) if isinstance(parsed, dict) else filename

    material = StudyMaterial(
        user_id=current_user.id,
        title=title,
        exam_type=exam_type,
        raw_input=f"[DOCUMENT: {filename}]\n{extracted_text}",
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
        parsed_structure=parsed,
        assets=asset_list,
        created_at=material.created_at,
    )


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

    # Build context from parsed structure
    context_parts = []
    for topic in parsed.get("topics", []):
        context_parts.append(f"Topic: {topic['name']}")
        for st in topic.get("subtopics", []):
            context_parts.append(f"  - {st}")
        for cc in topic.get("key_concepts", []):
            context_parts.append(f"    * {cc}")
    context = "\n".join(context_parts)

    if payload.asset_type == "mcq":
        prompt = MCQ_GENERATOR.format(context=context, count=payload.count)
    elif payload.asset_type == "flashcard":
        prompt = FLASHCARD_GENERATOR.format(context=context, count=payload.count)
    elif payload.asset_type == "essay":
        prompt = ESSAY_GENERATOR.format(context=context, count=payload.count)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown asset type: {payload.asset_type}")

    ai_result = await route_ai(prompt, task_type="fast", db=db)

    content = None
    try:
        content = _json.loads(ai_result["response"])
    except Exception:
        logger.error("Asset generator returned non-JSON: %s", ai_result["response"][:200])
        raise HTTPException(status_code=502, detail="AI returned invalid format. Try again.")

    asset = StudyAsset(
        material_id=payload.material_id,
        asset_type=payload.asset_type,
        content_json=_json.dumps(content),
        points_to_unlock=UNLOCK_POINTS_COST,
    )
    db.add(asset)
    await db.commit()
    await db.refresh(asset)

    return GenerateAssetResponse(assets=[content])


# ── POST /study/chat (streaming) ────────────────────────────────────


@router.post("/chat")
async def chat_study(
    payload: ChatRequest,
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

    system_prompt = CHAT_TUTOR_SYSTEM.format(context=context or "No structured context available.")
    full_prompt = f"{system_prompt}\n\nStudent question: {payload.message}"

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
        user_result = await db.execute(
            select(User.points_balance).where(User.id == current_user.id)
        )
        balance = user_result.scalar_one() or 0

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

    elif payload.method == "ad":
        # Create a pending ad-gated transaction. The client must
        # request an ad token (POST /api/v1/ads/request-token), show
        # the rewarded ad, and the SSV callback will credit the user's
        # wallet. They then call this endpoint again with
        # method="points" to consume the newly-earned points. The
        # ad-credit flow is fully server-side — the client never
        # reports revenue.
        txn = StudyTransaction(
            user_id=current_user.id,
            asset_id=asset.id,
            method="ad",
            points_spent=0,
            reward_granted=False,
        )
        db.add(txn)
        await db.commit()
        await db.refresh(txn)

        return UnlockResponse(
            unlocked=False,
            content=None,
            new_balance=(await db.execute(
                select(User.points_balance).where(User.id == current_user.id)
            )).scalar_one() or 0,
            method="ad",
            points_spent=0,
        )

    raise HTTPException(status_code=400, detail="Invalid method")


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
    new_balance = current_user.points_balance

    if payload.score >= BONUS_THRESHOLD:
        bonus_points = BONUS_POINTS
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
        new_balance_result = await db.execute(
            select(User.points_balance).where(User.id == current_user.id)
        )
        new_balance = new_balance_result.scalar_one() or 0
        bonus_awarded = True

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
    
    return SessionEndResponse(
        session_id=payload.session_id,
        duration_seconds=session["duration_seconds"],
        ended_at=session["ended_at"].isoformat(),
    )
