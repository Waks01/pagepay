"""Tests for paid audio narration: pricing, topic mapping, level scaling.

These cover the pure logic — the money maths and the topic→block mapping
— without a database or a live model. Billing, refunds, and the worker
are exercised through `tests/test_services_extra.py`-style fixtures if a
DB is available.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services import audio_pricing, r2_storage, study_narration
from app.config import settings

import pytest


PARSED = {
    "topics": [
        {"name": "Cell Structure", "subtopics": ["Nucleus"]},
        {"name": "Photosynthesis", "subtopics": ["Light reactions"]},
    ],
    "content_blocks": [
        {"type": "heading", "level": 1, "text": "Cell Structure"},
        {"type": "body", "text": "The cell is the basic unit of life."},
        {"type": "warning", "label": "Caution", "text": "Membrane is not the wall."},
        {"type": "heading", "level": 1, "text": "Photosynthesis"},
        {"type": "body", "text": "Plants turn light into energy."},
        {"type": "formula", "text": "6CO2+6H2O",
         "description": "six carbon dioxide plus six water"},
        {"type": "code", "language": "python", "text": "print(1)"},
    ],
}


# ── Level handling ─────────────────────────────────────────────────


def test_unknown_level_falls_back_to_default():
    assert audio_pricing.normalise_level("galaxy") == audio_pricing.DEFAULT_LEVEL
    assert audio_pricing.normalise_level(None) == audio_pricing.DEFAULT_LEVEL


def test_valid_levels_are_preserved():
    for level in audio_pricing.VALID_LEVELS:
        assert audio_pricing.normalise_level(level) == level


# ── Pricing ────────────────────────────────────────────────────────


def test_cost_scales_with_level():
    """Deeper explanations produce longer scripts, so they cost more."""
    costs = [audio_pricing.quote_cost(level, 2000) for level in audio_pricing.VALID_LEVELS]
    assert costs == sorted(costs)
    assert len(set(costs)) == len(costs)


def test_cost_scales_with_characters():
    low = audio_pricing.quote_cost("secondary", 500)
    high = audio_pricing.quote_cost("secondary", 5000)
    assert high > low


def test_empty_request_is_free():
    assert audio_pricing.quote_cost("primary", 0) == 0


def test_quote_breakdown_is_internally_consistent():
    quote = audio_pricing.quote_detailed("secondary", 1500)
    assert quote["cost_sv"] == quote["base_sv"] + quote["steps"] * quote["rate_sv"]
    assert quote["episodes"] >= 1
    assert quote["estimated_seconds"] > 0


def test_estimate_reflects_output_not_source():
    """Duration follows the generated script, not the source length."""
    small = audio_pricing.estimate_output_chars(100)
    large = audio_pricing.estimate_output_chars(6000)
    # Narration expands on its source but is bounded.
    assert small > 100
    assert large <= audio_pricing.MAX_OUTPUT_CHARS


# ── Episode splitting ──────────────────────────────────────────────


def test_short_topic_is_one_episode():
    assert audio_pricing.split_into_episodes(500) == 1
    assert audio_pricing.split_into_episodes(6000) == 1


def test_long_topic_splits_into_multiple_episodes():
    """A long topic becomes several 5-10 minute episodes, not one file."""
    assert audio_pricing.split_into_episodes(12000) > 1
    assert audio_pricing.split_into_episodes(20000) > 2


def test_never_zero_episodes_for_content():
    assert audio_pricing.split_into_episodes(1) == 1


# ── Topic → block mapping ──────────────────────────────────────────


def test_each_topic_gets_only_its_own_blocks():
    """A heading matching a topic name starts that topic's section."""
    first = study_narration.build_topic_source(PARSED, 0)
    second = study_narration.build_topic_source(PARSED, 1)
    assert "Cell Structure" in first
    assert "Photosynthesis" not in first
    assert "Photosynthesis" in second
    assert "Cell Structure" not in second
    assert first != second


