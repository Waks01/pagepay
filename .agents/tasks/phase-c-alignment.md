# Phase C: Multi-Image Upload — Alignment Verification

## Frontend Contract vs Backend Implementation

| Contract item | Frontend expects | Backend implements | Match? |
|---|---|---|---|
| Endpoint path | `/api/v1/study/sow/upload-images` | `/sow/upload-images` (prefix `/study` added by router) | ✅ |
| HTTP method | POST | `@router.post("/sow/upload-images", ...)` | ✅ |
| FormData key for files | `files` (multi-value, repeated key) | `files: list[UploadFile] = File(...)` | ✅ |
| Optional exam_type | Form field str | `exam_type: str \| None = Form(default=None)` | ✅ |
| Optional education_level | Form field str | `education_level: str \| None = Form(default=None)` | ✅ |
| Response field job_id | string | `SowUploadJobAccepted(job_id=job.id, status="queued")` where `job.id` is `str(uuid.uuid4())` | ✅ |
| Response field status | "queued" | `SowUploadJobAccepted(job_id=job.id, status="queued")` — hardcoded "queued" | ✅ |
| HTTP status code | 202 | `@router.post(..., status_code=202)` | ✅ |
| Error format | `{detail: "..."}` | `raise HTTPException(status_code=..., detail="...")` — FastAPI format | ✅ |
| Polling endpoint | GET /sow/jobs/{job_id} | Already exists: `@router.get("/sow/jobs/{job_id}", ...)` | ✅ |

## Implementation Details

### Route Handler: `upload_sow_images()`
- **Location**: `backend/app/routers/study.py:284-401`
- **Status**: ✅ Implemented
- **Validation**:
  - Rejects 0 files: HTTP 400
  - Rejects >10 files: HTTP 413
  - Per-file content-type validation: HTTP 415 if not JPEG/PNG/WEBP/HEIC
  - Per-file size check: HTTP 413 if >5 MB
  - Empty file check: HTTP 400

### Background Worker: `_process_sow_multi_image_job()`
- **Location**: `backend/app/routers/study.py:1098-1283`
- **Status**: ✅ Implemented
- **Behavior**:
  - OCR each image sequentially via Gemini Vision
  - Merge all OCR outputs with format `[IMAGE {idx}: {name}]\n{text}`
  - Run SOW parser once on merged text
  - Create single `StudyMaterial` row with:
    - `page_count` = number of uploaded images
    - `education_level` = passed form field (nullable, stored on model)
    - `parsed_structure` = JSON from parser
    - `raw_input` = merged OCR text
    - `original_file_data` = first image only (logged explicitly)
  - Extract figures from all images with global figure indexing
  - On any error, mark job as "failed" with error message

### Model: `StudyMaterial`
- **Location**: `backend/app/models/__init__.py:479-490`
- **Status**: ✅ Updated
- **Changes**:
  - Added `education_level: Mapped[str | None] = mapped_column(String(50), nullable=True)` after `exam_type`

### Schema: `MaterialDetail`
- **Location**: `backend/app/schemas/__init__.py:646-661`
- **Status**: ✅ Updated
- **Changes**:
  - Added `education_level: str | None = None` after `exam_type`
  - Auto-populated from model via `model_config = {"from_attributes": True}`

### Alembic Migration
- **Location**: `backend/alembic/versions/001_add_education_level_to_study_material.py`
- **Status**: ✅ Created
- **Change**: Adds `education_level` column (String(50), nullable) to `study_materials` table

## Verification Checklist

- [x] `POST /sow/upload-images` route is registered with correct decorator
- [x] FormData accepts `files` (repeated key), `exam_type`, `education_level`
- [x] Response returns `{ job_id: string, status: "queued" }` with HTTP 202
- [x] Validation rejects 0 files (400), >10 files (413), oversized images (413), bad content-type (415)
- [x] `_process_sow_multi_image_job` function exists and is called via `asyncio.create_task`
- [x] Worker OCRs each image in sequence
- [x] Worker merges all OCR outputs
- [x] Worker runs SOW parser once on merged text
- [x] Worker creates `StudyMaterial` with `page_count = len(file_data_list)`
- [x] Worker stores `education_level` on material
- [x] Worker extracts figures with global indexing
- [x] `education_level` column added to `StudyMaterial` model
- [x] `education_level` field added to `MaterialDetail` schema
- [x] Migration file created for database schema
- [x] No TODO or stub code in implementation
- [x] Single-image `upload_sow_image` route unchanged

## Known Limitations (Documented in Plan)

1. **Original file storage**: Only first image stored in `original_file_data` — logged explicitly
2. **Sequential OCR**: All images must OCR successfully or entire job fails
3. **No per-image retry**: If one image fails, user must retry full upload
4. **`page_count` semantics**: Reflects number of uploaded images, not pages in document
5. **Figure extraction per image**: Each image can yield multiple figures; indices are global across all images

---

**Status**: All contract items match. Implementation is complete and ready for testing.
