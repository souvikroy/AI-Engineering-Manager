"""Pure-function tests for the meeting-transcript pipeline.

Covers:
- chunk_transcript      — speaker grouping + token-budget packing
- classify_meeting      — title regex hits without LLM (deterministic path)
- is_confidential_title — auto-confidential detection
- hmac_verify           — Fireflies-style hex digest verification
- fireflies._normalize  — provider payload → MeetingTranscript

No DB, no Anthropic, no Voyage — runs on `pytest tests/test_meetings.py`.
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from app.ingest.meetings import classify
from app.ingest.meetings.classify import classify_by_title, is_confidential_title
from app.ingest.meetings.fireflies import _normalize
from app.rag.chunk import chunk_transcript, token_count
from app.schemas.meetings import Participant
from app.security.hmac_verify import (
    hmac_sha256_hex,
    verify_bearer,
    verify_hmac_sha256,
)


# ─── chunk_transcript ────────────────────────────────────────────────────


def test_chunk_transcript_collapses_same_speaker():
    segs = [
        {"speaker": "engineer:eng_priya", "ts": 0, "text": "Yesterday I shipped the auth fix."},
        {"speaker": "engineer:eng_priya", "ts": 4, "text": "Today I'm starting on rate limiting."},
        {"speaker": "engineer:eng_ravi", "ts": 12, "text": "Blocked on the schema migration."},
    ]
    chunks = chunk_transcript(segs, target_tokens=800)
    assert len(chunks) == 1
    out = chunks[0]
    # Both Priya turns collapse into one block, Ravi gets his own block.
    assert out.count("[engineer:eng_priya") == 1
    assert "[engineer:eng_ravi" in out
    assert "rate limiting" in out
    assert "schema migration" in out


def test_chunk_transcript_breaks_on_speaker_boundary_under_budget():
    # Two speakers, total below the budget — still fits in one chunk.
    segs = [
        {"speaker": "engineer:a", "ts": 0, "text": "alpha bravo charlie"},
        {"speaker": "engineer:b", "ts": 5, "text": "delta echo foxtrot"},
    ]
    out = chunk_transcript(segs, target_tokens=500)
    assert len(out) == 1


def test_chunk_transcript_packs_then_overlaps_at_budget():
    # Force multiple chunks by setting a tiny budget, with three speakers.
    segs = [
        {"speaker": "engineer:a", "ts": 0, "text": "one " * 40},
        {"speaker": "engineer:b", "ts": 5, "text": "two " * 40},
        {"speaker": "engineer:c", "ts": 10, "text": "three " * 40},
    ]
    out = chunk_transcript(segs, target_tokens=60)
    assert len(out) >= 2
    # No chunk exceeds 850 tokens (target+overhead)
    assert all(token_count(c) <= 850 for c in out)
    # Overlap: last block of chunk N appears as first block of chunk N+1.
    for prev, nxt in zip(out, out[1:]):
        last_block_prev = prev.split("\n\n")[-1]
        first_block_next = nxt.split("\n\n")[0]
        assert last_block_prev == first_block_next, (
            "expected the last block of the previous chunk to overlap into the next"
        )


def test_chunk_transcript_drops_empty_segments():
    segs = [
        {"speaker": "engineer:a", "ts": 0, "text": "  "},
        {"speaker": "", "ts": 1, "text": "orphaned"},
        {"speaker": "engineer:a", "ts": 2, "text": "real content"},
    ]
    out = chunk_transcript(segs)
    assert len(out) == 1
    assert "real content" in out[0]
    assert "orphaned" not in out[0]


def test_chunk_transcript_preserves_speaker_prefix_format():
    segs = [
        {"speaker": "engineer:eng_priya", "ts": 134, "text": "we're blocked"},
    ]
    out = chunk_transcript(segs)
    assert out and out[0].startswith("[engineer:eng_priya @02:14] we're blocked")


# ─── classify ────────────────────────────────────────────────────────────


def _p(name: str, n: int = 1) -> list[Participant]:
    return [Participant(name=f"{name}{i}", email=f"{name.lower()}{i}@co.com") for i in range(n)]


def test_classify_standup_by_title():
    assert classify_by_title("Daily standup — 2026-05-01", _p("X", 5)) == "standup"
    assert classify_by_title("Stand-up", _p("X", 5)) == "standup"
    assert classify_by_title("Daily sync", _p("X", 5)) == "standup"


def test_classify_1on1_by_title_with_two_participants():
    assert classify_by_title("1:1 with Priya", _p("X", 2)) == "1on1"
    assert classify_by_title("Priya / Souvik 1on1", _p("X", 2)) == "1on1"


def test_classify_planning_retro_review():
    assert classify_by_title("Sprint planning Q2W3", _p("X", 7)) == "planning"
    assert classify_by_title("Q2 retro", _p("X", 7)) == "retro"
    assert classify_by_title("Stakeholder review", _p("X", 7)) == "review"
    assert classify_by_title("Friday demo", _p("X", 7)) == "demo"


def test_classify_two_person_meeting_defaults_to_1on1():
    assert classify_by_title("Project sync", _p("X", 2)) == "1on1"


def test_classify_unknown_title_returns_none_for_haiku_fallback():
    assert classify_by_title("All hands", _p("X", 25)) is None


def test_is_confidential_title_hits_keywords():
    assert is_confidential_title("Q2 performance review — Priya") is True
    assert is_confidential_title("Priya — Comp discussion") is True
    assert is_confidential_title("HR sync: PIP plan") is True
    assert is_confidential_title("Exit interview") is True


def test_is_confidential_title_safe_negatives():
    assert is_confidential_title("Daily standup") is False
    assert is_confidential_title("Sprint planning") is False
    assert is_confidential_title("Architecture review") is False  # 'review' alone is fine


def test_classify_meeting_async_uses_title_first(monkeypatch):
    async def boom(*_a, **_kw):
        raise AssertionError("Haiku should not be called when title regex hits")

    monkeypatch.setattr(classify, "_classify_with_haiku", boom)
    out = asyncio.run(classify.classify_meeting("Daily standup", _p("X", 5)))
    assert out == "standup"


# ─── HMAC verifier ───────────────────────────────────────────────────────


def test_verify_hmac_sha256_accepts_correct_signature():
    body = b'{"meetingId":"abc"}'
    secret = "shh"
    sig = hmac_sha256_hex(secret, body)
    assert verify_hmac_sha256(secret, body, sig) is True


def test_verify_hmac_sha256_rejects_tampered_body():
    body = b'{"meetingId":"abc"}'
    secret = "shh"
    sig = hmac_sha256_hex(secret, body)
    assert verify_hmac_sha256(secret, b'{"meetingId":"xyz"}', sig) is False


def test_verify_hmac_sha256_supports_prefix():
    body = b"payload"
    secret = "shh"
    raw = hmac_sha256_hex(secret, body)
    assert verify_hmac_sha256(secret, body, "sha256=" + raw, prefix="sha256=") is True
    assert verify_hmac_sha256(secret, body, raw, prefix="sha256=") is False


def test_verify_hmac_sha256_handles_missing_header():
    assert verify_hmac_sha256("shh", b"x", None) is False
    assert verify_hmac_sha256("shh", b"x", "") is False


def test_verify_bearer():
    assert verify_bearer("topsecret", "Bearer topsecret") is True
    assert verify_bearer("topsecret", "Bearer wrong") is False
    assert verify_bearer("topsecret", None) is False


# ─── Fireflies _normalize ────────────────────────────────────────────────


_FIREFLIES_FIXTURE = {
    "id": "ff_meeting_123",
    "title": "Daily standup — May 1",
    "dateString": "2026-05-01T09:00:00Z",
    "duration": 15,  # minutes
    "transcript_url": "https://app.fireflies.ai/view/ff_meeting_123",
    "organizer_email": "souvik@allysai.com",
    "meeting_attendees": [
        {"name": "Souvik Roy", "email": "souvik@allysai.com"},
        {"name": "Priya Sharma", "email": "priya@allysai.com"},
        {"name": "Ravi Kumar", "email": "ravi@allysai.com"},
    ],
    "sentences": [
        {"speaker_name": "Souvik Roy", "text": "Quick standup. Priya, you go first.",
         "start_time": 0, "speaker_id": 1},
        {"speaker_name": "Priya Sharma",
         "text": "Yesterday I shipped the auth refresh fix. Today I'm starting on rate limiting.",
         "start_time": 8, "speaker_id": 2},
        {"speaker_name": "Priya Sharma", "text": "No blockers.", "start_time": 22, "speaker_id": 2},
        {"speaker_name": "Ravi Kumar",
         "text": "Blocked on the schema migration — DBA hasn't approved yet.",
         "start_time": 30, "speaker_id": 3},
    ],
    "summary": {
        "overview": "Standup covering auth, rate limiting, and a blocked schema migration.",
        "action_items": "- Ravi: ping the DBA for schema migration approval\n- Priya: scope rate-limiting work by EOD",
        "keywords": ["auth", "rate limiting", "schema migration"],
    },
}


def test_fireflies_normalize_full_payload():
    t = _normalize(_FIREFLIES_FIXTURE)
    assert t.provider == "fireflies"
    assert t.provider_meeting_id == "ff_meeting_123"
    assert t.title == "Daily standup — May 1"
    assert t.duration_seconds == 15 * 60
    assert len(t.participants) == 3
    assert {p.email for p in t.participants} == {
        "souvik@allysai.com", "priya@allysai.com", "ravi@allysai.com"
    }
    # Speaker emails got hydrated from the attendee roster.
    priya_segs = [s for s in t.segments if s.speaker_name == "Priya Sharma"]
    assert priya_segs
    assert priya_segs[0].speaker_email == "priya@allysai.com"
    # Action items got parsed line-by-line.
    assert len(t.provider_action_items) == 2
    assert t.provider_action_items[0].text.startswith("Ravi:")


def test_fireflies_normalize_handles_missing_fields():
    minimal = {"id": "x", "sentences": [], "meeting_attendees": []}
    t = _normalize(minimal)
    assert t.provider_meeting_id == "x"
    assert t.title == "(untitled meeting)"
    assert t.segments == []


# ─── Fixture export — used by integration smoke ──────────────────────────


@pytest.fixture(scope="module")
def fireflies_fixture_path() -> Path:
    """Persist the fixture so the e2e smoke script can re-use it."""
    out = Path(__file__).parent / "fixtures" / "fireflies-standup.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(_FIREFLIES_FIXTURE, indent=2))
    return out


def test_fixture_writes(fireflies_fixture_path: Path):
    assert fireflies_fixture_path.exists()
    assert json.loads(fireflies_fixture_path.read_text())["id"] == "ff_meeting_123"
