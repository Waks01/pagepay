"""Page and figure extraction for uploaded study materials.

A student's upload is a *document*, not a wall of text. It contains
diagrams, graphs, circuits, tables, photographs and worked
illustrations, and the promise of the study screen is that nothing on
the page is lost.

Two kinds of artifact come out of an upload:

* **Pages** — a full-fidelity render of every page, written to object
  storage. The app shows these in the "Original" view so the student
  sees exactly what they uploaded, at any zoom, without downloading
  the source file.

* **Figures** — a crop of every diagram-like region on a page, plus a
  plain-language description of what that region shows. The crop is
  what the reader shows inline; the description is what the teaching
  layer explains and what the narration speaks.

Figures are found *deterministically*, not by asking a vision model for
bounding boxes. A PDF already knows where its own graphics are:

* vector graphics (charts, circuits, shapes, table borders) come from
  ``page.get_drawings()``;
* embedded photographs come from ``page.get_image_rects()``;
* prose comes from ``page.get_text("blocks")``.

A region that carries ink but no prose is a figure. Vision models are
good at *describing* a picture and bad at saying *where* it is, so
asking one for coordinates produces confident nonsense and wrong
crops. The geometry is read from the file instead.

Scanned PDFs and phone photos have no geometry — the whole page is one
raster image. There, Tesseract supplies the prose boxes so the ink
that is *not* prose can be isolated. When Tesseract is unavailable the
page is kept as a single whole figure: the student still sees the
diagram, because the page is shown next to it either way.

Nothing here is allowed to fail the upload. A material with no
extractable figures is still a valid material; the page render alone
is enough for the student to read what they sent.
"""

from __future__ import annotations

import io
import logging
from dataclasses import dataclass

from app.config import settings

logger = logging.getLogger("uvicorn.error")

# How close two drawings must be, in PDF points, before they are
# treated as parts of the same figure. A chart is drawn as dozens of
# separate paths (axes, bars, gridlines, labels) that never touch, so
# clustering has a generous tolerance.
_CLUSTER_GAP_PT = 8.0

# Below this, in page points, a region is a rule, an underline or a
# divider rather than a figure.
_MIN_FIGURE_SIDE_PT = 18.0


@dataclass
class PageArtifact:
    """One rendered page of an uploaded document."""

    page: int
    width: int
    height: int
    image_key: str | None = None
    image_url: str | None = None
    is_scan: bool = False


@dataclass
class FigureArtifact:
    """One diagram-like region cropped out of a page."""

    index: int
    page: int
    bbox: tuple[float, float, float, float]
    width: int
    height: int
    image_key: str | None = None
    image_url: str | None = None
    description: str = ""
    caption: str = ""
    # The crop itself, kept in memory only so the caller can have the
    # vision model describe it without re-rendering the page. Never
    # persisted — only the object-storage key is.
    image_bytes: bytes | None = None


# ── PDF geometry ──────────────────────────────────────────────────────


def _fitz():
    """Import PyMuPDF, or explain why it is missing."""
    try:
        import fitz
    except ImportError as exc:  # pragma: no cover - dependency missing
        raise RuntimeError("PDF renderer not available") from exc
    return fitz


def _cluster_rects(rects: list, gap: float) -> list:
    """Merge rectangles that overlap or sit within `gap` of each other.

    A single chart is a pile of paths that never touch: axes, bars,
    gridlines, the outline of the plot area. Clustering them into one
    region is what turns "37 separate drawings" into "one figure".

    The boxes are handled as plain `(x0, y0, x1, y1)` tuples on
    purpose. PyMuPDF's `Rect` treats a rectangle with no area as empty,
    and both `|` and `include_rect` silently refuse to merge one — so
    the arrows between the boxes of a flowchart, and the lines of a
    table grid, would be dropped and the figure would fall apart.
    """
    if not rects:
        return []
    if len(rects) == 1:
        return [(rects[0].x0, rects[0].y0, rects[0].x1, rects[0].y1)]

    boxes = [(r.x0, r.y0, r.x1, r.y1) for r in rects]
    parent = list(range(len(boxes)))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    def overlaps(a: tuple, b: tuple) -> bool:
        return (
            a[0] <= b[2]
            and b[0] <= a[2]
            and a[1] <= b[3]
            and b[1] <= a[3]
        )

    # Compare only rectangles that could plausibly touch. Sorting by
    # x0 and breaking out early keeps a page with hundreds of paths
    # from turning into an O(n^2) scan.
    order = sorted(range(len(boxes)), key=lambda i: boxes[i][0])
    for oi in range(len(order)):
        i = order[oi]
        bi = boxes[i]
        gi = (bi[0] - gap, bi[1] - gap, bi[2] + gap, bi[3] + gap)
        for oj in range(oi + 1, len(order)):
            j = order[oj]
            if boxes[j][0] > gi[2]:
                break
            bj = boxes[j]
            gj = (bj[0] - gap, bj[1] - gap, bj[2] + gap, bj[3] + gap)
            if overlaps(gi, gj):
                union(i, j)

    groups: dict[int, list] = {}
    for i in range(len(boxes)):
        groups.setdefault(find(i), []).append(i)

    merged = []
    for members in groups.values():
        x0 = min(boxes[m][0] for m in members)
        y0 = min(boxes[m][1] for m in members)
        x1 = max(boxes[m][2] for m in members)
        y1 = max(boxes[m][3] for m in members)
        merged.append((x0, y0, x1, y1))
    return merged