def test_formula_uses_spoken_description():
    source = study_narration.build_topic_source(PARSED, 1)
    assert "six carbon dioxide plus six water" in source
    assert "6CO2+6H2O" in source


def test_code_is_flagged_not_recited():
    source = study_narration.build_topic_source(PARSED, 1)
    assert "describe, do not recite" in source
    assert "print(1)" not in source


def test_out_of_range_topic_returns_empty():
    assert study_narration.build_topic_source(PARSED, 99) == ""


def test_flat_material_without_topics():
    """A material with no parsed topics is treated as one topic."""
    flat = {"content_blocks": [{"type": "body", "text": "Just some text."}]}
    assert study_narration.build_topic_source(flat, 0) == "Just some text."
    assert study_narration.topic_count(flat) == 1


def test_flat_blocks_split_evenly_across_topics():
    """When no heading matches, blocks are distributed so no topic is starved."""
    doc = {
        "topics": [{"name": "A"}, {"name": "B"}],
        "content_blocks": [
            {"type": "body", "text": "one"},
            {"type": "body", "text": "two"},
            {"type": "body", "text": "three"},
            {"type": "body", "text": "four"},
        ],
    }
    first = study_narration.build_topic_source(doc, 0)
    second = study_narration.build_topic_source(doc, 1)
    assert first and second
    assert first != second


# ── Episode splitting within a topic ───────────────────────────────


def _multi_block_topic(count: int, filler: str) -> dict:
    return {
        "topics": [{"name": "Big", "subtopics": ["A"]}],
        "content_blocks": [
            {"type": "body", "text": "%s %d" % (filler, i)} for i in range(count)
        ],
    }


def test_episode_slices_are_distinct_and_cover_everything():
    """A multi-episode topic must not narrate the same text twice."""
    doc = _multi_block_topic(10, "block")
    slices = [study_narration.build_episode_source(doc, 0, i, 3) for i in range(3)]
    assert len(set(slices)) == 3
    joined = " ".join(slices)
    for i in range(10):
        assert ("block %d" % i) in joined


def test_episode_count_is_capped_by_block_count():
    """A single huge block cannot be split into empty episodes."""
    doc = {"topics": [{"name": "One"}],
           "content_blocks": [{"type": "body", "text": "y " * 20000}]}
    plan = study_narration.topic_episode_plan(doc, 0)
    # The character count alone would suggest many episodes.
    assert audio_pricing.split_into_episodes(plan["char_count"]) > 1
    assert plan["episodes"] == 1


def test_single_episode_gets_the_whole_topic():
    doc = {"topics": [{"name": "S"}],
           "content_blocks": [{"type": "body", "text": "x"}, {"type": "body", "text": "y"}]}
    assert study_narration.build_episode_source(doc, 0, 0, 1) == "x\n\ny"


# ── R2 storage ─────────────────────────────────────────────────────


def _configure_r2(monkeypatch):
    monkeypatch.setattr(settings, "cloudflare_access_key", "acct")
    monkeypatch.setattr(settings, "cloudflare_secret_access_key", "key")
    monkeypatch.setattr(settings, "cloudflare_s3_api_endpoint", "https://acct.r2.cloudflarestorage.com")
    monkeypatch.setattr(settings, "cloudflare_r2_bucket", "pagepay-audio")


def test_r2_unconfigured_is_reported_not_guessed(monkeypatch):
    """Without configuration, generation must refuse rather than use /tmp."""
    monkeypatch.setattr(settings, "cloudflare_access_key", None)
    monkeypatch.setattr(settings, "cloudflare_secret_access_key", None)
    monkeypatch.setattr(settings, "cloudflare_s3_api_endpoint", None)
    monkeypatch.setattr(settings, "cloudflare_r2_bucket", "pagepay-audio")
    assert r2_storage.is_configured() is False
    with pytest.raises(r2_storage.R2NotConfigured):
        r2_storage.upload_bytes("study-audio/a.mp3", b"ID3xx")


