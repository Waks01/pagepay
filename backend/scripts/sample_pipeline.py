"""Run the real pipeline over a sample of pages and report the outcome.

For each page: transcribe, look for a picture, strip the page furniture,
parse. Then report what the parser produced, so a page can be compared
against the picture of it by eye.
"""
import asyncio
import glob
import os
import re
import sys

sys.path.insert(0, ".")

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

from app.config import settings  # noqa: E402
from app.routers import study as study_router  # noqa: E402

FIGURE_MARKER = re.compile(r"\[FIGURE:", re.IGNORECASE)


async def one(path: str) -> dict:
    with open(path, "rb") as handle:
        contents = handle.read()

    text = await study_router._ocr_image_with_cloudflare(
        contents, "image/jpeg", user_id=None
    )
    findings = await study_router._detect_figures_with_cloudflare(contents)
    text = study_router._strip_furniture(text, findings.header, findings.footer)
    has_marker = bool(FIGURE_MARKER.search(text))
    if findings.figure:
        text = f"{text}\n\n[FIGURE: {findings.figure}]"

    parsed, provider, _ = await study_router._run_sow_parser(text)
    blocks = (parsed or {}).get("content_blocks") or []
    kinds = {}
    for block in blocks:
        kind = block.get("type", "?")
        kinds[kind] = kinds.get(kind, 0) + 1

    return {
        "name": os.path.basename(path),
        "figure": findings.figure,
        "header": findings.header,
        "footer": findings.footer,
        "marker": has_marker,
        "kinds": kinds,
        "text_len": len(text),
    }


async def main() -> None:
    pattern = sys.argv[1] if len(sys.argv) > 1 else r"..\words\*.jpg"
    paths = sorted(glob.glob(pattern))
    if not paths:
        print("no pages matched")
        return

    semaphore = asyncio.Semaphore(3)

    async def guarded(path: str):
        async with semaphore:
            try:
                return await one(path)
            except Exception as exc:
                return {"name": os.path.basename(path), "error": str(exc)}

    for result in await asyncio.gather(*(guarded(p) for p in paths)):
        if result.get("error"):
            print(f"ERROR {result['name']}: {result['error']}")
            continue
        flag = "FIGURE" if result["figure"] else "-------"
        print(f"\n{flag}  {result['name']}  ({result['text_len']} chars)")
        if result["header"]:
            print(f"    header: {result['header']}")
        if result["footer"]:
            print(f"    footer: {result['footer']}")
        if result["figure"]:
            print(f"    figure: {result['figure'][:260]}")
        print(f"    blocks: {result['kinds']}")


if __name__ == "__main__":
    asyncio.run(main())