def page_has_prose(page) -> bool:
    """True when the page carries a text layer.

    A page without one is a scan (or a photo of a page): there is no
    geometry to read, only pixels.
    """
    try:
        text = page.get_text("text") or ""
    except Exception:
        return False
    return len(text.strip()) > 20


def find_figure_regions(page) -> list:
    """Find the diagram-like regions of a page, in PDF point space.

    Returns a list of `fitz.Rect`. Only meaningful for a page that has
    a text layer — a scanned page needs the Tesseract path instead.
    """
    fitz = _fitz()
    page_rect = page.rect
    page_area = abs(page_rect.width * page_rect.height)
    if page_area <= 0:
        return []

    graphic_rects: list = []

    try:
        for drawing in page.get_drawings():
            rect = fitz.Rect(drawing["rect"])
            # `Rect.is_empty` is true when either side has no length, so
            # it throws away every horizontal rule and every vertical
            # one — which is exactly the ink that ties a flowchart's
            # boxes together and a table's grid together. Validity is
            # checked instead, and the zero-area rects are kept: the
            # area and side-length filters below judge them.
            if not rect.is_valid or rect.is_infinite:
                continue
            if rect.width < 0 or rect.height < 0:
                continue
            graphic_rects.append(rect)
    except Exception as exc:
        logger.warning("[artifacts] get_drawings failed: %s", exc)

    try:
        for image in page.get_images(full=True):
            xref = image[0]
            try:
                for rect in page.get_image_rects(xref):
                    r = fitz.Rect(rect)
                    if r.is_valid and not r.is_infinite:
                        graphic_rects.append(r)
            except Exception:
                continue
    except Exception as exc:
        logger.warning("[artifacts] get_images failed: %s", exc)

    if not graphic_rects:
        return []

    regions = []
    for x0, y0, x1, y1 in _cluster_rects(graphic_rects, _CLUSTER_GAP_PT):
        width = x1 - x0
        height = y1 - y0
        area_ratio = abs(width * height) / page_area
        if area_ratio < settings.study_figure_min_area_ratio:
            continue
        if area_ratio > settings.study_figure_max_area_ratio:
            # A page border, a watermark frame, a background fill.
            continue
        if width < _MIN_FIGURE_SIDE_PT or height < _MIN_FIGURE_SIDE_PT:
            continue
        regions.append((x0, y0, x1, y1))

    regions.sort(key=lambda r: (round(r[1], 1), round(r[0], 1)))
    return regions


# ── Scanned pages ─────────────────────────────────────────────────────


def _dilate(mask, radius: int = 2):
    """Grow a boolean mask outwards by `radius` pixels (4-neighbour)."""
    import numpy as np

    out = mask.copy()
    for _ in range(radius):
        grown = out.copy()
        grown[1:, :] |= out[:-1, :]
        grown[:-1, :] |= out[1:, :]
        grown[:, 1:] |= out[:, :-1]
        grown[:, :-1] |= out[:, 1:]
        out = grown
    return out


def _runs_where(active) -> list[tuple[int, int]]:
    """Contiguous [start, end) runs of True in a boolean array."""
    runs = []
    start = None
    for i, flag in enumerate(active):
        if flag and start is None:
            start = i
        elif not flag and start is not None:
            runs.append((start, i))
            start = None
    if start is not None:
        runs.append((start, len(active)))
    return runs


