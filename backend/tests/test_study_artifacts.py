"""Page and figure extraction, and the teaching layer it feeds.

The promise the study screen makes is that nothing on a student's page
is lost. These tests cover the part that is easy to get quietly wrong:
finding the diagrams in a PDF, keeping the arrows and the table grid
that hold a figure together, and telling a scanned page apart from a
digital one.
"""
import pytest

import fitz

from app.services import page_artifacts
from app.services import study_narration
from app.routers import study as study_router


def _page_with_flowchart():
    """A page with prose, a three-box flowchart, a table and a rule."""
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)

    page.insert_text((60, 80), "Photosynthesis", fontsize=22, fontname="hebo")
    page.insert_textbox(
        fitz.Rect(60, 110, 535, 200),
        "Photosynthesis is the process by which green plants turn light "
        "energy into chemical energy, using chlorophyll in the leaves.",
        fontsize=11,
    )

    # The flowchart: three boxes joined by arrows.
    for index, (x0, label) in enumerate(
        [(80, "Light"), (250, "Chlorophyll"), (420, "Glucose")]
    ):
        rect = fitz.Rect(x0, 260, x0 + 110, 330)
        page.draw_rect(rect, color=(0.1, 0.3, 0.7), width=2)
        page.insert_text((x0 + 12, 300), label, fontsize=12, fontname="hebo")
        if index < 2:
            page.draw_line(
                fitz.Point(x0 + 110, 295),
                fitz.Point(x0 + 170, 295),
                color=(0.1, 0.3, 0.7),
                width=2,
            )

    # The table: a grid of lines with text in the cells.
    top = 400
    for row in range(4):
        page.draw_line(
            fitz.Point(60, top + row * 24),
            fitz.Point(340, top + row * 24),
            color=(0, 0, 0),
            width=1,
        )
    for col in range(3):
        page.draw_line(
            fitz.Point(60 + col * 93, top),
            fitz.Point(60 + col * 93, top + 72),
            color=(0, 0, 0),
            width=1,
        )
    page.insert_text((68, top + 16), "Stage", fontsize=10, fontname="hebo")
    page.insert_text((68, top + 40), "Light reaction", fontsize=10)

    # A decorative rule. Not a figure.
    page.draw_line(
        fitz.Point(60, 640), fitz.Point(535, 640), color=(0.6, 0.6, 0.6), width=1
    )
    return doc, page


class TestClustering:
    def test_zero_area_rects_merge(self):
        """A rule has no height. It must still be able to join a group.

        PyMuPDF treats a rectangle with no area as empty, and both
        `Rect | Rect` and `include_rect` silently refuse to merge one.
        The arrows between the boxes of a flowchart are exactly such
        rectangles, so dropping them would split one diagram into
        three.
        """
        fitz_rects = [
            fitz.Rect(0, 0, 100, 100),    # a box
            fitz.Rect(100, 50, 160, 50),  # the arrow leaving it
            fitz.Rect(120, 0, 120, 80),   # a vertical rule
        ]
        merged = page_artifacts._cluster_rects(fitz_rects, 8.0)
        assert len(merged) == 1, f"expected one group, got {merged}"
        x0, y0, x1, y1 = merged[0]
        assert x0 == 0 and y0 == 0
        assert x1 == 160 and y1 == 100

    def test_distant_rects_stay_apart(self):
        fitz_rects = [
            fitz.Rect(0, 0, 100, 100),
            fitz.Rect(400, 0, 500, 100),
        ]
        merged = page_artifacts._cluster_rects(fitz_rects, 8.0)
        assert len(merged) == 2


class TestFigureRegions:
    def test_flowchart_is_one_region(self):
        doc, page = _page_with_flowchart()
        try:
            regions = page_artifacts.find_figure_regions(page)
            diagram = [r for r in regions if r[1] > 200 and r[3] < 380]
            assert len(diagram) == 1, (
                f"the flowchart should be one region, got {len(diagram)}"
            )
            # The whole flow, from the first box to the last.
            assert diagram[0][0] < 100
            assert diagram[0][2] > 500
        finally:
            doc.close()

    def test_table_is_found(self):
        doc, page = _page_with_flowchart()
        try:
            regions = page_artifacts.find_figure_regions(page)
            table = [r for r in regions if r[1] > 380 and r[3] < 520]
            assert len(table) == 1, f"expected the table, got {table}"
        finally:
            doc.close()

    def test_decorative_rule_is_not_a_figure(self):
        doc, page = _page_with_flowchart()
        try:
            regions = page_artifacts.find_figure_regions(page)
            rules = [r for r in regions if r[1] > 600]
            assert not rules, f"a decorative rule was reported: {rules}"
        finally:
            doc.close()

    def test_crop_is_a_real_image(self):
        doc, page = _page_with_flowchart()
        try:
            region = page_artifacts.find_figure_regions(page)[0]
            data, width, height = page_artifacts.crop_region_png(page, region, 2.0)
            assert data, "the crop was empty"
            assert width > 0 and height > 0
            assert data[:8] == b"\x89PNG\r\n\x1a\n"
        finally:
            doc.close()

    def test_prose_page_is_not_a_scan(self):
        doc, page = _page_with_flowchart()
        try:
            assert page_artifacts.page_has_prose(page) is True
        finally:
            doc.close()

    def test_blank_page_reads_as_a_scan(self):
        doc = fitz.open()
        page = doc.new_page(width=595, height=842)
        try:
            assert page_artifacts.page_has_prose(page) is False
        finally:
            doc.close()


