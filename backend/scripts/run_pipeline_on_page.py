"""Run the real study pipeline over a real page of study material.

This is the same code the upload worker runs: the same OCR prompt, the
same parser prompt, the same figure description. Nothing is stubbed.

Usage:  python scripts/run_pipeline_on_page.py <image path> [more pages...]
"""
import asyncio
import json
import os
import sys

sys.path.insert(0, ".")

# The console on Windows defaults to cp1252, which cannot print the
# mathematics this material is full of.
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

# The app's settings, including the Cloudflare credentials.
from app.config import settings  # noqa: E402
from app.routers import study as study_router  # noqa: E402
from app.services import page_artifacts  # noqa: E402


async def run(path: str) -> None:
    with open(path, "rb") as handle:
        contents = handle.read()

    print("=" * 72)
    print(f"PAGE: {os.path.basename(path)}  ({len(contents) // 1024} KB)")
    print("=" * 72)

    # ── 1. OCR + figure detection, exactly as the upload worker does ─
    text = await study_router._ocr_image_with_cloudflare(
        contents, "image/jpeg", user_id=None
    )
    findings = await study_router._detect_figures_with_cloudflare(contents)
    text = study_router._strip_furniture(text, findings.header, findings.footer)
    if findings.figure:
        text = f"{text}\n\n[FIGURE: {findings.figure}]"

    print("\n--- OCR TEXT (the app's VISION_OCR_PROMPT) ---\n")
    print(text)
    print(f"\n--- PAGE FINDINGS ---\nheader: {findings.header}\nfooter: {findings.footer}")
    print(f"figure: {findings.figure}")

    # ── 2. The parser, exactly as the upload worker does it ─────────
    parsed, provider, _ = await study_router._run_sow_parser(text)
    print(f"\n--- PARSED STRUCTURE (provider: {provider}) ---\n")
    if isinstance(parsed, dict):
        print("title:", parsed.get("title"))
        print("topics:", [t.get("name") for t in parsed.get("topics", [])])
        print("\nblocks:")
        for block in parsed.get("content_blocks", []):
            print("  ", json.dumps(block, ensure_ascii=False)[:300])
    else:
        print("PARSER RETURNED NOTHING")

    # ── 3. What the figures would look like ─────────────────────────
    figures = page_artifacts.build_figure_artifacts(
        contents, key_prefix="check", max_pages=1
    )
    print(f"\n--- FIGURES FOUND: {len(figures)} ---")
    for figure in figures:
        print(
            f"  figure {figure.index} on page {figure.page} "
            f"bbox={figure.bbox} {figure.width}x{figure.height}"
        )


async def main() -> None:
    paths = sys.argv[1:]
    if not paths:
        print(__doc__)
        raise SystemExit(1)
    if not settings.cloudflare_account_id or not settings.cloudflare_api_token:
        raise SystemExit("Cloudflare credentials are not configured.")
    for path in paths:
        await run(path)
        print()


if __name__ == "__main__":
    asyncio.run(main())
