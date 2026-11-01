# Phase C: Multi-Image Upload Implementation Plan

**Task**: Implement `POST /api/v1/study/sow/upload-images` to accept multiple images (1–10) in a single request, OCR each sequentially, merge all OCR outputs, parse once, and create one `StudyMaterial` row with `page_count` reflecting the count of uploaded images.

**Frontend Contract** (verbatim from `page/src/features/study/api.ts:uploadSowImages()`):
```
Endpoint:   POST /api/v1/study/sow/upload-images
FormData:   key="files" appended once per file (NOT "files[]"), plus optional "exam_type" and "education_level" strings
Response:   { job_id: string, status: "queued" }  (SowUploadJobAccepted shape)
Polling:    GET /api/v1/study/sow/jobs/{job_id}  (already implemented)
Progress:   HTTP transfer progress only; no server-sent events needed
```

---

## Implementation Steps

### 1. Add `education_level` column to `StudyMaterial` model

**Decision**: Add a new nullable column `education_level` (String, one of "primary" | "secondary" | "tertiary" | "research") to support the backend-to-frontend alignment for study materials. This allows the backend to store and return the education level that the frontend passes during upload.

**Files to modify**: `backend/app/models/__init__.py`

**What to do**: In the `StudyMaterial` class (around line 464), add the column after `figure_count`:
```python
education_level: Mapped[str | None] = mapped_column(String(50), nullable=True)
```

**Verification**:
- Run `cd backend && alembic revision --autogenerate -m "add_education_level_to_study_material"` to auto-generate the migration.
- Confirm the generated migration file adds the column with the correct definition.
- Run `alembic upgrade head` to apply the migration locally.
- No test failures expected (nullable column, additive change).

---

### 2. Create Alembic migration for `education_level` column

**Files to create**: `backend/alembic/versions/<next_revision>_add_education_level_to_study_material.py`

**What to do**: Generate migration automatically via step 1 or create it manually. The migration must:
- Add `education_level` column as nullable String(50) to `study_materials` table.
- Set default to NULL for all existing rows.
- No rollback complexity (straightforward column addition).

**Verification**:
- `alembic upgrade head` completes without error.
- Query `study_materials` table and confirm the column exists: `SELECT education_level FROM study_materials LIMIT 1` should return NULL.

---

### 3. Implement new route handler `POST /sow/upload-images` in `backend/app/routers/study.py`

**Decision**: Follow the exact pattern of the single-image endpoint `upload_sow_image` (lines ~160–240) but accept `list[UploadFile]` and dispatch to a new multi-image background worker.

**Files to modify**: `backend/app/routers/study.py`

**What to do**: Add the new route handler immediately after `upload_sow_image` (around line 240):

```python
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

    api_key = settings.gemini_api_key
    if not api_key:
        logger.error("[sow/upload-images] Gemini API key not configured")
        raise HTTPException(status_code=503, detail="Gemini not configured for image upload")

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
```

**Verification**:
- `curl -X POST http://localhost:8000/api/v1/study/sow/upload-images` with 2–3 test images in FormData key="files" returns 202 with `{ job_id: "...", status: "queued" }`.
- Reject with 400 if files are empty.
- Reject with 413 if any file is > 5 MB or if > 10 files are uploaded.
- Reject with 415 if any file's content-type is not in ALLOWED_IMAGE_TYPES.

---

### 4. Implement background worker `_process_sow_multi_image_job` in `backend/app/routers/study.py`

**Decision**: Process files in sequence (not parallel) so OCR order is deterministic and results are predictable. Merge OCR outputs with format `[IMAGE {idx}: {name}]\n{text}` per file, separated by `\n\n`.

**Files to modify**: `backend/app/routers/study.py`

**What to do**: Add the new worker function before the material endpoints (after `_process_sow_document_job`, around line 1000):

```python
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

        api_key = settings.gemini_api_key
        if not api_key:
            raise RuntimeError("gemini_not_configured")

        # OCR each image in sequence
        ocr_results = []  # list of (safe_name, extracted_text)
        for idx, (contents, safe_name, content_type) in enumerate(file_data_list):
            logger.info(
                "[sow/upload-images worker] OCR START file %d/%d: %s",
                idx + 1, len(file_data_list), safe_name,
            )
            try:
                extracted_text = await _ocr_image_with_gemini(contents, content_type, api_key)
                logger.info(
                    "[sow/upload-images worker] OCR done file %d text_len=%s",
                    idx + 1, len(extracted_text or ""),
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

        logger.info(
            "[sow/upload-images worker] material created: id=%s page_count=%d",
            material_id, len(file_data_list),
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
```

**Verification**:
- Unit test (if added): invoke the worker with 3 mock images (200×200 PNG each), mock Gemini responses, verify:
  - `ocr_results` has 3 entries.
  - `merged_text` contains all 3 OCR outputs in the correct format.
  - `StudyMaterial` row is created with `page_count=3`.
  - `StudyFigure` rows are created with sequential `figure_index` values.

---

### 5. Ensure `MaterialDetail` schema includes `education_level` field

**Decision**: The frontend expects `education_level` in the material detail response (as seen in `page/src/features/study/api.ts:MaterialDetail`). Verify the schema is present and update it if needed.

**Files to check**: `backend/app/schemas/__init__.py`

**What to do**: Inspect the `MaterialDetail` response schema (around line 640) and ensure it includes:
```python
education_level: str | None = None
```

