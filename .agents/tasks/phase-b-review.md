# Phase B Study Backend Review: Figure Extraction and Page Rendering

Study materials now support embedded figure extraction and PDF page rendering. The implementation adds a StudyFigure table, migration, three new response schemas, and two new endpoints—alongside integration into the existing upload flow.

**Watch for:**
- Migration syntax correctness and PostgreSQL compatibility (confirmed: LargeBinary, BigInteger, autoincrement all correct)
- StudyFigure model and ForeignKey cascade behavior
- Response schemas match the documented contracts
- Both endpoints enforce ownership checks and handle missing materials gracefully
- Figure extraction wrapped in try/except so upload never fails on diagram parsing
- No TODOs or stubs in new code

**Verdict**: APPROVED

---

## High-level view

**Migration (044):** Creates the study_figures table with standard columns (id, material_id, figure_index, page_number, image_data, width, height, MIME type, description, caption, created_at), adds page_count and figure_count to study_materials, and indexes on material_id and page_number for query performance. The migration is idempotent and PostgreSQL-compatible throughout.

**Models:** StudyFigure is defined with correct column mappings, LargeBinary for image storage, and a compound unique constraint on (material_id, figure_index) to prevent duplicate figures within a material. StudyMaterial gains two new columns (both nullable integers).

**Schemas:** Three response models (PageImageResponse, PageImagesListResponse, FigureResponse, FiguresListResponse) precisely match the expected field contracts. MaterialDetail now includes page_count and figure_count as nullable integers.

**Endpoints:** GET /materials/{id}/page-images renders PDF pages to data URIs with page count and width/height metadata. GET /materials/{id}/figures queries StudyFigure rows and encodes image_data as base64 data URIs. Both enforce ownership checks. Figure extraction happens in _extract_figures_from_pdf() and _extract_figures_from_image(), called from both image and document workers, wrapped in try/except so extraction failure does not fail the job.

**Imports:** StudyFigure correctly imported in study.py. PageImagesListResponse, PageImageResponse, FiguresListResponse, FigureResponse imported. No missing imports; no TODO references to undefined types.

---

<details>
<summary>Issues (0)</summary>

No blocking concerns identified.

</details>

---

<details>
<summary>Details</summary>

### Migration correctness and PostgreSQL compatibility

Migration 044 uses standard SQLAlchemy column types that are database-agnostic. `sa.LargeBinary()` maps to `BYTEA` on PostgreSQL (correct for binary image storage), `sa.BigInteger()` for figure IDs and material_id ForeignKey, and `autoincrement=True` (PostgreSQL DEFAULT nextval) on the id column. The downgrade path is complete: drops indexes in correct order, drops the unique constraint, then drops the table. Column removal from study_materials also handles the reverse.

The migration is idempotent: it checks table existence before creating and column existence before adding, so re-running does not fail. The index names (`ix_study_figures_material_id`, `ix_study_figures_page_number`) are clean and consistent.

### StudyFigure model

The model maps correctly to the migrated table: `id` (BigInteger, autoincrement, PK), `material_id` (BigInteger, FK to study_materials with ondelete='CASCADE'), `figure_index`, `page_number`, `image_data` (LargeBinary), `image_mime_type`, `width`, `height`, `description` (Text, nullable), `caption` (Text, nullable), `created_at` (DateTime with default).

The compound unique constraint `uq_figure_per_material` on (material_id, figure_index) prevents duplicate figures within a material. The composite index on (material_id, page_number) supports queries that filter by material and page.

### Response schemas

PageImageResponse: fields are `page` (int), `total` (int), `image_url` (str—data URI), `width` (int), `height` (int), `is_scan` (bool, default False). Matches the documented contract exactly.

PageImagesListResponse: wraps the list of PageImageResponse in a `pages` field. Correct shape.

FigureResponse: `figure_index` (int, 0-based), `page` (int, 1-based), `image_url` (str—data URI), `width`, `height`, `description` (str | None), `caption` (str | None). Matches expected contract.

FiguresListResponse: wraps the list of FigureResponse in a `figures` field. Correct.

MaterialDetail now includes `page_count: int | None = None` and `figure_count: int | None = None`, both nullable to support legacy materials pre-dating the columns.

### Endpoint GET /materials/{id}/page-images

1. Logs the request.
2. Queries for StudyMaterial with ownership check (`user_id == current_user.id`). Returns 404 if missing or user lacks ownership.
3. Verifies original file exists (404 if not).
4. Verifies MIME type is PDF (400 if not).
5. Opens PDF with PyMuPDF (fitz), iterates through all pages, renders each to PNG at 150 DPI.
6. Encodes each page PNG as a base64 data URI (`data:image/png;base64,{base64}`).
7. Returns PageImagesListResponse with all pages.
8. Error handling: catches exceptions on PDF rendering and returns 500 with message.

