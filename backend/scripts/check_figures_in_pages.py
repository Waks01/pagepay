"""OCR a set of pages and report the figures each one claims to have.

A figure claim is only worth as much as the page it came from, so
this prints the [FIGURE: ...] line for every page that produces one.
Those pages then get looked at, because a model that invents a graph
is a model that will teach the student a graph that is not in their
material.
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

FIGURE_LINE = re.compile(r"\[FIGURE:.*?\]", re.IGNORECASE | re.DOTALL)


async def main() -> None:
    pattern = sys.argv[1] if len(sys.argv) > 1 else r"..\words\*.jpg"
    paths = sorted(glob.glob(pattern))
    if not paths:
        print("no pages matched")
        return

    claimed = 0
    for path in paths:
        with open(path, "rb") as handle:
            contents = handle.read()
        try:
            text = await study_router._ocr_image_with_cloudflare(
                contents, "image/jpeg", user_id=None
            )
        except Exception as exc:
            print(f"{os.path.basename(path)}: OCR FAILED {exc}")
            continue

        figures = FIGURE_LINE.findall(text)
        tail = text.strip().splitlines()[-1][:150] if text.strip() else ""
        marker = "FIGURE" if figures else "      "
        print(f"\n{marker}  {os.path.basename(path)}")
        if figures:
            claimed += 1
            for figure in figures:
                print(f"        -> {figure[:400]}")
        print(f"        last line: {tail}")

    print(f"\n\n{claimed} of {len(paths)} pages claimed a figure.")


if __name__ == "__main__":
    if not settings.cloudflare_account_id or not settings.cloudflare_api_token:
        raise SystemExit("Cloudflare credentials are not configured.")
    asyncio.run(main())
