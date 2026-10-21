"""Manual check: does the figure extractor find real diagrams?

Builds a PDF that looks like a study page — prose, a heading, a
boxed diagram, a table drawn with lines, and a bullet list — then runs
the same detection the upload worker uses and prints what it found.
"""
import sys

import fitz

sys.path.insert(0, ".")

from app.services import page_artifacts  # noqa: E402


def build_pdf() -> bytes:
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)

    page.insert_text((60, 80), "Photosynthesis", fontsize=22, fontname="hebo")
    body = (
        "Photosynthesis is the process by which green plants turn light energy into "
        "chemical energy. Chlorophyll in the leaves absorbs light, and the plant uses "
        "that energy to combine carbon dioxide from the air with water from the soil."
    )
    page.insert_textbox(fitz.Rect(60, 110, 535, 200), body, fontsize=11)

    # A boxed "diagram": three linked boxes with labels.
    for index, (x0, label) in enumerate([(80, "Light"), (250, "Chlorophyll"), (420, "Glucose")]):
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

    # A table drawn with lines.
    table_top = 400
    for row in range(4):
        page.draw_line(
            fitz.Point(60, table_top + row * 24),
            fitz.Point(340, table_top + row * 24),
            color=(0, 0, 0),
            width=1,
        )
    for col in range(3):
        page.draw_line(
            fitz.Point(60 + col * 93, table_top),
            fitz.Point(60 + col * 93, table_top + 72),
            color=(0, 0, 0),
            width=1,
        )
    page.insert_text((68, table_top + 16), "Stage", fontsize=10, fontname="hebo")
    page.insert_text((165, table_top + 16), "Input", fontsize=10, fontname="hebo")
    page.insert_text((262, table_top + 16), "Output", fontsize=10, fontname="hebo")
    page.insert_text((68, table_top + 40), "Light reaction", fontsize=10)
    page.insert_text((165, table_top + 40), "Light, H2O", fontsize=10)
    page.insert_text((262, table_top + 40), "ATP, O2", fontsize=10)

    # A short bullet list.
    for index, item in enumerate(["- Absorbs light", "- Releases oxygen", "- Needs carbon dioxide"]):
        page.insert_text((60, 560 + index * 20), item, fontsize=11)

    # A decorative rule — this must NOT be reported as a figure.
    page.draw_line(fitz.Point(60, 640), fitz.Point(535, 640), color=(0.6, 0.6, 0.6), width=1)

    return doc.tobytes()


def main() -> None:
    contents = build_pdf()
    doc = fitz.open(stream=contents, filetype="pdf")
    page = doc[0]

    print("page size:", page.rect)
    print("has prose:", page_artifacts.page_has_prose(page))
    print("drawings:", len(page.get_drawings()))

    regions = page_artifacts.find_figure_regions(page)
    print(f"\nregions found: {len(regions)}")
    for x0, y0, x1, y1 in regions:
        area = abs((x1 - x0) * (y1 - y0)) / (page.rect.width * page.rect.height)
        print(
            f"  x0={x0:7.1f} y0={y0:7.1f} x1={x1:7.1f} y1={y1:7.1f} area={area:.3f}"
        )

    failures = []

    # The flowchart: three boxes joined by arrows must come back as one
    # region, not three.
    diagram = [r for r in regions if r[1] > 200 and r[3] < 380]
    if len(diagram) != 1:
        failures.append(f"expected 1 diagram region, got {len(diagram)}")
    else:
        print(f"\ndiagram region detected: {[round(v, 1) for v in diagram[0]]}")
        data, width, height = page_artifacts.crop_region_png(
            page, diagram[0], 2.0
        )
        print(f"crop: {width}x{height}, {len(data)} bytes")
        if not data:
            failures.append("diagram crop was empty")

    # The table: a grid of lines must be found too.
    table = [r for r in regions if r[1] > 380 and r[3] < 520]
    if len(table) != 1:
        failures.append(f"expected 1 table region, got {len(table)}")
    else:
        print(f"table region detected: {[round(v, 1) for v in table[0]]}")

    # The decorative rule is not a figure and must not be reported.
    rules = [r for r in regions if r[1] > 600]
    if rules:
        failures.append(f"a decorative rule was reported as a figure: {rules}")

    if failures:
        print("\nFAIL:")
        for failure in failures:
            print(f"  - {failure}")
        sys.exit(1)
    print("\nOK: diagram found, table found, decorative rule ignored")


if __name__ == "__main__":
    main()
