"""The teaching layer for uploaded study materials.

`parsed_structure` is deliberately faithful to the source document: it
records what the student uploaded, in the order they uploaded it, with
no rewriting. That is the right shape for "show me my material", and
the wrong shape for "teach me this".

This module produces the second shape. The same material is rewritten
as a lesson a beginner can follow: plain language first and the
technical term second, everyday analogies, every worked example walked
through step by step, and every diagram described in words so a student
who cannot see the picture still gets its content.

The result is what the reader shows in "Explained" mode, what the
tutor quotes, and what the narration speaks. The faithful layer is
still there, untouched, for the student who wants the original.
"""

from __future__ import annotations

import json
import logging

from app.ai.prompts import STUDY_EXPLANATION
from app.config import settings

logger = logging.getLogger("uvicorn.error")

# The explanation is a full lesson, so it needs more room than the
# 4000-token default the other generators use.
_EXPLANATION_MAX_TOKENS = 8000

# How long the lesson should be. Roughly 900 words is a solid ten
# minutes of narration, which is the shape of one podcast episode.
_DEFAULT_TARGET_WORDS = 900


def figure_text_block(figures: list[dict]) -> str:
    """Render the figure descriptions for the prompt.

    Each figure is listed with the number the lesson will refer to it
    by, and the page it came from, so the model can point the student
    at the right picture.
    """
    if not figures:
        return "(the material has no figures)"

    lines = []
    for figure in figures:
        index = figure.get("figure_index") or figure.get("index")
        page = figure.get("page")
        description = (figure.get("description") or "").strip()
        caption = (figure.get("caption") or "").strip()
        if not description and not caption:
            continue
        label = f"Figure {index}"
        if page:
            label += f" (page {page})"
        if caption:
            label += f": {caption}"
        if description:
            label += f" — {description}"
        lines.append(label)
    return "\n".join(lines) if lines else "(the material has no figures)"


def _blocks_of(structure: object) -> list[dict]:
    """The blocks of a teaching layer, whichever key holds them."""
    if not isinstance(structure, dict):
        return []
    blocks = structure.get("blocks") or structure.get("content_blocks")
    if not isinstance(blocks, list):
        return []
    return [b for b in blocks if isinstance(b, dict)]


def render_teaching_blocks(blocks: list[dict]) -> str:
    """Render the teaching layer's blocks as prose a model can read.

    The tutor and the quiz generators read prose, not a schema. A
    worked calculation reads as its steps, a formula reads as its
    source with a sentence saying what it means, and a diagram reads
    as the description that was written for it — the one a student who
    cannot see the picture still gets.

    The labels are shouted on purpose. The model has to be able to tell
    a warning from a definition from a worked example without
    guessing, and "CAREFUL:" is unmistakable where a bullet would not
    be.
    """
    lines: list[str] = []

    for block in blocks:
        kind = (block.get("type") or "").strip()

        if kind == "heading":
            text = _text(block.get("text"))
            if text:
                lines.append(f"## {text}")
            continue

        if kind == "body":
            text = _text(block.get("text"))
            if text:
                lines.append(text)
            continue

        if kind in ("list", "numbered_list"):
            items = block.get("items") or []
            rendered = [
                f"- {_text(item)}" for item in items if _text(item)
            ]
            if rendered:
                lines.append("\n".join(rendered))
            continue

        if kind == "tip":
            text = _text(block.get("text"))
            if text:
                lines.append(f"REMEMBER: {text}")
            continue

        if kind == "warning":
            text = _text(block.get("text"))
            if text:
                lines.append(f"CAREFUL: {text}")
            continue

        if kind == "calculation":
            steps = [
                _text(step) for step in (block.get("steps") or []) if _text(step)
            ]
            if not steps:
                continue
            label = _text(block.get("label")) or "WORKED EXAMPLE"
            numbered = "\n".join(
                f"{index}. {step}" for index, step in enumerate(steps, start=1)
            )
            lines.append(f"{label}:\n{numbered}")
            continue

        if kind == "code":
            code = (block.get("text") or "").rstrip()
            if not code:
                continue
            language = _text(block.get("language")) or "code"
            lines.append(f"CODE ({language}):\n```\n{code}\n```")
            continue

        if kind == "quote":
            text = _text(block.get("text"))
            if not text:
                continue
            attribution = _text(block.get("attribution"))
            if attribution:
                lines.append(f'QUOTE: "{text}" — {attribution}')
            else:
                lines.append(f'QUOTE: "{text}"')
            continue

        if kind == "formula":
            source = (block.get("text") or "").strip()
            if not source:
                continue
            description = _text(block.get("description"))
            if description:
                lines.append(f"FORMULA: {source} — {description}")
            else:
                lines.append(f"FORMULA: {source}")
            continue

        if kind == "statement":
            text = _text(block.get("text"))
            if not text:
                continue
            label = _text(block.get("label")) or "STATEMENT"
            lines.append(f"{label.upper()}: {text}")
            continue

        if kind == "definition":
            text = _text(block.get("text"))
            term = _text(block.get("term"))
            if not text and not term:
                continue
            if term and text:
                lines.append(f"DEFINITION: {term} — {text}")
            else:
                lines.append(f"DEFINITION: {term or text}")
            continue

        if kind == "table":
            headers = [
                _text(h) for h in (block.get("headers") or []) if _text(h)
            ]
            rows = block.get("rows") or []
            if not headers and not rows:
                continue
            lines.append("TABLE:")
            if headers:
                lines.append(" | ".join(headers))
            for row in rows:
                if isinstance(row, list):
                    cells = [_text(c) for c in row]
                    lines.append(" | ".join(cells))
            continue

        if kind == "figure":
            description = _text(block.get("description")) or _text(block.get("text"))
            if not description:
                continue
            index = block.get("figure_index")
            page = block.get("page")
            label = f"FIGURE {index}" if index else "FIGURE"
            if page:
                label += f" (page {page})"
            lines.append(f"{label}: {description}")
            continue

        if kind == "recap":
            items = [_text(item) for item in (block.get("items") or []) if _text(item)]
            if items:
                lines.append("WHAT TO REMEMBER: " + "; ".join(items))
            continue

        # A block type this module does not know about still carries
        # text. Dropping it would quietly remove a piece of the
        # material the student was taught.
        fallback = _text(block.get("text"))
        if fallback:
            lines.append(fallback)

    return "\n\n".join(lines).strip()