def find_scan_figure_regions(png_bytes: bytes, width: int, height: int) -> list:
    """Separate figures from prose on a scanned page.

    Tesseract supplies the boxes of the words on the page. Everything
    that is ink but not inside a word box is a drawing, a table, a
    photograph or a diagram. Those leftovers are then grouped by
    horizontal bands so that a diagram sitting beside a column of prose
    is cropped on its own, not across the whole page.

    Returns a list of `(x0, y0, x1, y1)` in *pixel* space. An empty
    list means Tesseract was unavailable or the page held nothing but
    prose, and the caller should keep the whole page as one figure.
    """
    try:
        import numpy as np
        import pytesseract
        from PIL import Image
    except ImportError as exc:
        logger.info("[artifacts] scan separation unavailable: %s", exc)
        return []

    if not settings.tesseract_enabled:
        return []

    try:
        with Image.open(io.BytesIO(png_bytes)) as image:
            image = image.convert("L")
            data = pytesseract.image_to_data(
                image, output_type=pytesseract.Output.DICT
            )
    except Exception as exc:
        logger.info("[artifacts] tesseract failed: %s", exc)
        return []

    words = []
    count = len(data.get("text", []))
    for i in range(count):
        try:
            if int(float(data["conf"][i])) < 30:
                continue
        except (TypeError, ValueError):
            continue
        text = (data["text"][i] or "").strip()
        if not text:
            continue
        left = int(data["left"][i])
        top = int(data["top"][i])
        w = int(data["width"][i])
        h = int(data["height"][i])
        if w <= 0 or h <= 0:
            continue
        words.append((left, top, left + w, top + h))
    if not words:
        return []

    gray = np.asarray(image, dtype=np.uint8)
    ink = gray < 150

    text_mask = np.zeros_like(ink)
    for x0, y0, x1, y1 in words:
        text_mask[max(0, y0 - 2) : y1 + 2, max(0, x0 - 2) : x1 + 2] = True
    text_mask = _dilate(text_mask, radius=3)

    drawing_ink = ink & ~text_mask
    if not drawing_ink.any():
        return []

    row_counts = drawing_ink.sum(axis=1)
    row_threshold = max(3, int(width * 0.002))
    active_rows = row_counts > row_threshold
    bands = _runs_where(active_rows)
    if not bands:
        return []

    # Merge bands separated by a small gap: one diagram interrupted by
    # a caption line is still one figure.
    gap = max(4, int(height * 0.02))
    merged_bands: list[list[int]] = []
    for start, end in bands:
        if merged_bands and start - merged_bands[-1][1] <= gap:
            merged_bands[-1][1] = end
        else:
            merged_bands.append([start, end])

    regions = []
    for top, bottom in merged_bands:
        band = drawing_ink[top:bottom]
        col_counts = band.sum(axis=0)
        col_threshold = max(2, int((bottom - top) * 0.02))
        active_cols = col_counts > col_threshold
        col_runs = _runs_where(active_cols)
        if not col_runs:
            continue
        left = col_runs[0][0]
        right = col_runs[-1][1]
        if right - left < _MIN_FIGURE_SIDE_PT or bottom - top < _MIN_FIGURE_SIDE_PT:
            continue
        regions.append((left, top, right, bottom))

    page_area = float(width * height)
    kept = []
    for x0, y0, x1, y1 in regions:
        area_ratio = ((x1 - x0) * (y1 - y0)) / page_area
        if area_ratio < settings.study_figure_min_area_ratio:
            continue
        if area_ratio > settings.study_figure_max_area_ratio:
            continue
        kept.append((x0, y0, x1, y1))
    return kept


# ── Rendering ─────────────────────────────────────────────────────────


def render_page_jpeg(page, target_width: int, quality: int) -> tuple[bytes, int, int]:
    """Render one page to JPEG at roughly `target_width` pixels wide."""
    fitz = _fitz()
    width = max(1, int(page.rect.width))
    height = max(1, int(page.rect.height))
    zoom = target_width / width
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
    data = pix.tobytes("jpeg", jpg_quality=quality)
    return data, pix.width, pix.height


def crop_region_png(page, bbox: tuple[float, float, float, float], zoom: float) -> tuple[bytes, int, int]:
    """Crop a region out of a page and return it as PNG bytes."""
    fitz = _fitz()
    rect = fitz.Rect(bbox)
    pad = settings.study_figure_padding * min(page.rect.width, page.rect.height)
    rect = fitz.Rect(
        max(page.rect.x0, rect.x0 - pad),
        max(page.rect.y0, rect.y0 - pad),
        min(page.rect.x1, rect.x1 + pad),
        min(page.rect.y1, rect.y1 + pad),
    )
    if rect.width <= 1 or rect.height <= 1:
        return b"", 0, 0
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=rect)
    return pix.tobytes("png"), pix.width, pix.height