def test_r2_upload_uses_bucket_key_and_cache_headers(monkeypatch):
    _configure_r2(monkeypatch)
    captured = {}

    class Client:
        def put_object(self, **kw):
            captured.update(kw)

    monkeypatch.setattr(r2_storage, "_client", lambda: Client())
    key = r2_storage.upload_bytes("study-audio/a.mp3", b"ID3xx")
    assert key == "study-audio/a.mp3"
    assert captured["Bucket"] == "pagepay-audio"
    assert captured["ContentType"] == "audio/mpeg"
    assert "immutable" in captured["CacheControl"]


def test_r2_audio_url_is_presigned(monkeypatch):
    _configure_r2(monkeypatch)
    captured = {}

    class Client:
        def generate_presigned_url(self, op, Params=None, ExpiresIn=None):
            captured.update(op=op, params=Params, expires=ExpiresIn)
            return "https://r2.example/obj?sig=1"

    monkeypatch.setattr(r2_storage, "_client", lambda: Client())
    url = r2_storage.audio_url_for("study-audio/a.mp3")
    assert url == "https://r2.example/obj?sig=1"
    assert captured["op"] == "get_object"
    assert captured["expires"] == settings.cloudflare_r2_presign_expiry_seconds


def test_cloudflare_r2_public_url_skips_presign(monkeypatch):
    _configure_r2(monkeypatch)
    monkeypatch.setattr(settings, "cloudflare_r2_public_url", "https://cdn.example.com")
    url = r2_storage.audio_url_for("study-audio/a.mp3")
    assert url == "https://cdn.example.com/study-audio/a.mp3"


def test_r2_object_key_cannot_escape_prefix():
    """A crafted filename must never write outside the bucket prefix."""
    assert r2_storage.object_key("../../etc/passwd") == "study-audio/passwd"
    assert r2_storage.object_key("a/b/c.mp3") == "study-audio/c.mp3"


def test_r2_empty_upload_is_refused(monkeypatch):
    _configure_r2(monkeypatch)
    monkeypatch.setattr(r2_storage, "_client", lambda: None)
    with pytest.raises(r2_storage.R2NotConfigured):
        r2_storage.upload_bytes("study-audio/a.mp3", b"")


# ── Narration pricing must clear Cloudflare cost ────────────────────


#: Cost in USD of producing 1,000 characters of narration at current
#: Cloudflare rates: MeloTTS $0.0002/audio-minute (~1.11 min per 1k chars
#: at the codebase's own 6 chars/word, 150 wpm assumption) plus GLM-4.7
#: output at $0.400/M tokens (~250 tokens per 1k chars).
COST_USD_PER_1K_CHARS = (1.11 * 0.0002) + (250 / 1_000_000 * 0.400)

#: Naira per USD, used only to express that cost in the unit SV is
#: priced in. CBN NFEM closing rate 9 Oct 2026. Refresh when the naira
#: moves materially — the assertion is about the rate being above cost,
#: not about this exact figure.
USD_TO_NGN = 1332.5


def test_marginal_revenue_covers_marginal_cost():
    """Every level's per-step rate must exceed the cost it pays for.

    `rate_sv` is charged per `char_step` (500) characters of generated
    script. At `points_per_naira` = 10, one SV is ₦0.10, so the floor is
    the naira cost of 500 characters converted to SV.
    """
    step = settings.audio_narration_char_step
    # Cost of `step` chars of narration, in naira.
    cost_naira = step / 1000 * COST_USD_PER_1K_CHARS * USD_TO_NGN
    cost_sv = cost_naira * settings.points_per_naira

    for level in audio_pricing.VALID_LEVELS:
        rate = settings.audio_narration_rate_sv[level]
        assert rate > cost_sv, (
            f"{level}: rate {rate} SV does not cover marginal cost "
            f"≈{cost_sv:.2f} SV "
            f"({step} chars ≈ ₦{cost_naira:.3f} at "
            f"{settings.points_per_naira} SV/₦)"
        )