class TestGroundingAudit:
    """The lesson is checked against the material it was written from.

    A lesson that is wrong is worse than no lesson: the quiz is
    written against it and the narration speaks it.
    """

    SOURCE = (
        "y_max = 4ac - 6^2/4a = 4(1)5 - (6)^2/4(-1) = 14. "
        "y = ax^2 + bx + c. a = 1, b = 6, c = 5."
    )

    def test_a_correct_lesson_is_clean(self):
        from app.services import study_grounding

        lesson = {
            "blocks": [
                {"type": "body", "text": "The formula is y = ax^2 + bx + c."},
                {
                    "type": "calculation",
                    "label": "Example",
                    "steps": [
                        "Substitute a = 1, b = 6, c = 5",
                        "y_max = 4ac - 6^2 / 4a = 4(1)5 - (6)^2 / 4(-1)",
                        "y_max = 14",
                    ],
                },
            ]
        }
        audit = study_grounding.audit_explanation(lesson, self.SOURCE)
        assert audit["clean"] is True

    def test_a_wrong_answer_is_caught(self):
        from app.services import study_grounding

        lesson = {
            "blocks": [
                {
                    "type": "calculation",
                    "label": "Example",
                    "steps": [
                        "Substitute a = 1, b = 6, c = 5",
                        "y_max = 4ac - 6^2 / 4a = 4(1)5 - (6)^2 / 4(-1)",
                        "y_max = 15",
                    ],
                }
            ]
        }
        audit = study_grounding.audit_explanation(lesson, self.SOURCE)
        assert audit["unsupported_calculations"], "the wrong answer must be caught"

    def test_a_made_up_number_is_caught(self):
        from app.services import study_grounding

        lesson = {
            "blocks": [
                {"type": "body", "text": "The coefficient turns out to be 37."}
            ]
        }
        audit = study_grounding.audit_explanation(lesson, self.SOURCE)
        assert "37" in audit["unverified_numbers"]

    def test_a_figure_that_says_too_much_is_caught(self):
        from app.services import study_grounding

        figure_text = "Two graphs, one showing a parabola with a vertex marked."
        lesson = {
            "blocks": [
                {
                    "type": "figure",
                    "figure_index": 1,
                    "text": "A parabola with its vertex at (0, 2).",
                }
            ]
        }
        audit = study_grounding.audit_explanation(lesson, self.SOURCE, figure_text)
        assert audit["unsupported_figures"], "the overreach must be caught"

    def test_a_figure_inside_the_description_is_fine(self):
        from app.services import study_grounding

        figure_text = "A parabola with its vertex at (0, 2)."
        lesson = {
            "blocks": [
                {
                    "type": "figure",
                    "figure_index": 1,
                    "text": "A parabola with its vertex at (0, 2).",
                }
            ]
        }
        audit = study_grounding.audit_explanation(lesson, self.SOURCE, figure_text)
        assert audit["unsupported_figures"] == []

    def test_an_analogy_number_is_not_a_claim(self):
        """A tip may use a number of its own to make a point."""
        from app.services import study_grounding

        lesson = {
            "blocks": [
                {
                    "type": "tip",
                    "label": "Remember",
                    "text": "If you shared five apples between two friends...",
                }
            ]
        }
        audit = study_grounding.audit_explanation(lesson, self.SOURCE)
        assert audit["unverified_numbers"] == []

    def test_ocr_confusions_are_matched(self):
        """The material was read by a model, so 1 may be an l."""
        from app.services import study_grounding

        assert study_grounding.numbers_in("l4 apples") == {"14"}
        assert study_grounding.numbers_in("O5") == {"5"}

    def test_a_letter_is_not_a_digit(self):
        """'formula' has an o in it. That is not a zero."""
        from app.services import study_grounding

        assert study_grounding.numbers_in("The formula is y = ax^2 + bx + c.") == {"2"}

    def test_a_subtraction_is_not_a_negative(self):
        from app.services import study_grounding

        assert study_grounding.numbers_in("a-1") == {"1"}
        assert study_grounding.numbers_in("(-1, 2)") == {"-1", "2"}


