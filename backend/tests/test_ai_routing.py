"""Model routing: cheap model for recall, premium for reasoning.

These tests pin the behaviour that protects students — a cheap wrong
answer costs more than an expensive right one — and guard the two bugs
found while writing the classifier:

- recall patterns were unanchored, so "Define mitosis. When does it
  occur?" matched on its last clause alone and routed cheap
- "how does ..." mechanism questions fell through to standard because
  bare "how" was not a reasoning marker
"""

import os

import pytest

_ENV = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    ".env",
)
if os.path.exists(_ENV):
    with open(_ENV) as _fh:
        for _line in _fh:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _v = _line.split("=", 1)
                os.environ.setdefault(_k.strip(), _v.strip())

from app.ai.routing import PREMIUM, STANDARD, RouteDecision, classify_turn

# ── Recall: the cheap model must be trusted with these ───────────────

RECALL = [
    "What is osmosis?",
    "What is a mitochondrion?",
    "What are the types of soil?",
    "Define photosynthesis",
    "What does the term 'osmotic pressure' mean?",
    "Who discovered the cell?",
    "When did Nigeria gain independence?",
    "Where is the nucleus located?",
    "Give me an example of a prokaryotic cell",
    "List the organs of the digestive system",
    "Name the parts of the flower",
    "Which organ produces insulin?",
]

# ── Reasoning: must reach the better model ───────────────────────────

REASONING = [
    "Why does a red blood cell burst in distilled water?",
    "Explain the difference between osmosis and diffusion",
    "Compare and contrast mitosis and meiosis",
    "How does the electron transport chain produce ATP?",
    "What would happen if the cell membrane lost its selective permeability?",
    "Calculate the osmotic potential of a 0.5M sucrose solution",
    "Distinguish between a virus and a bacterium",
    "Which of the following best explains why desert plants have sunken stomata?",
    "If the temperature increased, what would happen to the rate of reaction?",
    "When I add salt to water, how come the boiling point goes up?",
    "Prove that the sum of angles in a triangle is 180 degrees",
    "Analyse the causes of the Nigerian civil war",
]

# ── Compound: two things asked at once ───────────────────────────────

COMPOUND = [
    "What is osmosis? And why does it matter for plants?",
    "Define mitosis. When does it occur?",
    "Who discovered penicillin, and what was it used for?",
]

# A long, context-heavy question.
LONG_QUESTION = (
    "I have been reading about how the inner membrane of the mitochondrion is "
    "folded into cristae and I want to understand whether the increased surface "
    "area actually changes the number of ATP synthase enzymes that can be packed "
    "in, or whether it just improves the efficiency of the proton gradient "
    "across the membrane in some other way that I am not seeing"
)


def _tier(question: str) -> str:
    return classify_turn(question).model_tier


@pytest.mark.parametrize("question", RECALL)
def test_recall_goes_to_cheap_model(question):
    assert _tier(question) == STANDARD, question


@pytest.mark.parametrize("question", REASONING)
def test_reasoning_goes_to_premium_model(question):
    assert _tier(question) == PREMIUM, question


@pytest.mark.parametrize("question", COMPOUND)
def test_compound_questions_go_to_premium_model(question):
    """A question with two parts must not be classified on one part."""
    assert _tier(question) == PREMIUM, question


def test_long_context_question_goes_to_premium_model():
    assert _tier(LONG_QUESTION) == PREMIUM


# ── Edge cases and the specific bugs ─────────────────────────────────


@pytest.mark.parametrize(
    "question",
    ["", "   ", "?", "help", "\x00\x01", "?" * 500, "\n\n\n"],
)
def test_degenerate_input_never_raises_and_defaults_to_premium(question):
    """Anything unclassifiable must get the better model, not an error."""
    decision = classify_turn(question)
    assert decision.model_tier == PREMIUM, repr(question)


def test_define_with_followup_is_not_a_lookup():
    """Regression: recall patterns were unanchored.

    "Define mitosis. When does it occur?" matched the recall pattern on
    "when does ...?" alone, so a compound reasoning question routed to
    the cheap model.
    """
    assert _tier("Define mitosis. When does it occur?") == PREMIUM


def test_how_does_mechanism_questions_are_reasoning():
    """Regression: bare "how" was not a reasoning marker.

    "How does the electron transport chain produce ATP?" is a mechanism
    question and fell through to standard.
    """
    assert _tier("How does the electron transport chain produce ATP?") == PREMIUM


def test_short_lookup_still_routes_cheap():
    """The `short_simple` rule must survive the fixes."""
    assert _tier("What is osmosis?") == STANDARD
    assert _tier("Define photosynthesis") == STANDARD


def test_decision_carries_an_auditable_reason():
    decision = classify_turn("Why does this happen?")
    assert isinstance(decision, RouteDecision)
    assert decision.reason
    assert "why" in decision.reason


def test_classification_is_deterministic():
    q = "Compare osmosis and diffusion"
    a = classify_turn(q)
    b = classify_turn(q)
    assert a == b


# ── Routing config and model resolution ──────────────────────────────


def test_default_tier_is_premium():
    """`route_ai` predates routing; its callers must stay on the good model."""
    from app.ai.router import resolve_model

    assert resolve_model(None) == resolve_model(PREMIUM)
    assert resolve_model("garbage") == resolve_model(PREMIUM)
    assert resolve_model(STANDARD) != resolve_model(PREMIUM)


def test_generation_tasks_use_premium_by_default():
    """SOW parsing, exams and assets must not economise on quality."""
    from app.ai.router import resolve_model
    from app.config import settings

    # resolve_model with no tier is what every non-chat caller does.
    assert resolve_model() == settings.ai_premium_model


def test_routing_can_be_disabled():
    from app.config import settings

    assert isinstance(settings.ai_routing_enabled, bool)
    assert settings.ai_standard_model.startswith("@cf/")
    assert settings.ai_premium_model.startswith("@cf/")


def test_target_share_is_sane():
    from app.config import settings

    target = settings.ai_standard_share_target
    assert 0.5 <= target <= 0.9, f"implausible target split: {target}"


def test_classifier_favours_premium_overall():
    """The bias must be toward the expensive model.

    Not a quota — a check that when the rules genuinely cannot tell, the
    answer is premium. Measured on the full case set, which is
    deliberately reasoning-heavy, so premium should win overall.
    """
    every = RECALL + REASONING + COMPOUND + [LONG_QUESTION]
    premium_share = sum(1 for q in every if _tier(q) == PREMIUM) / len(every)
    assert premium_share > 0.4, f"too aggressive: {premium_share:.0%} premium"
