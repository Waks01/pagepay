# Phase C: Multi-Image Upload Implementation Review

**Verdict**: APPROVED

Implemented multi-image SOW upload with all frontend contract requirements met. The handler accepts 1–10 images via FormData, validates each file upfront (content-type, size), and dispatches a background worker that OCRs all images sequentially, merges the extracted text with image markers, runs the SOW parser once, and stores a single `StudyMaterial` row with `page_count` reflecting the image count. The `education_level` field is properly added to the model, schema, and database. No TODOs, no breaking changes to the single-image route, and error handling ensures every failure path marks the job as "failed" with a category string.

**Watch for**: Sequential OCR means if any image fails to extract (Gemini error, network timeout, etc.), the entire job fails and the user must retry all images. This is documented in the alignment checklist. Figure extraction failures are non-fatal and logged but don't mark the job failed. The first image is stored in `original_file_data` for export; the rest are extracted and stored as `StudyFigure` rows only.

---

## High-level view

The route handler validates files upfront: rejects empty uploads, >10 files, oversized images (>5 MB), and unsupported content-types (only JPEG/PNG/WEBP/HEIC). Each file's contents are read and validated before the job is created, so the client gets a fast HTTP 4xx response if anything is wrong. The background worker processes images sequentially, OCRs each to text via Gemini Vision, and merges all outputs with image markers (`[IMAGE 1: name]`, `[IMAGE 2: name]`, etc.). The merged text goes through the SOW parser once, avoiding duplicate AI calls and duplicate `StudyMaterial` rows. The model stores the education level as an optional field and sets `page_count` to the number of images. Figures are extracted from all images with global indexing so that figure 0 comes from image 1, figure 1 from image 1 or image 2, etc. Job status flows from "queued" → "processing" → "completed" or "failed", and the polling endpoint is unchanged. The single-image route remains untouched.

<details>
<summary>Issues (0)</summary>

No blocking concerns found.

</details>

<details>
<summary>Details</summary>

### Frontend Contract Match

The handler signature matches the frontend contract precisely. `files: list[UploadFile] = File(...)` captures the repeated FormData key "files". The optional fields `exam_type` and `education_level` are both Form parameters with `default=None`. The response schema `SowUploadJobAccepted` contains `job_id: str` and `status: "queued"`, and the decorator sets `status_code=202` so the HTTP response is correct. Error responses use FastAPI's standard `HTTPException(status_code=..., detail=...)` format. The polling endpoint `GET /sow/jobs/{job_id}` already exists and is unmodified.

### Input Validation — Eager and Comprehensive

The handler performs all validation synchronously before creating the job row. It rejects:
- Empty uploads (0 files): HTTP 400 with "At least one file is required"
- Oversized batches (>10 files): HTTP 413 with "Too many files (max 10)"
- Per-file size violations (>5 MB): HTTP 413 with file index and limit
- Per-file content-type violations (not in `ALLOWED_IMAGE_TYPES`): HTTP 415 with file index and rejected type
- Per-file empty contents: HTTP 400 with file index

Each file is read and checked individually in a loop before any job row is created. This ensures the client gets a fast, specific error response without waiting for a background worker to fail. The `ALLOWED_IMAGE_TYPES` set includes JPEG, PNG, WEBP, HEIC, HEIF — exactly the types Gemini Vision accepts. Content-type is extracted cleanly by splitting on `;` to drop charset parameters.

### Background Worker: Sequential OCR and Merge Strategy

The `_process_sow_multi_image_job` worker is dispatched via `asyncio.create_task(...)` and runs with its own `AsyncSessionLocal` session, so it does not compete with the request handler. The worker marks the job status as "processing" immediately, then OCRs each image in sequence via `_ocr_image_with_gemini(...)`.

Each OCR call sends the image as base64 to Gemini 2.5 Flash via the REST API. If any image fails (non-200 response, malformed JSON, timeout, etc.), the entire worker raises `RuntimeError("multi_image_ocr_failed")` and marks the job as "failed". This is documented in the alignment plan as a known limitation: one bad image fails the entire batch.

After all OCRs succeed, the extracted texts are merged into a single string with image markers: `[IMAGE 1: filename]\n{text1}\n\n[IMAGE 2: filename]\n{text2}`, etc. If all OCRs return empty or only whitespace, the merged text is empty; the worker detects this and raises `RuntimeError("multi_image_ocr_all_empty")`.