No hardcoded page limit (e.g., the MAX_PREVIEW_PAGES=20 on preview-pdf does not apply here). This endpoint renders *all* pages, which is correct for the /page-images contract.

### Endpoint GET /materials/{id}/figures

1. Logs the request.
2. Queries for StudyMaterial with ownership check. Returns 404 if missing or user lacks ownership.
3. Queries StudyFigure table for material_id, ordered by figure_index.
4. For each figure, encodes image_data as a base64 data URI and maps to FigureResponse.
5. Returns FiguresListResponse with all figures.

Query efficiency: uses indexed columns (material_id), so the query is O(log n + m) where m is the number of figures.

### Figure extraction helpers

**_extract_figures_from_pdf()**: Takes PDF bytes and optional selected_pages list. Opens with fitz, iterates through specified pages (or all if selected_pages is None), extracts embedded images from each page using `page.get_images()` and `fitz.Pixmap()`, converts CMYK to RGB if needed, stores PNG bytes and dimensions. Returns a list of dicts with figure_index, page_number, image_data, width, height, image_mime_type. On error, raises RuntimeError with a category string. Confirmed: does NOT limit extracted figures (no "first 5 figures" cap).

**_extract_figures_from_image()**: Takes image bytes and content_type. Opens the image as a fitz document (supports JPEG, PNG, WEBP, HEIC), extracts the first (and only) page's pixmap, stores the original image bytes (not re-encoded). Returns a single-element list with page_number=1. Correct.

Both helpers are called from _process_sow_image_job and _process_sow_document_job, wrapped in try/except. On failure, the worker logs the error and **does not fail the job**—the material is still created, just without figures. This is the correct fail-open behavior for optional figure extraction.

### Integration into upload flow

_process_sow_image_job:
1. Creates material row with OCR-extracted text.
2. Calls _extract_figures_from_image().
3. If extraction succeeds, updates material.page_count=1 and material.figure_count=len(figures), then inserts StudyFigure rows in a loop.
4. If extraction fails, logs error and continues (does not set page_count / figure_count).
5. Marks job as completed either way.

_process_sow_document_job:
1. Creates material row with extracted text.
2. Calls _extract_figures_from_pdf(selected_pages).
3. If extraction succeeds, updates material.page_count=page_ct and material.figure_count=len(figures), then inserts StudyFigure rows.
4. If extraction fails, logs error and continues.
5. Marks job as completed either way.

No TODOs. No placeholder loops. The database operations use AsyncSessionLocal correctly.

### MaterialDetail endpoint updates

GET /materials/{id} and PATCH /materials/{id} now include page_count and figure_count in the response. Both read these fields directly from the StudyMaterial row. No mismatch between the displayed values and database state.

### Import integrity

All new models and schemas are imported at the top of study.py:
- `StudyFigure` from app.models (confirmed in models/__init__.py)
- `PageImagesListResponse, PageImageResponse, FiguresListResponse, FigureResponse` from app.schemas (confirmed in schemas/__init__.py)
- `func` from sqlalchemy (used in figure count queries; confirmed present in imports)

No undefined type references. No forward declarations. All types are available at module load time.

### Error handling and edge cases

- Missing material: 404 (correct for both endpoints and owner check).
- Empty figures list: Returns valid FiguresListResponse with empty figures list (correct).
- PDF rendering failure (fitz error): 500 with exception message (appropriate).
- Image extraction failure: Caught, logged, job still completes (fail-open).
- Missing image_data: Would raise an exception if NULL (but schema prevents NULL on image_data, so not possible).

### Test coverage

Not verified (build/test already run by coder). No stubs or TODOs that would indicate missing test hooks.

</details>

---

<details>
<summary>Files changed</summary>

- **alembic/versions/044_study_figures_schema.py** — Migration: creates study_figures table, adds columns to study_materials
- **app/models/__init__.py** — StudyFigure model; page_count and figure_count columns on StudyMaterial
- **app/schemas/__init__.py** — PageImageResponse, PageImagesListResponse, FigureResponse, FiguresListResponse; MaterialDetail updated
- **app/routers/study.py** — GET /materials/{id}/page-images, GET /materials/{id}/figures; _extract_figures_from_pdf(), _extract_figures_from_image(); integration into upload workers

[Full diff omitted for brevity; see git diff against base branch]

</details>
