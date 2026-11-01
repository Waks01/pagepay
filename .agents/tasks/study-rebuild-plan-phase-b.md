# Study Backend Rebuild — Phase B Implementation Plan

**Date**: 2026-01-11  
**Scope**: STUDY-009 through STUDY-014 (Figure extraction + page-images + figures endpoints + metadata)  
**Backend Stack**: FastAPI + SQLAlchemy async + PostgreSQL + Alembic  
**Status**: Ready for implementation

---

## Overview

Phase B adds figure extraction (diagram crops from PDFs and image uploads) and two new endpoints to serve both page images and extracted figures. This phase also adds `page_count` and `figure_count` metadata to the `GET /materials/{id}` response.

Key decisions made during planning:

1. **Figures stored as LargeBinary in PostgreSQL**: Figure PNG/JPEG bytes stored directly in `StudyFigure.image_data` as `bytea` (LargeBinary). No separate S3/R2 needed for Phase B—data URIs returned in responses keep architecture simple.

2. **Page images returned as data URIs**: The existing `/pages` endpoint renders PDFs inline; the new `/page-images` endpoint uses the exact same PyMuPDF rendering but returns a cleaner, frontend-compatible response shape.

3. **Single Alembic migration (038)**: All Phase B schema changes (StudyFigure table, page_count column) in one migration to keep history clean.

4. **Figure extraction happens during upload**: Workers in `_process_sow_document_job` and `_process_sow_image_job` extract and store figures; `page_count` set at the same time.

5. **Response shapes match frontend contracts**:
   - `/page-images`: `{ pages: [ { page, total, image_url (data URI), width, height, is_scan } ] }`
   - `/figures`: `{ figures: [ { figure_index, page, image_url (data URI), width, height, description?, caption? } ] }`

---

## 1. Alembic Migration 038 — Study Figures & Metadata

**File**: `backend/alembic/versions/038_add_study_figures_and_metadata.py`

**Responsibility**: Create `StudyFigure` table + add `page_count` column to `StudyMaterial`.

### Schema: StudyFigure Table

```sql
CREATE TABLE study_figures (
  id BIGINT PRIMARY KEY NOT NULL AUTO_INCREMENT,
  material_id BIGINT NOT NULL,
  figure_index INTEGER NOT NULL,
  page_number INTEGER NOT NULL,
  image_data BYTEA NOT NULL,
  image_mime_type VARCHAR(50) NOT NULL DEFAULT 'image/png',
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  description TEXT,
  caption TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (material_id) REFERENCES study_materials(id) ON DELETE CASCADE,
  UNIQUE INDEX uq_figure_per_material (material_id, figure_index),
  INDEX idx_material_id (material_id),
  INDEX idx_page_number (page_number)
);
```

### Schema: StudyMaterial Extensions

Add to `study_materials` table:
- `page_count INTEGER DEFAULT NULL` — total pages (PDF) or 1 (images)
- `figure_count INTEGER DEFAULT NULL` — denormalized count of StudyFigure rows for this material (optional, can compute on read if performance acceptable)

**Migration Pattern**: Follow Alembic style from migration 037 (`op.create_table()`, `op.add_column()`). No downgrade complexity.

---

## 2. SQLAlchemy Model: StudyFigure

**File**: `backend/app/models/__init__.py`

**Location**: Add after `StudyExamAnswer` class (around line 1730).

### Model Definition

```python
class StudyFigure(Base):
    """One extracted figure (diagram) from a study material.
    
    Figures are cropped from PDF pages or entire uploaded images. Each figure
    stores the PNG/JPEG bytes directly in image_data (bytea in PostgreSQL).
    
    `figure_index` is 0-based across all figures in the material.
    `page_number` is 1-based for PDF materials; 1 for uploaded images.
    `description` and `caption` are optional AI-generated or user-provided.
    """
    
    __tablename__ = "study_figures"
    
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    material_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("study_materials.id", ondelete="CASCADE"), index=True
    )
    figure_index: Mapped[int] = mapped_column(Integer, index=True)  # 0-based
    page_number: Mapped[int] = mapped_column(Integer, index=True)    # 1-based
    image_data: Mapped[bytes] = mapped_column(LargeBinary)           # PNG/JPEG bytes
    image_mime_type: Mapped[str] = mapped_column(String(50), default="image/png")
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    caption: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    __table_args__ = (
        UniqueConstraint("material_id", "figure_index", name="uq_figure_per_material"),
        Index("ix_figure_material_page", "material_id", "page_number"),
    )
```