class TestPlatformConfig:
    """The public config endpoint must not 500 because the database blinked.

    It is called on every app start, and its job is to hand the client
    its configuration. A slow or briefly unreachable database must not
    leave the app without it.
    """

    @pytest.mark.asyncio
    async def test_it_serves_the_rates(self, client):
        response = await client.get("/api/v1/config/platform")
        assert response.status_code == 200
        body = response.json()
        assert body["task_base_rates_kobo"]["youtube_subscribe"] == 15_000
        assert 0 < body["ad_revenue_platform_percent"] < 1

    @pytest.mark.asyncio
    async def test_a_failing_database_falls_back_to_the_defaults(
        self, client, monkeypatch
    ):
        from app.constants import task_rates
        from app.routers import config as config_router

        async def broken_db(_db):
            raise RuntimeError("the database is not answering")

        monkeypatch.setattr(task_rates, "get_task_rates_from_db", broken_db)

        response = await client.get("/api/v1/config/platform")
        assert response.status_code == 200
        assert response.json()["task_base_rates_kobo"]["youtube_subscribe"] == 15_000


class TestDocxExtraction:
    """A Word document is a document, not a wall of text.

    The .docx path used to read the paragraph text and nothing else,
    so every diagram and every table in a Word document was dropped on
    the floor.
    """

    def _docx(self) -> bytes:
        import io

        import docx

        document = docx.Document()
        document.add_heading("Quadratic Equations", level=1)
        document.add_paragraph(
            "A quadratic equation is of the form ax^2 + bx + c = 0, "
            "where a is not zero."
        )
        table = document.add_table(rows=2, cols=2)
        table.rows[0].cells[0].text = "Stage"
        table.rows[0].cells[1].text = "Input"
        table.rows[1].cells[0].text = "Light reaction"
        table.rows[1].cells[1].text = "Light, H2O"

        from PIL import Image

        image = Image.new("RGB", (40, 20), "white")
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        document.add_picture(io.BytesIO(buffer.getvalue()))

        output = io.BytesIO()
        document.save(output)
        return output.getvalue()

    def test_prose_comes_out(self):
        from app.services import page_artifacts

        text, _images = page_artifacts.extract_docx_text_and_images(self._docx())
        assert "Quadratic Equations" in text
        assert "ax^2 + bx + c = 0" in text

    def test_a_table_comes_out(self):
        from app.services import page_artifacts

        text, _images = page_artifacts.extract_docx_text_and_images(self._docx())
        assert "[TABLE: Stage | Input]" in text
        assert "Light reaction | Light, H2O" in text

    def test_a_picture_comes_out(self):
        from app.services import page_artifacts

        _text, images = page_artifacts.extract_docx_text_and_images(self._docx())
        assert len(images) == 1
        assert images[0][:8] == b"\x89PNG\r\n\x1a\n"

    def test_a_document_with_no_pictures_is_fine(self):
        import io

        import docx

        from app.services import page_artifacts

        document = docx.Document()
        document.add_paragraph("Just prose.")
        output = io.BytesIO()
        document.save(output)

        text, images = page_artifacts.extract_docx_text_and_images(output.getvalue())
        assert "Just prose." in text
        assert images == []


class TestPromptBraces:
    """A prompt that is never format()ed must not carry format escapes.

    The transcription prompt is sent to the model as it stands, so a
    doubled brace in it is a doubled brace the model copies into the
    material: every formula came out as `ax^{{2}}`. The prompts that
    *are* format()ed need the doubling, because that is how a literal
    brace survives str.format.
    """

    UNFORMATTED = [
        "VISION_OCR_PROMPT",
        "FIGURE_DETECTION_PROMPT",
        "FIGURE_DESCRIPTION_PROMPT",
    ]
    FORMATTED = [
        "SOW_PARSER",
        "SOW_PARSER_CHUNK",
        "STUDY_EXPLANATION",
    ]

    def test_unformatted_prompts_have_no_escaped_braces(self):
        from app.ai import prompts as p

        for name in self.UNFORMATTED:
            template = getattr(p, name)
            assert "{{" not in template, f"{name} carries a format escape"
            assert "}}" not in template, f"{name} carries a format escape"

    def test_formatted_prompts_render_single_braces(self):
        from app.ai import prompts as p

        for name in self.FORMATTED:
            template = getattr(p, name)
            rendered = p.render_prompt(
                template,
                raw_text="TEXT",
                context="CONTEXT",
                count=1,
                topic="TOPIC",
                difficulty="medium",
                exam_style="style",
                education_level="primary",
                level_guidance="G",
                material_title="T",
                figure_text="F",
                target_words=100,
            )
            assert "{{" not in rendered, f"{name} renders a doubled brace"
            assert "}}" not in rendered, f"{name} renders a doubled brace"

    def test_the_lesson_rule_renders_single_braces(self):
        from app.ai import prompts as p

        rendered = p.render_prompt(
            p.MCQ_ALL_TOPICS_GENERATOR,
            count=5,
            context="CONTEXT",
            difficulty="medium",
            exam_style="style",
        )
        assert "{{" not in rendered
        assert "}}" not in rendered
        # The rule itself is a substituted value, so its braces are
        # never unescaped by str.format. It has to carry single braces.
        assert "{{" not in p.TEACH_FROM_LESSON
        assert "}}" not in p.TEACH_FROM_LESSON