def test_primary_is_not_the_cheapest_below_cost():
    """The cheapest tier must not be the one that loses money."""
    rates = settings.audio_narration_rate_sv
    # With the fix, primary ties secondary; both must be >= the floor.
    assert rates["primary"] >= 6


def test_quote_bills_on_output_not_source():
    """`quote()` must charge for generated characters, not source ones.

    Billing on source under-charged by ~2x, because
    `estimate_output_chars` expands source into a longer script.
    """
    from app.services import study_audio_service

    # A topic with ~1,200 source chars estimates to min(5400, max(600,
    # 2400)) = 2,400 output chars.
    parsed = {
        "topics": [{"name": "T", "subtopics": ["s"], "key_concepts": ["c"]}],
        "content_blocks": [
            {"type": "heading", "text": "T"},
            {"type": "body", "text": "x" * 1200},
        ],
    }
    from app.services import study_audio_service, study_narration

    parsed = {
        "topics": [{"name": "T", "subtopics": ["s"], "key_concepts": ["c"]}],
        "content_blocks": [
            {"type": "heading", "text": "T"},
            {"type": "body", "text": "x" * 1200},
        ],
    }
    source_chars = study_narration.topic_episode_plan(parsed, 0)["char_count"]

    quote = study_audio_service.quote(
        parsed_structure=parsed, topic_indexes=[0], level="secondary"
    )
    billed = quote["topics"][0]["char_count"]
    # Billing on the rendered source length would give ~1.2k; billing on
    # output gives the 2x-expanded estimate.
    assert billed > source_chars, f"billed {billed} <= source {source_chars}"
    assert billed == audio_pricing.billing_chars(source_chars, 1)
    # One episode, so it stays within a single episode's cap.
    assert billed <= audio_pricing.MAX_OUTPUT_CHARS


def test_quote_scales_with_episode_count():
    """A topic split into N episodes bills for N episodes of script.

    `estimate_output_chars` caps per topic at MAX_OUTPUT_CHARS, but N
    episodes generate up to N x that cap. Without scaling by episode
    count, long topics under-bill.
    """
    from app.services import study_audio_service

    blocks = [{"type": "heading", "text": "T"}]
    # Plenty of source so the topic splits into several episodes.
    blocks.append({"type": "body", "text": "y" * 20000})
    parsed = {
        "topics": [{"name": "T", "subtopics": ["s"], "key_concepts": ["c"]}],
        "content_blocks": blocks,
    }
    quote = study_audio_service.quote(
        parsed_structure=parsed, topic_indexes=[0], level="secondary"
    )
    topic = quote["topics"][0]
    assert topic["episodes"] > 1
    # Billing must scale past a single episode's worth of script.
    assert topic["char_count"] > audio_pricing.MAX_OUTPUT_CHARS


def test_billing_chars_scales_linearly_with_episodes():
    """Each extra episode adds one cap's worth of billable script."""
    assert audio_pricing.billing_chars(2000, 1) <= audio_pricing.MAX_OUTPUT_CHARS
    two = audio_pricing.billing_chars(2000, 2)
    three = audio_pricing.billing_chars(2000, 3)
    assert two == 2 * audio_pricing.MAX_OUTPUT_CHARS
    assert three == 3 * audio_pricing.MAX_OUTPUT_CHARS
    assert three > two > 0


def test_billing_chars_empty_is_free():
    assert audio_pricing.billing_chars(0, 1) == 0
    assert audio_pricing.billing_chars(0, 4) == 0


def test_points_and_sv_share_one_rate():
    """SV and wallet points are the same currency at the same rate.

    `service_credit_balance` is debited via `kobo_to_points`, so
    renaming the display unit to SV must not imply a different rate.
    """
    from app.services.money import kobo_to_points

    # ₦100 → 1,000 points at the default 10 points per naira.
    assert kobo_to_points(10000) == 1000
    assert settings.points_per_naira == 10
