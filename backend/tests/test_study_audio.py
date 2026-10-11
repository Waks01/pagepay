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