class TestFigureDetection:
    """A picture that shows information is worth teaching. A letterhead
    is not."""

    @pytest.mark.parametrize(
        "description",
        [
            "A green crest in the header of the page. It is a logo, not a drawing.",
            "The page contains a crest in the upper right corner. The crest is "
            "green and has a circular shape with a cross in the center.",
            "A green crest of a cross on top, with a line of text underneath.",
        ],
    )
    def test_decoration_is_not_a_figure(self, description):
        assert study_router._is_decoration_only(description) is True

    @pytest.mark.parametrize(
        "description",
        [
            "A graph of a parabola y = x^2 + x + 1, labelled (a), and a second "
            "graph y = -2x^2 + 3x + 1.",
            "Two coordinate planes. The first shows a parabola with vertex at "
            "(-1, 3) and the equation y = -(x+1)^2/2 + 3.",
            "A photograph of a plant cell under a microscope.",
            "A bar chart of the scores of five students.",
        ],
    )
    def test_a_real_figure_is_a_figure(self, description):
        assert study_router._is_decoration_only(description) is False


class TestTeachingLayerRendering:
    """The teaching layer has to become prose the model can read."""

    def test_body_and_heading(self):
        from app.services import study_explanation

        rendered = study_explanation.render_teaching_blocks(
            [
                {"type": "heading", "text": "Photosynthesis", "level": 2},
                {"type": "body", "text": "Plants make food from light."},
            ]
        )
        assert "## Photosynthesis" in rendered
        assert "Plants make food from light." in rendered

    def test_calculation_keeps_its_steps(self):
        from app.services import study_explanation

        rendered = study_explanation.render_teaching_blocks(
            [
                {
                    "type": "calculation",
                    "label": "Worked example",
                    "steps": ["Write the equation", "Substitute", "Result"],
                }
            ]
        )
        assert "1. Write the equation" in rendered
        assert "3. Result" in rendered

    def test_formula_keeps_the_source_and_the_meaning(self):
        from app.services import study_explanation

        rendered = study_explanation.render_teaching_blocks(
            [
                {
                    "type": "formula",
                    "text": "\\frac{a}{b}",
                    "description": "the ratio",
                }
            ]
        )
        assert "\\frac{a}{b}" in rendered
        assert "the ratio" in rendered

    def test_figure_keeps_its_description(self):
        from app.services import study_explanation

        rendered = study_explanation.render_teaching_blocks(
            [
                {
                    "type": "figure",
                    "figure_index": 2,
                    "page": 3,
                    "description": "A diagram of the water cycle.",
                }
            ]
        )
        assert "FIGURE 2" in rendered
        assert "page 3" in rendered
        assert "water cycle" in rendered

    def test_statement_and_definition_are_labelled(self):
        from app.services import study_explanation

        rendered = study_explanation.render_teaching_blocks(
            [
                {"type": "statement", "label": "Theorem", "text": "All squares are four sided."},
                {"type": "definition", "term": "Photosynthesis", "text": "how plants make food"},
            ]
        )
        assert "THEOREM:" in rendered
        assert "DEFINITION: Photosynthesis" in rendered

    def test_code_keeps_its_indentation(self):
        from app.services import study_explanation

        rendered = study_explanation.render_teaching_blocks(
            [{"type": "code", "language": "python", "text": "def f():\n    return 1"}]
        )
        assert "CODE (python)" in rendered
        assert "    return 1" in rendered

    def test_unknown_block_is_not_dropped(self):
        from app.services import study_explanation

        rendered = study_explanation.render_teaching_blocks(
            [{"type": "something_new", "text": "Content the reader does not lose."}]
        )
        assert "Content the reader does not lose." in rendered

    def test_empty_layer_renders_empty(self):
        from app.services import study_explanation

        assert study_explanation.render_teaching_layer(None) == ""
        assert study_explanation.render_teaching_layer({}) == ""