# ── Material context: budget-based, never omitted ───────────────────


_PARSED_FOR_CONTEXT = (
    '{"topics": [{"name": "Cell Structure", '
    '"subtopics": ["Membrane"], '
    '"key_concepts": ["Osmosis"]}]}'
)
_RAW_FOR_CONTEXT = (
    "The cell membrane is selectively permeable. Water moves across it "
    "by osmosis, from a dilute solution to a concentrated one. This is "
    "why a red blood cell bursts in distilled water."
)


def test_full_material_reaches_the_tutor():
    """The tutor must see the student's material, not just headings.

    Chat used to send only the topic outline — a table of contents — so
    the model could not answer questions about the text it was supposed
    to teach.
    """
    from app.routers.study import build_material_context

    ctx = build_material_context(
        _PARSED_FOR_CONTEXT,
        _RAW_FOR_CONTEXT,
        budget=100_000,
        outline_label="Outline:",
    )
    assert "Cell Structure" in ctx, "outline should be included too"
    assert "selectively permeable" in ctx, "the material text must be present"
    assert "osmosis" in ctx
    assert "red blood cell bursts" in ctx, "the tail of the material must be present"


def test_small_material_is_not_truncated():
    from app.routers.study import build_material_context

    ctx = build_material_context(
        _PARSED_FOR_CONTEXT,
        _RAW_FOR_CONTEXT,
        budget=100_000,
        outline_label="Outline:",
    )
    assert "truncated" not in ctx


def test_oversized_material_is_marked_not_silently_cut():
    """A sliced material must say so, or the model answers as if complete."""
    from app.routers.study import build_material_context, _CHAT_CONTEXT_CHARS

    big = _RAW_FOR_CONTEXT * 2000  # far beyond any budget
    ctx = build_material_context(
        _PARSED_FOR_CONTEXT,
        big,
        budget=_CHAT_CONTEXT_CHARS,
        outline_label="Outline:",
    )
    assert "truncated" in ctx
    assert len(ctx) < len(big)
    # Head is preserved: opening definitions survive.
    assert "selectively permeable" in ctx
    # Outline still arrives alongside the slice.
    assert "Cell Structure" in ctx


def test_material_only_material_falls_back_to_text():
    """No parsed structure must not mean no material."""
    from app.routers.study import build_material_context

    ctx = build_material_context(
        None,
        _RAW_FOR_CONTEXT,
        budget=100_000,
        outline_label="Outline:",
    )
    assert "selectively permeable" in ctx
    assert "Syllabus outline" not in ctx


def test_unparseable_parsed_structure_does_not_raise():
    """A corrupted parsed_structure must degrade, not 500 the tutor."""
    from app.routers.study import build_material_context

    ctx = build_material_context(
        "{not valid json",
        _RAW_FOR_CONTEXT,
        budget=100_000,
        outline_label="Outline:",
    )
    assert "selectively permeable" in ctx


def test_no_material_at_all_is_explicit():
    from app.routers.study import build_material_context

    ctx = build_material_context(
        None, "", budget=100_000, outline_label="Outline:"
    )
    assert "no study material" in ctx


def test_chat_budget_covers_a_full_text_upload():
    """The budget must exceed the 50k-char upload cap so text is never cut."""
    from app.routers.study import _CHAT_CONTEXT_CHARS

    # SowUploadRequest.text caps at 50k chars.
    assert _CHAT_CONTEXT_CHARS >= 50_000


def test_mcq_budget_is_tighter_than_chat():
    """MCQ generation can afford a smaller slice; chat needs the room."""
    from app.routers.study import _CHAT_CONTEXT_CHARS, _MCQ_CONTEXT_CHARS

    assert _MCQ_CONTEXT_CHARS < _CHAT_CONTEXT_CHARS