# ── Storage ───────────────────────────────────────────────────────────


def upload_object(key: str, data: bytes, content_type: str) -> str | None:
    """Write bytes to object storage. Returns the key, or None on failure.

    Storage is a convenience, not a requirement: when the bucket is not
    reachable the material still works, the app just falls back to
    rendering pages from the source file on demand.
    """
    return _upload(key, data, content_type)


def object_url(key: str | None) -> str | None:
    """A URL for a stored object, or None."""
    return _url_for(key)


def _upload(key: str, data: bytes, content_type: str) -> str | None:
    if not data:
        return None
    try:
        from app.services import r2_storage

        if not r2_storage.is_configured():
            return None
        r2_storage.upload_bytes(key, data, content_type=content_type)
        return key
    except Exception as exc:
        logger.warning("[artifacts] upload failed key=%s: %s", key, exc)
        return None


def _url_for(key: str | None) -> str | None:
    if not key:
        return None
    try:
        from app.services import r2_storage

        return r2_storage.audio_url_for(key)
    except Exception as exc:
        logger.warning("[artifacts] url failed key=%s: %s", key, exc)
        return None


# ── Public entry points ───────────────────────────────────────────────


def build_page_artifacts(
    contents: bytes,
    *,
    key_prefix: str,
    max_pages: int = 20,
) -> list[PageArtifact]:
    """Render every page of a PDF and store it.

    `key_prefix` namespaces the objects — the upload job id is used, so
    a retried upload never overwrites a previous material's pages.
    """
    fitz = _fitz()
    artifacts: list[PageArtifact] = []
    try:
        pdf = fitz.open(stream=contents, filetype="pdf")
    except Exception as exc:
        logger.warning("[artifacts] cannot open PDF: %s", exc)
        return artifacts

    try:
        total = len(pdf)
        for number in range(1, min(total, max_pages) + 1):
            page = pdf[number - 1]
            data, width, height = render_page_jpeg(
                page,
                settings.study_page_render_width,
                settings.study_page_jpeg_quality,
            )
            key = f"{settings.cloudflare_r2_pages_prefix}/{key_prefix}/{number}.jpg"
            stored = _upload(key, data, "image/jpeg")
            artifacts.append(
                PageArtifact(
                    page=number,
                    width=width,
                    height=height,
                    image_key=stored,
                    image_url=_url_for(stored),
                    is_scan=not page_has_prose(page),
                )
            )
    except Exception as exc:
        logger.exception("[artifacts] page rendering failed: %s", exc)
    finally:
        try:
            pdf.close()
        except Exception:
            pass
    return artifacts


def build_image_artifacts(
    contents: bytes,
    *,
    key_prefix: str,
    content_type: str = "image/jpeg",
) -> list[PageArtifact]:
    """Store an uploaded image as the single page of its material.

    A photo of a textbook page is the page. There is no geometry to
    read a figure out of, so the image itself is kept at full fidelity
    and shown next to the explanation.
    """
    if not contents:
        return []
    # The extension and the content type are decided by the bytes, not
    # by what the client claimed — the phone's picker labels every
    # unknown image as JPEG.
    if contents[:8] == b"\x89PNG\r\n\x1a\n":
        extension, real_type = "png", "image/png"
    elif contents[:3] == b"\xff\xd8\xff":
        extension, real_type = "jpg", "image/jpeg"
    elif contents[:4] == b"RIFF" and contents[8:12] == b"WEBP":
        extension, real_type = "webp", "image/webp"
    else:
        extension, real_type = "jpg", content_type or "image/jpeg"

    key = f"{settings.cloudflare_r2_pages_prefix}/{key_prefix}/1.{extension}"
    stored = _upload(key, contents, real_type)
    return [
        PageArtifact(
            page=1,
            width=0,
            height=0,
            image_key=stored,
            image_url=_url_for(stored),
            is_scan=True,
        )
    ]


