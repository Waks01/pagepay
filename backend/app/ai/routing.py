"""Route chat turns between a cheap model and a premium one.

Student questions split cleanly into two kinds. *"What is osmosis?"* is a
definition the cheap model answers correctly. *"Why does a cell burst in
distilled water but a plant cell doesn't?"* needs reasoning, and a wrong
answer there costs a student an exam question.

**The classifier is deliberately rule-based.** Routing with an LLM call
would cost more than the turn it is trying to save, add latency to every
question, and introduce a second failure mode. Heuristics on the question
text are deterministic, free, and testable.

**The default is premium.** When a rule is uncertain, or the question does
not look like a simple lookup, we pay for the better model. A cheap wrong
answer is worse than an expensive right one — that asymmetry is the whole
design.

The target split is 70% standard / 30% premium (RAITHub's 70/20/10 shape,
collapsed to two tiers). The heuristics below should land near that on real
traffic; the actual share is logged per call so the rules can be tuned
against data rather than guesses.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

__all__ = ["RouteDecision", "classify_turn", "STANDARD", "PREMIUM"]

STANDARD = "standard"
PREMIUM = "premium"

# Question words and phrasings that signal reasoning rather than recall.
# "Explain"/"why"/"how" still appears in recall questions ("explain the
# term X"), so these move a question toward premium but do not decide it
# on their own — see the scoring below.
_REASONING_MARKERS = (
    "why",
    "how come",
    "how does",
    "how do",
    "how can",
    "how is",
    "how are",
    "how would",
    "explain",
    "compare",
    "contrast",
    "difference between",
    "distinguish",
    "analyse",
    "analyze",
    "evaluate",
    "justify",
    "predict",
    "what would happen",
    "what happens if",
    "derive",
    "prove",
    "calculate",
    "solve",
    "which of the following is false",
    "which of the following is not",
    "best explains",
    "most likely",
)

# Explicit recall patterns. These are strong enough on their own to route
# to the cheap model, because they ask for a term, a date, a name, or a
# definition — exactly what the cheap model is good at.
_RECALL_PATTERNS = (
    r"\bwhat is (a |an |the )?\w[\w\s]{0,40}\??$",
    r"\bwhat are (a |an |the )?\w[\w\s]{0,40}\??$",
    r"\bdefine \w[\w\s]{0,40}\??$",
    r"\bwhat does \w[\w\s]{0,40}\bmean\??$",
    r"\bwho (is|was|are|were) \w[\w\s]{0,40}\??$",
    r"\bwhen (is|was|did|does) \w[\w\s]{0,40}\??$",
    r"\bwhere (is|are|did|does) \w[\w\s]{0,40}\??$",
    r"\bgive (me )?(an?|the) (example|definition|name|list) of \w[\w\s]{0,60}\??$",
    r"\blist (the )?\w[\w\s]{0,60}\??$",
    r"\bname (the )?\w[\w\s]{0,60}\??$",
    r"\bwhich (one|term|organ|cell|part) (is|are) \w[\w\s]{0,40}\??$",
)

# The recall patterns above are anchored to end-of-string, so they only
# match a question that is *nothing but* a lookup. "Define mitosis. When
# does it occur?" ends with a second sentence, so the anchor fails — good,
# because that question needs reasoning to connect the two parts.
#
# These patterns therefore intentionally do NOT match compound questions.
# A recall form followed by more text must not count as a recall match:
# anchoring to `$` is what makes "define X" safe while "define X, and also
# why Y" is not.

# A short question with none of these is almost always a lookup.
# Anchored at both ends: a recall pattern must describe the WHOLE
# question, not just its last clause. Without `^`, "Define mitosis. When
# does it occur?" matched the recall pattern on "when does ...?" alone and
# was routed cheap despite being a compound reasoning question.
_RECALL_COMPILED = tuple(
    re.compile("^" + p + "$", re.I) for p in _RECALL_PATTERNS
)

# Questions that ask for several things at once need the model to hold
# them together and connect them — premium work.
_MULTI_PART = re.compile(
    r"(?:\band\b.{0,30}\b(also|then|finally)\b)"
    r"|(?:\?.*\?)"
    r"|\b(first|second|third|finally),?\s",
    re.I | re.S,
)

# Numeric or symbolic content implies working through steps.
_HAS_NUMBERS = re.compile(r"\d")
_HAS_FORMULA = re.compile(r"[=+\-*/^]|\b(sqrt|log|ln|sin|cos|tan)\b", re.I)

# Long questions carry more context and are more likely to be compound.
_LONG_QUESTION_CHARS = 220

# A sentence end followed by more prose. Matches ". ", "! ", "? " and
# ".\n" but not an abbreviation-style lone period, and requires real
# content after the boundary.
_SENTENCE_BOUNDARY = re.compile(r"[.!?]\s+[A-Za-z]")

# A comma joining two interrogative clauses: "Who discovered penicillin,
# and what was it used for?" Both halves are simple, but answering them
# means connecting a person to a use — reasoning work.
_CLAUSE_SPLIT = re.compile(
    r",\s+(?:and\s+|but\s+|then\s+)?(?:what|who|when|where|why|how|which)\b",
    re.I,
)


@dataclass(frozen=True)
class RouteDecision:
    """Which model a turn should go to, and why."""

    model_tier: str
    reason: str
    score: int

    @property
    def is_premium(self) -> bool:
        return self.model_tier == PREMIUM


def classify_turn(question: str, *, material_title: str | None = None) -> RouteDecision:
    """Decide whether a question needs the premium model.

    Returns a `RouteDecision` carrying the tier and a human-readable
    reason, so the routing can be logged and audited. Never raises —
    an unclassifiable question routes to premium.

    Scoring: start neutral, recall patterns pull toward standard,
    reasoning markers and compound structure push toward premium. The
    threshold is set so an explicit recall pattern wins unless something
    else also looks reasoning-heavy.
    """
    text = (question or "").strip()
    if not text:
        # Nothing to classify; an empty question is a client error, and
        # premium gives the most useful error response.
        return RouteDecision(PREMIUM, "empty_question", 0)

    lowered = text.lower()
    score = 0
    reasons: list[str] = []

    # ── Pull toward standard ────────────────────────────────────────
    if any(pattern.search(lowered) for pattern in _RECALL_COMPILED):
        score -= 3
        reasons.append("recall_pattern")

    word_count = len(lowered.split())
    # Very short questions with no reasoning marker are lookups.
    # Requires real words: "?" or "help" is a client error, not a
    # question, and should get the better model's response.
    if (
        word_count >= 3
        and len(lowered) < 60
        and not any(m in lowered for m in _REASONING_MARKERS)
    ):
        score -= 2
        reasons.append("short_simple")

    # ── Push toward premium ─────────────────────────────────────────
    for marker in _REASONING_MARKERS:
        if marker in lowered:
            score += 2
            reasons.append(f"marker:{marker}")
            break

    if _MULTI_PART.search(text):
        score += 2
        reasons.append("multi_part")

    # Two or more sentences means the model has to hold the first part
    # while answering the second. "Define mitosis. When does it occur?"
    # is not a lookup even though each half looks simple.
    if _SENTENCE_BOUNDARY.search(text):
        score += 2
        reasons.append("multi_sentence")

    # A comma joining two question clauses is compound for the same
    # reason, and needs its own rule because no sentence punctuation
    # appears.
    if _CLAUSE_SPLIT.search(text):
        score += 2
        reasons.append("clause_split")

    if _HAS_FORMULA.search(text):
        score += 2
        reasons.append("formula")

    if _HAS_NUMBERS.search(text) and len(lowered) > 80:
        score += 1
        reasons.append("numeric")

    if len(lowered) > _LONG_QUESTION_CHARS:
        score += 2
        reasons.append("long")

    # A question that asks the tutor to take a role or apply knowledge
    # in a scenario is reasoning, not recall.
    if re.search(r"\b(if|suppose|imagine|assume)\b", lowered) and len(lowered) > 60:
        score += 2
        reasons.append("hypothetical")

    tier = PREMIUM if score >= 0 else STANDARD
    reason = "+".join(reasons) if reasons else "neutral"
    return RouteDecision(tier, reason, score)


def route_budget_seconds() -> float:
    """Telemetry hook: share of turns that should land on standard."""
    from app.config import settings

    return settings.ai_standard_share_target
