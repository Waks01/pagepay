"""Does a focused question get a better answer than an open one?

The transcription prompt asks for the page's words. Asking it, in the
same breath, whether the page holds a picture produced a graph that
was not there — the model described a parabola on two pages that
contain nothing but prose.

This asks the same page the same question, but on its own, with
nothing else in the context: is there a drawing on this page? That is
a question a vision model can answer with a yes or a no, instead of a
description it has to invent.
"""
import asyncio
import base64
import glob
import os
import sys

import httpx

sys.path.insert(0, ".")

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

from app.config import settings  # noqa: E402

DETECT_PROMPT = """Look at this page of a document.

On the FIRST line, answer with exactly one word: YES or NO.

Answer YES only if the page contains a picture that shows information: a graph, a diagram, a chart, a drawn table, a photograph, a circuit, a map, or a worked illustration.

Answer NO when:
- the only thing on the page that is not text is a logo, a crest, a seal, an emblem, a decorative border, a page number, a header or a footer
- the page talks about a graph, a diagram or an example but does not actually show one
- you are not certain a picture is there

If the answer is YES, write the description on the lines that follow: what each picture is, what it shows, and every label and number on it.

If the answer is NO, write nothing after the first line."""


async def detect(path: str) -> str:
    with open(path, "rb") as handle:
        contents = handle.read()
    b64 = base64.b64encode(contents).decode()
    url = (
        f"https://api.cloudflare.com/client/v4/accounts/"
        f"{settings.cloudflare_account_id}/ai/run/"
        f"@cf/meta/llama-3.2-11b-vision-instruct"
    )
    headers = {
        "Authorization": f"Bearer {settings.cloudflare_api_token}",
        "Content-Type": "application/json",
    }
    body = {
        "prompt": DETECT_PROMPT,
        "image": f"data:image/jpeg;base64,{b64}",
        "max_tokens": 500,
        "temperature": 0.0,
    }
    async with httpx.AsyncClient(timeout=120) as client:
        response = await client.post(url, json=body, headers=headers)
    if response.status_code != 200:
        return f"HTTP {response.status_code}"
    return (response.json().get("result", {}).get("response", "") or "").strip()


def verdict(answer: str) -> str:
    """YES, NO, or UNREADABLE — from the first line."""
    first = (answer.strip().splitlines() or [""])[0].strip().upper()
    if first.startswith("YES"):
        return "YES"
    if first.startswith("NO"):
        return "NO"
    if "NO DRAWING" in first or "NO PICTURE" in first:
        return "NO"
    return "UNREADABLE"


async def main() -> None:
    pattern = sys.argv[1] if len(sys.argv) > 1 else r"..\words\*.jpg"
    paths = sorted(glob.glob(pattern))
    if not paths:
        print("no pages matched")
        return

    semaphore = asyncio.Semaphore(3)

    async def one(path: str):
        async with semaphore:
            return path, await detect(path)

    results = await asyncio.gather(*(one(p) for p in paths))

    tally = {"YES": 0, "NO": 0, "UNREADABLE": 0}
    for path, answer in results:
        name = os.path.basename(path)
        mark = verdict(answer)
        tally[mark] = tally.get(mark, 0) + 1
        print(f"\n{mark:<10} {name}")
        if mark == "YES":
            body = answer.strip().splitlines()[1:]
            print("    " + " ".join(body)[:400])
        elif mark == "UNREADABLE":
            print("    " + answer.strip()[:200].replace("\n", " "))

    print(f"\n\n{tally}")


if __name__ == "__main__":
    asyncio.run(main())