class TestMaterialContext:
    """The tutor and the quiz generators are taught from the lesson."""

    def _lesson(self):
        return {
            "blocks": [
                {"type": "body", "text": "The lesson the student was taught."},
            ]
        }

    def _outline(self):
        return '{"topics": [{"name": "Light", "subtopics": ["a"], "key_concepts": ["k"]}]}'

    def test_the_lesson_is_the_primary_source(self):
        context = study_router.build_material_context(
            self._outline(),
            "RAW OCR TEXT",
            budget=12000,
            outline_label="Outline:",
            explanation_structure=self._lesson(),
            include_source=False,
        )
        assert "The lesson the student was taught." in context
        assert "RAW OCR TEXT" not in context

    def test_the_source_comes_with_it_when_asked(self):
        context = study_router.build_material_context(
            self._outline(),
            "RAW OCR TEXT",
            budget=12000,
            outline_label="Outline:",
            explanation_structure=self._lesson(),
            include_source=True,
        )
        assert "The lesson the student was taught." in context
        assert "RAW OCR TEXT" in context

    def test_the_outline_is_always_there(self):
        context = study_router.build_material_context(
            self._outline(),
            "RAW",
            budget=12000,
            outline_label="Outline:",
            explanation_structure=self._lesson(),
        )
        assert "Topic: Light" in context

    def test_a_material_without_a_lesson_still_works(self):
        """Anything uploaded before the teaching layer existed."""
        context = study_router.build_material_context(
            self._outline(),
            "RAW OCR TEXT",
            budget=12000,
            outline_label="Outline:",
            explanation_structure=None,
        )
        assert "RAW OCR TEXT" in context
        assert "Topic: Light" in context

    def test_a_material_with_neither_is_the_outline(self):
        context = study_router.build_material_context(
            self._outline(),
            "",
            budget=12000,
            outline_label="Outline:",
            explanation_structure=None,
        )
        assert "Topic: Light" in context

    def test_the_budget_is_respected(self):
        context = study_router.build_material_context(
            self._outline(),
            "X" * 50_000,
            budget=1000,
            outline_label="Outline:",
            explanation_structure=None,
        )
        # The outline and the marker are outside the material itself.
        assert len(context) < 2500
        assert "truncated" in context

    def test_an_outline_override_replaces_the_global_one(self):
        context = study_router.build_material_context(
            self._outline(),
            "RAW",
            budget=12000,
            outline_label="Outline:",
            explanation_structure=self._lesson(),
            outline_override="Topic: One only",
        )
        assert "Topic: One only" in context
        assert "Topic: Light" not in context


class TestPromptsRender:
    """Every prompt must fill without a KeyError."""

    def test_every_generator_prompt_renders(self):
        from app.ai import prompts as p

        templates = [
            p.MCQ_GENERATOR,
            p.MCQ_TOPIC_GENERATOR,
            p.MCQ_ALL_TOPICS_GENERATOR,
            p.FLASHCARD_GENERATOR,
            p.FLASHCARD_TOPIC_GENERATOR,
            p.FLASHCARD_ALL_TOPICS_GENERATOR,
            p.ESSAY_GENERATOR,
            p.ESSAY_TOPIC_GENERATOR,
            p.ESSAY_ALL_TOPICS_GENERATOR,
            p.DIAGRAM_GENERATOR,
            p.VIDEO_SCRIPT_GENERATOR,
        ]
        for template in templates:
            rendered = p.render_prompt(
                template,
                count=5,
                context="CONTEXT",
                topic="TOPIC",
                difficulty="medium",
                exam_style="style",
                education_level="secondary",
            )
            assert "teach_from_lesson" not in rendered
            assert rendered.strip()

    def test_the_rule_reaches_the_prompt(self):
        from app.ai import prompts as p

        rendered = p.render_prompt(
            p.MCQ_ALL_TOPICS_GENERATOR,
            count=5,
            context="CONTEXT",
            difficulty="medium",
            exam_style="style",
        )
        assert "lesson written from the student's own material" in rendered
        assert "dollar signs" in rendered