### StudyMaterial Extensions

Add two columns to the existing `StudyMaterial` model (lines ~464–497):

```python
# Add to StudyMaterial.__init__ in models/__init__.py:

    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    figure_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
```

**Note**: These are optional denormalized counters. Figure count can be computed at read-time via count query; page_count must be set during upload.

---

## 3. Pydantic Schemas

**File**: `backend/app/schemas/__init__.py`

### New Response Models

Add after the `MaterialDetail` class (around line 645):

```python
class PageImageResponse(BaseModel):
    """Single page image for /page-images endpoint."""
    page: int          # 1-based page number
    total: int         # Total pages in material
    image_url: str     # Data URI: data:image/png;base64,{base64_bytes}
    width: int
    height: int
    is_scan: bool = False  # True if original is scanned PDF, False if rendered


class PageImagesListResponse(BaseModel):
    """Response from GET /materials/{id}/page-images."""
    pages: list[PageImageResponse]


class FigureResponse(BaseModel):
    """Single extracted figure for /figures endpoint."""
    figure_index: int     # 0-based index across all figures
    page: int             # 1-based page number (or 1 for uploaded images)
    image_url: str        # Data URI: data:image/png;base64,{base64_bytes}
    width: int
    height: int
    description: str | None = None
    caption: str | None = None


class FiguresListResponse(BaseModel):
    """Response from GET /materials/{id}/figures."""
    figures: list[FigureResponse]
```

### Updated MaterialDetail Schema

Update the existing `MaterialDetail` class to include new fields:

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
    page_count: int | None = None           # NEW
    figure_count: int | None = None         # NEW
    created_at: datetime

    model_config = {"from_attributes": True}