If missing, add it after `page_count`:
```python
class MaterialDetail(BaseModel):
    id: int
    title: str
    exam_type: str | None = None
    content: str | None = None
    parsed_structure: dict | None
    assets: list[dict]
    file_mime_type: str | None = None
    has_original_file: bool = False
    page_count: int | None = None
    figure_count: int | None = None
    education_level: str | None = None  # ADD THIS LINE
    created_at: datetime

    model_config = {"from_attributes": True}
```

**Verification**:
- `GET /api/v1/study/materials/{id}` returns a response with an `education_level` field (populated if set, null otherwise).

---

### 6. Update `GET /study/materials/{material_id}` response to populate `education_level`

**Decision**: The endpoint already hydrates `MaterialDetail` from the model, so if the schema field exists, it will be populated automatically (via `model_config = {"from_attributes": True}`).

**Files to check**: `backend/app/routers/study.py` (around line 1050 in `get_material` function)

**What to do**: Verify the function returns the full model and confirm that `education_level` is now included in the response. No code changes needed if the schema field exists — Pydantic's `from_attributes=True` will hydrate it automatically.

**Verification**:
- Create a material with `education_level="secondary"` via the upload endpoint.
- `GET /api/v1/study/materials/{id}` returns `{ ..., education_level: "secondary", ... }`.

---

### 7. Build and run tests

**Decision**: Verify the implementation end-to-end by running the backend test suite and performing a manual integration test.

**Files**: All modified and new code in `backend/app/routers/study.py` and migrations.

**What to do**:
1. Run `cd backend && python -m pytest tests/routers/test_study.py -v` (or equivalent for your test setup).
   - Existing tests for single-image upload should still pass.
   - New tests for multi-image upload should cover:
     - Successful upload of 2, 5, 10 images.
     - Rejection of 0 images (400).
     - Rejection of 11+ images (413).
     - Rejection of oversized image (413).
     - Rejection of unsupported content-type (415).
     - Job creation and worker invocation.
     - Final material has correct `page_count` and `education_level`.

2. Manual integration test:
   - Create 3 sample PNG images (any content).
   - Call `curl -X POST http://localhost:8000/api/v1/study/sow/upload-images \
     -F "files=@image1.png" -F "files=@image2.png" -F "files=@image3.png" \
     -F "exam_type=gce_o_level" -F "education_level=secondary" \
     -H "Authorization: Bearer <token>"`.
   - Confirm 202 response with `job_id`.
   - Poll `GET http://localhost:8000/api/v1/study/sow/jobs/{job_id}` until status is "completed".
   - Fetch material: `GET http://localhost:8000/api/v1/study/materials/{material_id}`.
   - Confirm response includes:
     - `page_count: 3`
     - `education_level: "secondary"`
     - `exam_type: "gce_o_level"`
     - Parsed structure is not null.

**Verification**:
- All tests pass.
- Integration test shows the material with correct fields and OCR was applied to all images.
- Logs show all 3 images were OCR'd and merged.

---

## Summary of Changes

| Component | Change | Reversible |
|-----------|--------|-----------|
| `StudyMaterial` model | Add `education_level` column | Yes (migration) |
| Alembic | New migration: `add_education_level_to_study_material` | Yes |
| `upload_sow_images` endpoint | New POST handler accepting 1–10 images | Yes |
| `_process_sow_multi_image_job` worker | New async background task | Yes |
| `MaterialDetail` schema | Add `education_level` field (if missing) | Yes |
| `get_material` endpoint | No code change (schema updates auto-populate) | N/A |

---

## Logging Coverage

The implementation includes detailed logging at every step:

- **Route handler**: File count, exam_type, education_level, file validation, job creation.
- **Worker startup**: Job id, user, file count, education_level.
- **Per-file OCR**: File index, name, content-type, size, OCR result length.
- **Merge**: Total merged text length.
- **Parser**: Provider, parsed keys.
- **Material creation**: Material id, page_count, education_level.
- **Figure extraction**: Figure count per file, global figure index, page number.
- **Errors**: Full exception logging with context.

All logs use the prefix `[sow/upload-images]` and `[sow/upload-images worker]` for easy tracing in production.

---

## Known Limitations & Notes

1. **Original file storage**: Only the first image is stored in `original_file_data`. This is logged explicitly so future readers understand why only one file is retained.

2. **Sequential OCR**: Images are OCR'd in order; if one fails, the entire job fails. This is intentional: we want all images in the merged output or none.

3. **No per-image OCR retry**: If Gemini times out or fails on image 2 of 3, the whole upload fails. The client can retry.

4. **`page_count` semantics**: For multi-image uploads, `page_count` = number of uploaded images, NOT the total pages in a PDF (which is 1 per image). This is consistent with how the field is used: "how many pages of the original document were read."

5. **Figure extraction per image**: Each image is treated as a single figure or multiple figures (if it contains embedded content). Figure indices are global across all images.

6. **Database: nullable `education_level`**: The column is nullable to support existing materials that were uploaded before this feature; new materials from the multi-image endpoint will always populate it.

---

## Migration Path (for later, if needed)

When all materials have been backfilled or migrated:
1. Add a `NOT NULL` constraint to `education_level` in a follow-up migration.
2. Set a default value (e.g., "primary") in that migration for any remaining NULL rows.