class TestChunking:
    """A long document must be split so each piece fits one response."""

    def test_short_document_is_one_chunk(self):
        from app.services import study_chunking

        chunks = study_chunking.chunk_text("A short note about photosynthesis.")
        assert len(chunks) == 1

    def test_empty_document_is_no_chunks(self):
        from app.services import study_chunking

        assert study_chunking.chunk_text("") == []
        assert study_chunking.chunk_text("   \n\n  ") == []

    def test_long_document_splits_and_keeps_every_paragraph(self):
        from app.services import study_chunking

        paragraphs = [f"Paragraph {i} with some text in it." for i in range(400)]
        big = "\n\n".join(paragraphs)

        chunks = study_chunking.chunk_text(big)

        assert len(chunks) > 1, "a long document must be split"
        assert all(len(c) <= study_chunking.DEFAULT_MAX_CHARS for c in chunks)

        # Every paragraph must still be somewhere. The blank line
        # between the last paragraph of one chunk and the first of the
        # next is the cut itself, so it is not expected to survive.
        joined = "\n\n".join(chunks)
        for paragraph in paragraphs:
            assert paragraph in joined, f"lost: {paragraph!r}"

    def test_oversized_paragraph_is_split_at_sentences(self):
        from app.services import study_chunking

        sentence = "This is a sentence that goes on. "
        one_huge_paragraph = sentence * 400

        chunks = study_chunking.chunk_text(one_huge_paragraph, max_chars=1000)

        assert len(chunks) > 1
        assert all(len(c) <= 1000 for c in chunks)

    def test_needs_chunking_threshold(self):
        from app.services import study_chunking

        assert study_chunking.needs_chunking("x" * 100) is False
        assert study_chunking.needs_chunking("x" * 9000) is True


class TestChunkMerge:
    def test_blocks_are_concatenated_in_order(self):
        from app.services import study_chunking

        merged = study_chunking.merge_chunk_results(
            [
                {"title": "Doc", "content_blocks": [{"type": "body", "text": "one"}]},
                {"title": "Doc", "content_blocks": [{"type": "body", "text": "two"}]},
            ]
        )
        assert [b["text"] for b in merged["content_blocks"]] == ["one", "two"]

    def test_same_topic_in_two_chunks_is_merged(self):
        from app.services import study_chunking

        merged = study_chunking.merge_chunk_results(
            [
                {
                    "title": "Doc",
                    "topics": [
                        {"name": "Light", "subtopics": ["a"], "key_concepts": ["k1"]}
                    ],
                },
                {
                    "title": "Doc",
                    "topics": [
                        {
                            "name": "LIGHT",
                            "subtopics": ["b", "a"],
                            "key_concepts": ["k1", "k2"],
                        }
                    ],
                },
            ]
        )
        assert len(merged["topics"]) == 1
        topic = merged["topics"][0]
        assert topic["subtopics"] == ["a", "b"]
        assert topic["key_concepts"] == ["k1", "k2"]

    def test_different_topics_are_kept_apart(self):
        from app.services import study_chunking

        merged = study_chunking.merge_chunk_results(
            [
                {"title": "Doc", "topics": [{"name": "Light"}]},
                {"title": "Doc", "topics": [{"name": "Sound"}]},
            ]
        )
        assert [t["name"] for t in merged["topics"]] == ["Light", "Sound"]

    def test_junk_results_are_ignored(self):
        from app.services import study_chunking

        merged = study_chunking.merge_chunk_results(
            [None, "nonsense", {"title": "Doc", "content_blocks": [{"type": "body"}]}]
        )
        assert merged["title"] == "Doc"
        assert len(merged["content_blocks"]) == 1


class TestParserRepair:
    """A long document can run the model out of tokens mid-object.

    The phase 3 spec called for a retry with a stricter prompt and it
    was never implemented, so a truncated response silently produced a
    material with no structure and no error.
    """

    @pytest.mark.asyncio
    async def test_invalid_json_is_retried(self, monkeypatch):
        calls = []

        async def fake_route_ai(prompt, **kwargs):
            calls.append(prompt)
            if len(calls) == 1:
                return {"response": '{"title": "Cut off", "content_blocks": [', "provider": "cf"}
            return {
                "response": '{"title": "Repaired", "content_blocks": []}',
                "provider": "cf",
            }

        monkeypatch.setattr(study_router, "route_ai", fake_route_ai)

        parsed, provider, raw = await study_router._run_sow_parser("some material")
        assert len(calls) == 2, "the parser should have been retried"
        assert parsed["title"] == "Repaired"
        assert provider == "cf"

    @pytest.mark.asyncio
    async def test_valid_json_is_not_retried(self, monkeypatch):
        calls = []

        async def fake_route_ai(prompt, **kwargs):
            calls.append(prompt)
            return {"response": '{"title": "Fine", "content_blocks": []}', "provider": "cf"}

        monkeypatch.setattr(study_router, "route_ai", fake_route_ai)

        parsed, _, _ = await study_router._run_sow_parser("some material")
        assert len(calls) == 1, "a good response must not cost a second call"
        assert parsed["title"] == "Fine"

    @pytest.mark.asyncio
    async def test_two_failures_give_up_quietly(self, monkeypatch):
        calls = []

        async def fake_route_ai(prompt, **kwargs):
            calls.append(prompt)
            return {"response": "still not json", "provider": "cf"}

        monkeypatch.setattr(study_router, "route_ai", fake_route_ai)

        parsed, _, _ = await study_router._run_sow_parser("some material")
        assert len(calls) == 2
        assert parsed is None


