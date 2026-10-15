"""PDF page rendering: capped, thumbnail-sized, JPEG.

The preview used to render every page at 150 DPI as base64 PNG. A
20-page document came back as ~90 MB of JSON that the client decoded
into ~120 MB of bitmaps, which Android answers by killing the app —
the "app closed after I picked a PDF" report. These tests pin the
contract that replaced it.
"""

import base64

import pytest


def _make_pdf(page_count: int) -> bytes:
    import fitz

    pdf = fitz.open()
    for i in range(page_count):
        page = pdf.new_page()
        page.insert_text((72, 72), f"Page {i + 1} of a scheme of work")
    return pdf.tobytes()


def _page_sizes(pages: list[dict]) -> list[int]:
    return [len(p["image_base64"]) for p in pages]


@pytest.fixture
def render():
    # PyMuPDF is a backend dependency (requirements.txt), but it is not
    # installed in every local environment — the renderer is optional
    # there and these tests document its contract where it is present.
    pytest.importorskip("fitz", reason="PyMuPDF (fitz) is not installed")
    from app.routers.study import _render_pdf_pages

    return _render_pdf_pages


class TestPdfPageRendering:
    def test_small_pdf_returns_every_page(self, render):
        import fitz

        pdf = fitz.open(stream=_make_pdf(3), filetype="pdf")
        result = render(pdf)

        assert result["total"] == 3
        assert result["truncated"] is False
        assert [p["page"] for p in result["pages"]] == [1, 2, 3]

    def test_large_pdf_is_capped_and_flagged(self, render):
        import fitz

        pdf = fitz.open(stream=_make_pdf(30), filetype="pdf")
        result = render(pdf)

        assert result["total"] == 30
        assert result["truncated"] is True
        assert result["page_limit"] == 20
        assert len(result["pages"]) == 20
        assert result["pages"][-1]["page"] == 20

    def test_pages_are_thumbnail_sized_jpeg(self, render):
        import fitz

        pdf = fitz.open(stream=_make_pdf(2), filetype="pdf")
        result = render(pdf)
        page = result["pages"][0]

        # Thumbnail scale, not full resolution.
        assert page["width"] <= 900
        assert page["height"] <= 1300

        # JPEG magic bytes, not PNG — the prefix the client renders.
        raw = base64.b64decode(page["image_base64"])
        assert raw[:3] == b"\xff\xd8\xff"

        # Small enough that a full document stays a light payload.
        assert len(page["image_base64"]) < 400_000

    def test_payload_stays_small_for_a_long_document(self, render):
        """The regression this guards: a 20-page preview must stay a few
        MB, not the ~90 MB a full-resolution PNG set produced."""
        import fitz

        pdf = fitz.open(stream=_make_pdf(20), filetype="pdf")
        result = render(pdf)

        total_kb = sum(_page_sizes(result["pages"])) / 1024
        assert total_kb < 2048, f"preview payload too large: {total_kb:.0f} KB"

    def test_blank_pages_still_render(self, render):
        import fitz

        pdf = fitz.open()
        pdf.new_page()
        pdf.new_page()  # no text inserted at all
        result = render(pdf)

        assert len(result["pages"]) == 2
        assert all(p["image_base64"] for p in result["pages"])

    def test_custom_limit_is_honoured(self, render):
        import fitz

        pdf = fitz.open(stream=_make_pdf(10), filetype="pdf")
        result = render(pdf, max_pages=3)

        assert len(result["pages"]) == 3
        assert result["truncated"] is True
        assert result["page_limit"] == 3