The merged text is then sent to `_run_sow_parser(...)`, which runs the SOW parser AI prompt once. The parser receives all image text in a single prompt, avoiding duplicate parsing and ensuring a single, cohesive `StudyMaterial` row. If parsing fails, the worker raises `RuntimeError("ai_parser_failed")` and marks the job as "failed".

### StudyMaterial Creation and Field Storage

Once parsing succeeds, the worker creates a single `StudyMaterial` row with:
- `user_id`: current user
- `title`: extracted from parsed structure, or "Untitled Material" fallback
- `exam_type`: passed form field (nullable)
- `education_level`: passed form field (nullable) — new field, stored here
- `raw_input`: merged OCR text (all images)
- `parsed_structure`: JSON from parser
- `original_file_data`: first image only (logged explicitly)
- `file_mime_type`: content-type of first image
- `ai_model_used`: provider from the parser result
- `page_count`: len(file_data_list) — the number of uploaded images

The `education_level` field is added to the `StudyMaterial` model as `Mapped[str | None] = mapped_column(String(50), nullable=True)`, and the alembic migration adds the column to the `study_materials` table with the same nullability. The `MaterialDetail` schema includes `education_level: str | None = None` and uses `model_config = {"from_attributes": True}` to auto-populate from the model.

### Figure Extraction

After material creation, the worker attempts to extract figures from all images via `_extract_figures_from_image(...)`. Figure extraction failures are logged but do not fail the job; the material is successfully created even if figures cannot be extracted.

Figures are indexed globally: if image 1 has 2 figures and image 2 has 1 figure, the indices are 0, 1, 2 respectively, and `page_number` reflects which image the figure came from (1-based per image). All figures are stored in the `StudyFigure` table with the material ID. The material's `figure_count` is set to the total number of extracted figures.

### Error Handling and Job Status Lifecycle

The worker wraps all work in a try-except that ensures every error path ends in `_mark_job_status(job_id, "failed", error=...)`. Specific error categories are used: `"gemini_not_configured"`, `"multi_image_ocr_failed"`, `"multi_image_ocr_all_empty"`, `"ai_parser_failed"`. These allow the client to display a user-friendly error message without exposing internals. If an unexpected exception escapes the inner try blocks, the outer exception handler logs it and marks the job as "failed" with the exception's `__class__.__name__` or stringified form.

Figure extraction failures do not call `_mark_job_status("failed", ...)` because figure extraction is best-effort; the material is already created and successful.

### No Breaking Changes

The single-image route `upload_sow_image` (POST `/sow/upload-image`, singular) is untouched. It continues to accept a single `file` parameter and dispatch `_process_sow_image_job` in the background. All existing functionality remains. The new route is `/sow/upload-images` (plural), a distinct path. The polling endpoint `GET /sow/jobs/{job_id}` is unchanged and works for both single-image and multi-image jobs.

### Migration

The alembic migration file adds the `education_level` column as `sa.Column('education_level', sa.String(50), nullable=True)` to `study_materials`. The revision metadata is minimal (`revision = '001'`, `down_revision = None`) but sufficient for a single-phase addition. The downgrade function correctly removes the column. The file is syntactically valid and alembic-compatible.

### No TODOs or Stubs

No TODO, FIXME, or stub markers found in the implementation. All code paths are complete.

</details>

---

## File Map

- **backend/app/routers/study.py**
  - New route: `upload_sow_images()` (lines 284–401) — accepts multi-image FormData, validates, creates job
  - New worker: `_process_sow_multi_image_job()` (lines 1098–1283) — OCRs images sequentially, merges, parses, stores material
  - Unchanged: `upload_sow_image()` (single-image route), `_process_sow_image_job()` (single-image worker)

- **backend/app/models/__init__.py**
  - Updated: `StudyMaterial` class, added `education_level: Mapped[str | None]` field (line 480)

- **backend/app/schemas/__init__.py**
  - Updated: `MaterialDetail` class, added `education_level: str | None = None` field (line 650)

- **backend/alembic/versions/001_add_education_level_to_study_material.py**
  - New migration: adds `education_level` column to `study_materials` table

See full diff by running `git diff main -- backend/app/routers/study.py backend/app/models/__init__.py backend/app/schemas/__init__.py backend/alembic/versions/001_add_education_level_to_study_material.py`.