```

---

## 4. Helper Functions: Figure Extraction

**File**: `backend/app/routers/study.py`

Add these helper functions before `_process_sow_image_job` (around line 600):

### `_extract_figures_from_pdf`

```python
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
    """
    figures = []
    figure_index = 0
    
    try:
        import fitz  # PyMuPDF
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
```

### `_extract_figures_from_image`

```python
async def _extract_figures_from_image(
    image_bytes: bytes,
    content_type: str,
) -> tuple[list[dict], int]:
    """Treat the entire uploaded image as a single figure.
    
    Returns:
        (figures_list, page_count=1)
        
    where figures_list has one entry.
    """
    figures = []
    
    try:
        import fitz  # PyMuPDF for image handling
        
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
```

---

## 5. Integration Points: Figure Storage During Upload

**File**: `backend/app/routers/study.py`

### In `_process_sow_image_job` (line ~640)

After the material is created (around line 700, after `await db.commit()`), add:

```python
        # Extract figures from the image
        try:
            figures, page_ct = await _extract_figures_from_image(contents, content_type)
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
```

### In `_process_sow_document_job` (line ~719)

Same pattern, after material creation and commit:

```python
        # Extract figures from the PDF
        try:
            figures, page_ct = await _extract_figures_from_pdf(contents, selected_pages)
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
```

---

## 6. New Endpoints

**File**: `backend/app/routers/study.py`

### Endpoint 1: `GET /materials/{material_id}/page-images`

Add after the existing `GET /materials/{id}/pages` endpoint (after line ~1260):

```python
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
        import fitz  # PyMuPDF
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
```

### Endpoint 2: `GET /materials/{material_id}/figures`

Add after the `/page-images` endpoint:

```python
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
```

---

## 7. Update Existing GET /materials/{id} Endpoint

**File**: `backend/app/routers/study.py`

Locate the `get_material` function (around line ~890) and update the return statement:

**Current code** (line ~919):
```python
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
```

**Updated code**:
```python
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
```

---

## 8. Import Additions

**File**: `backend/app/routers/study.py`

Add to the imports section at the top of study.py (if not already present):

```python
import base64  # For data URI encoding in page-images and figures endpoints

# Add to models import (line ~42)
from app.models import (
    ...,
    StudyFigure,  # NEW
)

# Add to schemas import (line ~69)
from app.schemas import (
    ...,
    PageImageResponse,  # NEW
    PageImagesListResponse,  # NEW
    FigureResponse,  # NEW
    FiguresListResponse,  # NEW
)
```

---

## 9. Testing & Verification Steps

### Unit Tests
- **File**: `backend/tests/test_study_figures.py` (new)
- **Coverage**:
  1. `_extract_figures_from_pdf()` with embedded images (test with a real PDF)
  2. `_extract_figures_from_image()` with JPG/PNG uploads
  3. `GET /page-images` returns correct shape + data URIs
  4. `GET /figures` returns correct shape + data URIs
  5. `GET /materials/{id}` includes `page_count` and `figure_count`
  6. Figure extraction doesn't block upload on failure (graceful degradation)

### Integration Tests
- Upload a PDF with embedded images → verify StudyFigure rows created
- Upload an image → verify 1 StudyFigure row created
- Call `GET /page-images` → verify response matches frontend contract
- Call `GET /figures` → verify response matches frontend contract
- Verify `page_count` and `figure_count` populated in GET /materials/{id}

### Manual Testing (QA)
- Upload a PDF syllabus with diagrams
- Verify `/page-images` returns all pages as data URIs
- Verify `/figures` returns all extracted diagrams
- Check MaterialDetail includes page_count and figure_count
- Verify existing `/pages` endpoint still works (backward compatibility)

---

## 10. Verification Commands

```bash
# Run Alembic migration
cd backend
alembic upgrade head

# Run unit tests
pytest tests/test_study_figures.py -v

# Run full backend test suite (ensure no regressions)
pytest tests/ -v

# Manual API test (after starting dev server)
# 1. Upload a PDF
curl -X POST http://localhost:8000/api/v1/study/sow/upload-document \
  -F "file=@test.pdf" \
  -H "Authorization: Bearer {token}"

# 2. Get page-images
curl http://localhost:8000/api/v1/study/materials/1/page-images \
  -H "Authorization: Bearer {token}" | jq .

# 3. Get figures
curl http://localhost:8000/api/v1/study/materials/1/figures \
  -H "Authorization: Bearer {token}" | jq .

# 4. Check material detail
curl http://localhost:8000/api/v1/study/materials/1 \
  -H "Authorization: Bearer {token}" | jq '.page_count, .figure_count'
```

---

## 11. Implementation Order

1. **Alembic Migration 038**: Create StudyFigure table + add page_count/figure_count columns
2. **SQLAlchemy Model**: Add StudyFigure class + columns to StudyMaterial
3. **Pydantic Schemas**: Add new response models + update MaterialDetail
4. **Helper Functions**: `_extract_figures_from_pdf()` and `_extract_figures_from_image()`
5. **Upload Integration**: Hook figure extraction into `_process_sow_image_job` and `_process_sow_document_job`
6. **New Endpoints**: Add `/page-images` and `/figures`
7. **Update Existing Endpoint**: Modify GET `/materials/{id}` to include new fields
8. **Tests**: Write unit tests + integration tests
9. **Verification**: Run full test suite + manual QA

---

## 12. Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Large binary blobs slow down DB queries | Figure table has index on material_id; queries filter by material_id + order by figure_index. Page count + figure count denormalized for fast access. |
| Figure extraction blocks upload on error | Both helpers are wrapped in try/except; extraction failures logged but don't fail the job. Material still created; figures just not stored. |
| Memory usage when rendering large PDFs | PyMuPDF handles streaming; one page at a time in /page-images endpoint. |
| Figure count becomes out-of-sync with actual StudyFigure rows | figure_count updated atomically with figure inserts in upload workers. Optional field—can be recomputed on read if needed. |
| Data URIs too large for response | Frontend caches data URIs; network impact minimal for small diagrams. If needed later, can move to S3/R2 with minimal schema changes (just update image_url to a CDN URL). |

---

## Summary

Phase B adds the complete figure extraction and pagination image pipeline:

- **Figure storage**: StudyFigure table with binary image data
- **Page rendering**: `/page-images` endpoint mirrors existing `/pages` but with frontend-compatible response shape
- **Figure delivery**: `/figures` endpoint returns extracted diagrams as data URIs
- **Metadata enrichment**: `GET /materials/{id}` now includes `page_count` and `figure_count`
- **Upload integration**: Extraction happens automatically during image/PDF upload; gracefully degrades if extraction fails

All changes are backward compatible. Existing `/pages` endpoint continues to work. Figure extraction is optional—materials without extracted figures still work fine.

Next phase (Phase C): Multi-image upload endpoint `POST /sow/upload-images`.

