"""Canonical exam-type registry.

Single source of truth for the supported exam boards. Every layer that
needs the list or its per-board settings derives it from here:

- Pydantic schemas build their `Literal` from `EXAM_TYPE_KEYS`
- The exam router derives durations and question counts from
  `EXAM_TYPE_SPECS`
- The client mirrors `EXAM_TYPE_KEYS` and is kept in check by
  tests/test_exam.py::test_exam_types_match_client

Adding a board is a one-line change here; nothing else needs editing.
"""

from typing import Literal, NamedTuple

__all__ = [
    "EXAM_TYPE_SPECS",
    "EXAM_TYPE_KEYS",
    "ExamTypeKey",
    "normalize_exam_type",
    "EXAM_DURATIONS",
    "EXAM_QUESTION_COUNTS",
]


class ExamTypeSpec(NamedTuple):
    """Per-board exam configuration."""

    # Stable identifier stored in the DB and sent over the wire.
    key: str
    # Human label shown on chips. Translated client-side, so this is the
    # English fallback only.
    label: str
    # Minutes allowed for the whole attempt.
    duration_minutes: int
    # How many MCQs the generator should produce.
    question_count: int


EXAM_TYPE_SPECS: tuple[ExamTypeSpec, ...] = (
    ExamTypeSpec("jamb", "JAMB", 20, 20),
    ExamTypeSpec("waec", "WAEC", 25, 20),
    ExamTypeSpec("neco", "NECO", 25, 20),
    ExamTypeSpec("nabteb", "NABTEB", 25, 20),
    ExamTypeSpec("custom", "Custom", 10, 10),
)

#: Valid keys, in display order.
EXAM_TYPE_KEYS: tuple[str, ...] = tuple(spec.key for spec in EXAM_TYPE_SPECS)

#: Literal alias for Pydantic fields that must reject unknown values.
ExamTypeKey = Literal["jamb", "waec", "neco", "nabteb", "custom"]

_EXAM_TYPE_SET = frozenset(EXAM_TYPE_KEYS)

# Minutes per attempt, keyed by exam type. Derived from the registry.
EXAM_DURATIONS: dict[str, int] = {
    spec.key: spec.duration_minutes for spec in EXAM_TYPE_SPECS
}

# Question count per attempt, keyed by exam type. Derived from the registry.
EXAM_QUESTION_COUNTS: dict[str, int] = {
    spec.key: spec.question_count for spec in EXAM_TYPE_SPECS
}


def normalize_exam_type(value: str | None) -> str | None:
    """Coerce user input to a canonical exam-type key.

    Accepts any casing and surrounding whitespace so "JAMB", " jamb "
    and "Waec" all resolve correctly. Returns None for empty/None input,
    which is the valid "no exam type" state.

    Raises ValueError for a value that is not a known board, so callers
    can surface a clear 422 rather than storing data that the exam
    endpoints would later reject.
    """
    if value is None:
        return None
    key = value.strip().lower()
    if not key:
        return None
    if key not in _EXAM_TYPE_SET:
        raise ValueError(
            f"Unknown exam type {value!r}. Expected one of: "
            + ", ".join(EXAM_TYPE_KEYS)
        )
    return key