class TestImageSniffing:
    """The content type on an upload is not to be trusted.

    The phone's image picker coerces anything it does not recognise to
    `image/jpeg`, including HEIC. Sending HEIC bytes in a data URI that
    claims JPEG makes the vision model refuse the image, and the
    material is lost with an error the student cannot act on.
    """

    @pytest.mark.parametrize(
        "payload,expected",
        [
            (b"\x89PNG\r\n\x1a\n" + b"0" * 8, "image/png"),
            (b"\xff\xd8\xff\xe0" + b"0" * 8, "image/jpeg"),
            (b"RIFF\x00\x00\x00\x00WEBP" + b"0" * 8, "image/webp"),
            (b"GIF89a" + b"0" * 8, "image/gif"),
            (b"%PDF-1.7" + b"0" * 8, "application/pdf"),
            (b"\x00\x00\x00\x18ftypheic" + b"0" * 8, "image/heic"),
        ],
    )
    def test_magic_bytes_win(self, payload, expected):
        assert study_router._sniff_image_content_type(payload, "image/jpeg") == expected

    def test_unknown_bytes_fall_back(self):
        assert study_router._sniff_image_content_type(b"nonsense", "image/jpeg") == "image/jpeg"

    def test_heic_is_not_claimed_as_jpeg(self):
        heic = b"\x00\x00\x00\x18ftypheic" + b"0" * 8
        assert study_router._sniff_image_content_type(heic, "image/jpeg") != "image/jpeg"


    def test_unknown_block_renders_empty(self):
        assert study_narration._render_block({"type": "wat"}) == ""

    def test_statement_names_the_kind_of_claim(self):
        rendered = study_narration._render_block(
            {
                "type": "statement",
                "label": "Theorem",
                "text": "All squares are four sided.",
            }
        )
        assert "Theorem" in rendered
        assert "four sided" in rendered

    def test_definition_speaks_the_term_first(self):
        rendered = study_narration._render_block(
            {
                "type": "definition",
                "term": "Photosynthesis",
                "text": "how plants make food",
            }
        )
        assert rendered.startswith("Photosynthesis means")


class TestChunkedParser:
    """A long document must be parsed in pieces."""

    @pytest.mark.asyncio
    async def test_long_document_is_parsed_in_chunks(self, monkeypatch):
        calls = []

        async def fake_route_ai(prompt, **kwargs):
            calls.append(prompt)
            index = len(calls)
            return {
                "response": (
                    '{"title": "Doc", "topics": [{"name": "T%d"}], '
                    '"content_blocks": [{"type": "body", "text": "part %d"}]}'
                    % (index, index)
                ),
                "provider": "cf",
            }

        monkeypatch.setattr(study_router, "route_ai", fake_route_ai)

        long_text = "\n\n".join(
            f"Paragraph {i} with a reasonable amount of text in it."
            for i in range(300)
        )
        parsed, provider, _ = await study_router._run_sow_parser(long_text)

        assert len(calls) > 1, "a long document must be parsed in pieces"
        assert parsed is not None
        # The pieces are joined, so every part's body survives.
        texts = [b["text"] for b in parsed["content_blocks"]]
        assert len(texts) == len(calls)

    @pytest.mark.asyncio
    async def test_short_document_is_parsed_in_one_call(self, monkeypatch):
        calls = []

        async def fake_route_ai(prompt, **kwargs):
            calls.append(prompt)
            return {
                "response": '{"title": "Doc", "content_blocks": []}',
                "provider": "cf",
            }

        monkeypatch.setattr(study_router, "route_ai", fake_route_ai)

        await study_router._run_sow_parser("A short note about photosynthesis.")
        assert len(calls) == 1

    @pytest.mark.asyncio
    async def test_a_chunk_that_fails_does_not_lose_the_document(
        self, monkeypatch
    ):
        calls = []

        async def fake_route_ai(prompt, **kwargs):
            calls.append(prompt)
            if len(calls) == 1:
                return {"response": "not json", "provider": "cf"}
            return {
                "response": (
                    '{"title": "Doc", "content_blocks": '
                    '[{"type": "body", "text": "part %d"}]}' % len(calls)
                ),
                "provider": "cf",
            }

        monkeypatch.setattr(study_router, "route_ai", fake_route_ai)

        long_text = "\n\n".join(
            f"Paragraph {i} with a reasonable amount of text in it."
            for i in range(300)
        )
        parsed, _, _ = await study_router._run_sow_parser(long_text)

        assert parsed is not None
        assert parsed["content_blocks"], "the good chunks must survive"


