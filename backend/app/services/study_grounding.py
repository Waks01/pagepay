"""Checking that the teaching layer is actually supported by the material.

A lesson that is wrong is worse than no lesson. A student is told
"the vertex is at (-1, 2)", believes it, and then gets it wrong in an
exam — and they have no way of knowing the app made it up.

The lesson is written by a model from the material, and a model that
is asked to explain will sometimes add something: a number it read
wrong, a result it worked out wrongly, an example the material never
had. So the lesson is checked.

The check is in two parts, and the division of labour matters:

* **A deterministic pass** finds the claims that cannot be supported.
  It cannot judge them — a number in a worked example is often an
  intermediate result that is legitimately not in the source — but it
  can point at them.
* **A repair pass** then rewrites the lesson, keeping what is sound
  and fixing or removing what is not.

The repair is one extra call. It is worth it: the lesson is the thing
the student is taught from, the thing the quiz is written against, and
the thing the narration speaks. If it is not grounded, all three are
wrong in the same way.
"""

from __future__ import annotations

import re

# The blocks that make factual claims. A tip or a warning may well
# contain an everyday number used in an analogy ("if you had five
# apples"), and that is not a claim about the material.
_FACTUAL_BLOCK_TYPES = frozenset(
    {"body", "definition", "statement", "formula", "calculation", "table"}
)

# A number, with an optional sign and optional decimal part.
_NUMBER = re.compile(r"-?\d+(?:\.\d+)?")

# A run of characters that could be a number. OCR reads a 1 as a
# lower-case l, an upper-case I or a pipe, and a 0 as a capital O, so
# those letters are allowed inside a number-like token.
_NUMBER_TOKEN = re.compile(r"[0-9OoIl|]+(?:\.[0-9OoIl|]+)?")

# The characters OCR confuses with digits. The mapping is only applied
# inside a number-like token: "formula" has an o in it, and that is
# not a zero.
_LOOKALIKE_DIGITS = str.maketrans(
    {
        "l": "1",
        "I": "1",
        "|": "1",
        "O": "0",
        "o": "0",
    }
)


def _normalise_digits(text: str) -> str:
    """Fold the characters OCR confuses with digits."""
    return (text or "").translate(_LOOKALIKE_DIGITS)


def numbers_in(text: str) -> set[str]:
    """Every number in a piece of text, normalised.

    "14", "14.0" and "l4" are the same number as far as this check
    is concerned, and "-3" and "−3" are the same too.
    """
    if not text:
        return set()
    folded = (text or "").replace("−", "-").replace("–", "-")
    found = set()
    for match in _NUMBER_TOKEN.finditer(folded):
        token = match.group(0)
        # A token only counts as a number when it holds a real digit.
        # "formula" contains an o; that is a letter, not a zero.
        if not any(character.isdigit() for character in token):
            continue
        digits = token.translate(_LOOKALIKE_DIGITS)

        # A sign immediately before the token makes it negative — but
        # only when it is not a subtraction, as in "a-1".
        start = match.start()
        if start > 0 and folded[start - 1] == "-":
            before = folded[start - 2] if start >= 2 else ""
            if not before.isalpha():
                digits = "-" + digits

        try:
            number = float(digits)
        except ValueError:
            continue
        if number == int(number):
            found.add(str(int(number)))
        else:
            found.add(f"{number:g}")
    return found


def _block_text(block: dict) -> str:
    """All the text in a block, whatever shape it is."""
    parts: list[str] = []
    for key in ("text", "description", "caption", "term"):
        value = block.get(key)
        if isinstance(value, str) and value:
            parts.append(value)
    for key in ("items", "steps"):
        values = block.get(key)
        if isinstance(values, list):
            parts.extend(v for v in values if isinstance(v, str))
    for key in ("headers",):
        values = block.get(key)
        if isinstance(values, list):
            parts.extend(v for v in values if isinstance(v, str))
    rows = block.get("rows")
    if isinstance(rows, list):
        for row in rows:
            if isinstance(row, list):
                parts.extend(str(c) for c in row)
    return " ".join(parts)


def find_unverified_numbers(
    explanation: dict,
    source_text: str,
) -> list[str]:
    """Numbers in the lesson that the material does not contain.

    A number that is nowhere in the material is a candidate for having
    been made up. It is a *candidate*: the number in the middle of a
    worked example is often an intermediate result that is legitimately
    new, and the number in an everyday analogy is deliberately not in
    the source. The repair pass decides.
    """
    source_numbers = numbers_in(source_text)
    if not source_numbers:
        return []

    suspects: list[str] = []
    seen: set[str] = set()

    for block in explanation.get("blocks") or []:
        if not isinstance(block, dict):
            continue
        if (block.get("type") or "") not in _FACTUAL_BLOCK_TYPES:
            continue

        text = _block_text(block)
        if not text:
            continue

        for number in numbers_in(text):
            if number in source_numbers:
                continue
            if number in seen:
                continue
            seen.add(number)
            suspects.append(number)

    return sorted(suspects, key=lambda n: (len(n), n))


def find_unsupported_calculation_results(
    explanation: dict,
    source_text: str,
) -> list[str]:
    """Worked examples whose final result is not in the material.

    A calculation is the easiest thing to get wrong and the most
    damaging to get wrong, because the student is shown the steps and
    the answer. If the answer the lesson gives is not the answer the
    material gives, the lesson is teaching a wrong answer.
    """
    source_numbers = numbers_in(source_text)
    if not source_numbers:
        return []

    problems: list[str] = []
    for block in explanation.get("blocks") or []:
        if not isinstance(block, dict):
            continue
        if (block.get("type") or "") != "calculation":
            continue
        steps = [s for s in (block.get("steps") or []) if isinstance(s, str)]
        if not steps:
            continue
        final = steps[-1]
        result_numbers = numbers_in(final)
        if not result_numbers:
            continue
        # Every number in the final line should be in the material.
        # The ones that are not are the lesson's own arithmetic, and
        # they are exactly what can go wrong.
        unsupported = [n for n in result_numbers if n not in source_numbers]
        if unsupported:
            problems.append(
                f"{final.strip()[:120]} (unsupported: {', '.join(sorted(unsupported))})"
            )
    return problems


def find_unsupported_figures(
    explanation: dict,
    figure_text: str,
) -> list[str]:
    """Figure blocks that say more than the figure description said.

    The description of a picture is the only thing known about it. If
    the lesson adds a coordinate, a value or a shape that the
    description did not mention, it has been guessed.
    """
    known = numbers_in(figure_text)
    problems: list[str] = []

    for block in explanation.get("blocks") or []:
        if not isinstance(block, dict):
            continue
        if (block.get("type") or "") != "figure":
            continue
        text = _block_text(block)
        if not text:
            continue
        unsupported = [n for n in numbers_in(text) if n not in known]
        if unsupported:
            problems.append(
                f"Figure {block.get('figure_index', '?')}: "
                f"{text.strip()[:120]} (unsupported: {', '.join(sorted(unsupported))})"
            )
    return problems


def audit_explanation(
    explanation: dict,
    source_text: str,
    figure_text: str = "",
) -> dict:
    """Everything suspicious in the lesson, in one place.

    An empty result means the lesson makes no claim that the material
    does not support.
    """
    unverified = find_unverified_numbers(explanation, source_text)
    calculations = find_unsupported_calculation_results(explanation, source_text)
    figures = find_unsupported_figures(explanation, figure_text)
    return {
        "unverified_numbers": unverified,
        "unsupported_calculations": calculations,
        "unsupported_figures": figures,
        "clean": not (unverified or calculations or figures),
    }