def extract_docx_text_and_images(contents: bytes) -> tuple[str, list[bytes]]:
    """Read a Word document: its prose, its tables, and its pictures.

    A `.docx` is a zip of XML, and the pictures inside it are ordinary
    files hanging off the document's relationships. `python-docx` reads
    the prose, and the images come out of the relationships.

    Taking only the paragraph text, as this did before, threw away
    every diagram in the document — and a Word document is a
    *document*, with the same promise as a PDF: nothing on the page is
    lost.

    Returns the text (with a `[TABLE: ...]` block for each table) and
    the pictures in the order they appear.
    """
    import io

    try:
        import docx
        from docx.oxml.ns import qn
        from docx.table import Table
        from docx.text.paragraph import Paragraph
    except ImportError as exc:  # pragma: no cover - dependency missing
        raise RuntimeError("python-docx is not installed") from exc

    document = docx.Document(io.BytesIO(contents))

    parts: list[str] = []
    images: list[bytes] = []

    def paragraph_images(element) -> list[bytes]:
        found: list[bytes] = []
        for blip in element.iter(qn("a:blip")):
            rid = blip.get(qn("r:embed"))
            if not rid:
                continue
            try:
                part = document.part.related_parts[rid]
            except KeyError:
                continue
            try:
                found.append(part.blob)
            except Exception:
                continue
        return found

    for child in document.element.body.iterchildren():
        if child.tag == qn("w:p"):
            paragraph = Paragraph(child, document)
            text = (paragraph.text or "").strip()
            if text:
                parts.append(text)
            images.extend(paragraph_images(child))
        elif child.tag == qn("w:tbl"):
            table = Table(child, document)
            headers = [cell.text.strip() for cell in table.rows[0].cells] if table.rows else []
            rows = []
            for row in table.rows:
                cells = [cell.text.strip() for cell in row.cells]
                rows.append(" | ".join(cells))
            if headers or rows:
                parts.append(
                    "[TABLE: " + " | ".join(headers) + "]\n" + "\n".join(rows)
                )

    return "\n\n".join(parts), images


def build_figure_artifacts(
    contents: bytes,
    *,
    key_prefix: str,
    max_pages: int = 20,
    max_figures: int = 40,
) -> list[FigureArtifact]:
    """Crop every figure out of a PDF and store it.

    A page with a text layer gives its geometry up directly. A scanned
    page is separated with Tesseract; if that is not possible the whole
    page is kept as one figure, so the student still sees it.
    """
    fitz = _fitz()
    artifacts: list[FigureArtifact] = []
    try:
        pdf = fitz.open(stream=contents, filetype="pdf")
    except Exception as exc:
        logger.warning("[artifacts] cannot open PDF for figures: %s", exc)
        return artifacts

    try:
        total = len(pdf)
        for number in range(1, min(total, max_pages) + 1):
            if len(artifacts) >= max_figures:
                break
            page = pdf[number - 1]
            zoom = settings.study_page_render_width / max(page.rect.width, 1)

            regions: list[tuple[float, float, float, float]] = []
            if page_has_prose(page):
                regions.extend(find_figure_regions(page))
            else:
                detect_width = 1200
                detect_zoom = detect_width / max(page.rect.width, 1)
                detect_pix = page.get_pixmap(
                    matrix=fitz.Matrix(detect_zoom, detect_zoom)
                )
                detect_png = detect_pix.tobytes("png")
                scale = detect_width / max(page.rect.width, 1)
                pixel_regions = find_scan_figure_regions(
                    detect_png, detect_pix.width, detect_pix.height
                )
                for x0, y0, x1, y1 in pixel_regions:
                    regions.append(
                        (x0 * scale, y0 * scale, x1 * scale, y1 * scale)
                    )
                if not regions:
                    # A scan whose ink could not be separated from its
                    # prose still holds a picture. Keeping the whole
                    # page as one figure means the student sees it, and
                    # the description of the page covers it.
                    regions.append(
                        (
                            page.rect.x0,
                            page.rect.y0,
                            page.rect.x1,
                            page.rect.y1,
                        )
                    )

            for x0, y0, x1, y1 in regions:
                if len(artifacts) >= max_figures:
                    break
                data, width, height = crop_region_png(page, (x0, y0, x1, y1), zoom)
                if not data:
                    continue
                index = len(artifacts) + 1
                key = f"{settings.cloudflare_r2_figures_prefix}/{key_prefix}/{index}.png"
                stored = _upload(key, data, "image/png")
                artifacts.append(
                    FigureArtifact(
                        index=index,
                        page=number,
                        bbox=(round(x0, 2), round(y0, 2), round(x1, 2), round(y1, 2)),
                        width=width,
                        height=height,
                        image_key=stored,
                        image_url=_url_for(stored),
                        image_bytes=data,
                    )
                )
    except Exception as exc:
        logger.exception("[artifacts] figure extraction failed: %s", exc)
    finally:
        try:
            pdf.close()
        except Exception:
            pass
    return artifacts