class TestAudioContentType:
    def test_wav_is_not_labelled_as_mp3(self):
        """MeloTTS answers with WAV. Labelling it audio/mpeg breaks it."""
        wav = b"RIFF\x24\x00\x00\x00WAVEfmt "
        assert study_router._audio_content_type(wav) == "audio/wav"

    def test_mp3_is_labelled_as_mp3(self):
        assert study_router._audio_content_type(b"ID3\x04\x00\x00") == "audio/mpeg"
        assert study_router._audio_content_type(b"\xff\xfb\x90\x00") == "audio/mpeg"

    def test_unknown_falls_back_to_mpeg(self):
        assert study_router._audio_content_type(b"") == "audio/mpeg"
        assert study_router._audio_content_type(b"nonsense") == "audio/mpeg"


class TestSpokenMath:
    """A voice cannot read LaTeX.

    The reader typesets a formula; the narration has to say it. Reading
    "\\frac{a}{b}" out character by character is nonsense.
    """

    @pytest.mark.parametrize(
        "source,expected",
        [
            ("\\frac{a}{b}", "a over b"),
            ("x^{2}", "x to the power 2"),
            ("x_{n}", "x subscript n"),
            ("\\sqrt{x}", "the square root of x"),
            ("2 \\times 3", "2 times 3"),
            ("a \\leq b", "a less than or equal to b"),
            ("\\alpha", "alpha"),
        ],
    )
    def test_spoken(self, source, expected):
        assert study_narration._speak_math(source) == expected

    def test_formula_block_speaks_the_formula_not_the_source(self):
        rendered = study_narration._render_block(
            {
                "type": "formula",
                "text": "\\frac{a}{b}",
                "description": "the ratio",
            }
        )
        assert "a over b" in rendered
        assert "\\frac" not in rendered
        assert "the ratio" in rendered


class TestNarrationBlocks:
    def test_figure_block_is_spoken(self):
        rendered = study_narration._render_block(
            {
                "type": "figure",
                "figure_index": 2,
                "text": "A circuit with a battery and a resistor.",
            }
        )
        assert "Figure 2" in rendered
        assert "battery" in rendered

    def test_recap_block_is_spoken(self):
        rendered = study_narration._render_block(
            {"type": "recap", "items": ["Chlorophyll traps light", "Glucose is made"]}
        )
        assert "Chlorophyll traps light" in rendered
        assert "Glucose is made" in rendered

    def test_unknown_block_renders_empty(self):
        assert study_narration._render_block({"type": "wat"}) == ""


class TestNarrationSource:
    def _material(self, parsed=None, explanation=None):
        class Material:
            pass

        material = Material()
        material.parsed_structure = parsed
        material.explanation_structure = explanation
        return material

    def test_teaching_layer_is_preferred(self):
        """The narration speaks the explanation, not the raw structure."""
        material = self._material(
            parsed='{"topics": [{"name": "Light"}], "content_blocks": [{"type": "body", "text": "raw"}]}',
            explanation='{"blocks": [{"type": "body", "text": "explained"}]}',
        )
        merged = study_router._narration_structure_for(material)
        assert merged["blocks"][0]["text"] == "explained"
        # The topics still come from the faithful layer.
        assert merged["topics"][0]["name"] == "Light"

    def test_falls_back_to_the_faithful_layer(self):
        material = self._material(
            parsed='{"content_blocks": [{"type": "body", "text": "raw"}]}',
            explanation=None,
        )
        merged = study_router._narration_structure_for(material)
        assert merged["content_blocks"][0]["text"] == "raw"

    def test_unreadable_explanation_is_ignored(self):
        material = self._material(
            parsed='{"content_blocks": [{"type": "body", "text": "raw"}]}',
            explanation="not json at all",
        )
        merged = study_router._narration_structure_for(material)
        assert merged["content_blocks"][0]["text"] == "raw"


class TestEducationLevel:
    def test_known_levels_pass_through(self):
        for level in ("primary", "secondary", "tertiary", "research"):
            assert study_router._normalise_education_level(level) == level

    def test_unknown_level_falls_back(self):
        assert study_router._normalise_education_level("wat") == "primary"
        assert study_router._normalise_education_level(None) == "primary"
        assert study_router._normalise_education_level("") == "primary"


@pytest.mark.parametrize(
    "level,expected",
    [
        ("primary", "primary"),
        ("PRIMARY", "primary"),
        ("Secondary", "secondary"),
        ("unknown", "primary"),
        (None, "primary"),
    ],
)
def test_normalise_education_level(level, expected):
    assert study_router._normalise_education_level(level) == expected