def render_teaching_layer(structure: object) -> str:
    """The teaching layer as prose. Empty string when there is none."""
    blocks = _blocks_of(structure)
    if not blocks:
        return ""
    return render_teaching_blocks(blocks)


def _text(value: object) -> str:
    """A clean string from whatever the model put in the field."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float)):
        return str(value)
    return ""


def _parse_json(response: str) -> dict | None:
    """Best-effort JSON parse, tolerating a fenced code block."""
    try:
        loaded = json.loads(response)
        return loaded if isinstance(loaded, dict) else None
    except Exception:
        pass
    for fence in ("```json", "```"):
        if fence in response:
            inner = response.split(fence, 1)[1]
            inner = inner.split("```", 1)[0]
            try:
                loaded = json.loads(inner)
                return loaded if isinstance(loaded, dict) else None
            except Exception:
                continue
    return None


async def build_explanation(
    *,
    title: str,
    raw_text: str,
    figures: list[dict] | None = None,
    level: str | None = None,
    target_words: int = _DEFAULT_TARGET_WORDS,
    db=None,
    user_id: int | None = None,
) -> dict | None:
    """Rewrite the material as a beginner-friendly lesson.

    Returns the parsed lesson (`{"title": ..., "blocks": [...]}`) or
    None when the model did not return usable JSON. A None result is
    not fatal — the material keeps its faithful layer and the student
    can still read and hear the source.
    """
    from app.ai.router import route_ai

    level = (level or settings.study_education_default_level or "primary").lower()
    if level not in ("primary", "secondary", "tertiary", "research"):
        level = "primary"

    from app.services.audio_pricing import normalise_level

    level = normalise_level(level)

    guidance = _LEVEL_GUIDANCE.get(level, _LEVEL_GUIDANCE["primary"])

    prompt = STUDY_EXPLANATION.format(
        material_title=title or "Untitled Material",
        education_level=level,
        level_guidance=guidance,
        raw_text=raw_text or "",
        figure_text=figure_text_block(figures or []),
        target_words=target_words,
    )

    result = await route_ai(
        prompt,
        task_type="heavy",
        max_tokens=_EXPLANATION_MAX_TOKENS,
        temperature=0.7,
        db=db,
        user_id=user_id,
        endpoint="study_explanation",
    )
    parsed = _parse_json(result.get("response") or "")
    if not parsed:
        logger.error(
            "[explanation] model returned non-JSON: %s",
            (result.get("response") or "")[:200],
        )
        return None
    if not isinstance(parsed.get("blocks"), list) or not parsed["blocks"]:
        logger.error("[explanation] model returned no blocks")
        return None
    return parsed


# Kept in step with NARRATION_LEVEL_GUIDANCE in app/ai/prompts.py so the
# lesson the student reads and the lesson they hear are pitched the
# same way.
_LEVEL_GUIDANCE = {
    "primary": (
        "Speak to a young student. Short sentences. Explain every idea "
        "with something from everyday life — \"Imagine you have five "
        "apples...\". Say the simple version first, then the formal term."
    ),
    "secondary": (
        "Speak to a secondary-school student. Detailed explanations with "
        "worked examples, step-by-step walkthroughs, and real-world uses."
    ),
    "tertiary": (
        "Speak to a university student. Academic depth, correct "
        "terminology, and enough context to see why the idea matters."
    ),
    "research": (
        "Speak to a researcher. Cover assumptions, trade-offs, and edge "
        "cases; name the technique and use precise terminology."
    ),
}
