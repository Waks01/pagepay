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

from app.ai.prompts import (
    STUDY_EXPLANATION,
    STUDY_EXPLANATION_GROUNDING,
)
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
    ground: bool = True,
) -> dict | None:
    """Rewrite the material as a beginner-friendly lesson.

    Returns the parsed lesson (`{"title": ..., "blocks": [...]}`) or
    None when the model did not return usable JSON. A None result is
    not fatal — the material keeps its faithful layer and the student
    can still read and hear the source.

    With `ground`, the lesson is audited against the material and
    repaired. The audit finds the claims that the material does not
    support — a number that is nowhere in the source, a worked example
    whose answer the material does not give, a figure that says more
    than its description said — and one repair pass fixes them. A
    lesson that is wrong is worse than no lesson, because the quiz is
    written against it and the narration speaks it.
    """
    from app.ai.router import route_ai

    level = (level or settings.study_education_default_level or "primary").lower()
    if level not in ("primary", "secondary", "tertiary", "research"):
        level = "primary"

    from app.services.audio_pricing import normalise_level

    level = normalise_level(level)

    guidance = _LEVEL_GUIDANCE.get(level, _LEVEL_GUIDANCE["primary"])

    figure_text = figure_text_block(figures or [])

    prompt = STUDY_EXPLANATION.format(
        material_title=title or "Untitled Material",
        education_level=level,
        level_guidance=guidance,
        raw_text=raw_text or "",
        figure_text=figure_text,
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

    if not ground or not settings.study_grounding_enabled:
        return parsed

    return await ground_explanation(
        parsed,
        raw_text=raw_text,
        figure_text=figure_text,
        db=db,
        user_id=user_id,
    )


async def ground_explanation(
    explanation: dict,
    *,
    raw_text: str,
    figure_text: str = "",
    db=None,
    user_id: int | None = None,
) -> dict:
    """Check the lesson against the material and repair what fails.

    The check always runs. The numeric audit is a *diagnostic*: it
    points at the claims that the material does not support, and it
    catches the worst ones — a worked example whose answer the
    material does not give, a figure that says more than its
    description said. But a number that happens to appear somewhere
    else in the material passes the audit, and a claim with no number
    in it at all passes it too. So the audit is a hint for the
    repair, not a gate in front of it.

    The repair is one extra call, and it is worth it: the lesson is
    what the student is taught from, what the quiz is written
    against, and what the narration speaks. If it is wrong, all three
    are wrong in the same way.
    """
    from app.ai.router import route_ai
    from app.services import study_grounding

    audit = study_grounding.audit_explanation(explanation, raw_text, figure_text)
    if audit["clean"]:
        logger.info("[explanation] grounding check found nothing to repair")
    else:
        logger.info(
            "[explanation] grounding check found %s unverified numbers, "
            "%s unsupported calculations, %s unsupported figures",
            len(audit["unverified_numbers"]),
            len(audit["unsupported_calculations"]),
            len(audit["unsupported_figures"]),
        )

    suspects: list[str] = []
    for number in audit["unverified_numbers"]:
        suspects.append(f"the number {number} does not appear in the material")
    for problem in audit["unsupported_calculations"]:
        suspects.append(
            f"this worked example ends with a result the material does not "
            f"give: {problem}"
        )
    for problem in audit["unsupported_figures"]:
        suspects.append(f"this figure says more than its description: {problem}")

    prompt = STUDY_EXPLANATION_GROUNDING.format(
        raw_text=raw_text or "",
        figure_text=figure_text or "(no figures)",
        lesson=json.dumps(explanation, ensure_ascii=False),
        suspects="\n".join(f"- {s}" for s in suspects) or "- nothing",
    )

    try:
        result = await route_ai(
            prompt,
            task_type="heavy",
            max_tokens=_EXPLANATION_MAX_TOKENS,
            temperature=0.2,
            db=db,
            user_id=user_id,
            endpoint="study_explanation_grounding",
        )
    except Exception as exc:
        logger.warning("[explanation] grounding repair failed: %s", exc)
        return explanation

    repaired = _parse_json(result.get("response") or "")
    if not repaired or not isinstance(repaired.get("blocks"), list):
        logger.warning("[explanation] grounding repair returned nothing usable")
        return explanation
    if not repaired["blocks"]:
        return explanation

    # The repair must not have emptied the lesson.
    if len(repaired["blocks"]) < len(explanation.get("blocks") or []) * 0.4:
        logger.warning(
            "[explanation] grounding repair dropped too much of the lesson"
        )
        return explanation

    after = study_grounding.audit_explanation(repaired, raw_text, figure_text)
    if after["clean"]:
        logger.info("[explanation] grounding repair finished the job")
    else:
        logger.info(
            "[explanation] grounding repair left %s unverified numbers, "
            "%s unsupported calculations, %s unsupported figures",
            len(after["unverified_numbers"]),
            len(after["unsupported_calculations"]),
            len(after["unsupported_figures"]),
        )
    return repaired


# Kept in step with NARRATION_LEVEL_GUIDANCE in app/ai/prompts.py so the
# lesson the student reads and the lesson they hear are pitched the
# same way.
_LEVEL_GUIDANCE = {
    "primary": (
        "The student is learning this for the first time, and may not even "
        "know what the words mean. Write for someone who has never seen the "
        "subject.\n"
        "- One idea at a time. Short sentences. A sentence the student cannot "
        "read aloud in one breath is two sentences.\n"
        "- Say what a thing IS before you say what it is CALLED. \"The part "
        "that catches light (chlorophyll)\" comes before \"chlorophyll\".\n"
        "- Use an everyday comparison for anything abstract. \"Imagine you are "
        "sharing five apples between two friends\" beats \"consider the "
        "distribution of a fixed quantity\".\n"
        "- Before any formula or calculation, say what each letter stands "
        "for, in words, one by one.\n"
        "- For every step of a calculation, say what that line is doing, not "
        "just what it says.\n"
        "- Say the answer in words as well as in numbers. \"So the maximum "
        "value is 14\" is clearer than \"= 14\".\n"
        "- If a word is hard, use the easy word first and put the hard word "
        "in brackets afterwards.\n"
        "- Never assume the student knows a symbol. Write what it stands for."
    ),
    "secondary": (
        "The student is studying this for an exam. Clear, detailed, and "
        "practical.\n"
        "- Short-to-medium sentences, and no unnecessary jargon.\n"
        "- Before a formula, say what each letter stands for.\n"
        "- Walk through every calculation step by step, saying what each "
        "line does.\n"
        "- Give a real-world use where the material makes one possible.\n"
        "- Say the answer in words as well as in numbers."
    ),
    "tertiary": (
        "The student is at university. Use the correct technical term "
        "straight away, and be precise about conditions, domains and "
        "assumptions.\n"
        "- Keep the derivations complete.\n"
        "- Say why a method is chosen over its alternatives.\n"
        "- Distinguish what the material states from what follows from it."
    ),
    "research": (
        "The student is a researcher. Cover assumptions, trade-offs, "
        "confounding factors and edge cases.\n"
        "- Name the technique and the conditions under which it holds.\n"
        "- Point at what the material does not settle."
    ),
}
