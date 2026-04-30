"""Pure-function smoke tests — chunkers + redaction. No DB required."""
from __future__ import annotations

import pytest

from app.rag import chunk, entities, redact


def test_chunk_markdown_splits_on_headings():
    text = "# A\n\nfirst\n\n## B\n\nsecond\n\n## C\n\nthird"
    parts = chunk.chunk_markdown(text, target=200, overlap=20)
    assert len(parts) >= 3
    assert any("## B" in p for p in parts)


def test_chunk_generic_handles_long_input():
    text = "lorem ipsum dolor sit amet " * 1000
    parts = chunk.chunk_generic(text)
    assert len(parts) > 1
    assert all(chunk.token_count(p) <= 850 for p in parts)


def test_chunk_jira_issue_orders_description_then_comments():
    out = chunk.chunk_jira_issue("desc body", ["c1", "c2"])
    assert out == ["desc body", "c1", "c2"]


def test_chunk_slack_thread_drops_empty():
    msgs = [{"text": "hi"}, {"text": ""}, {"text": "  "}]
    assert chunk.chunk_slack_thread(msgs) == ["hi"]


def test_redact_removes_pii():
    text = "ping me at jane@example.com or 415-555-0142, otp 482910 sk-secret_xxxxxxx"
    out = redact.redact_basic(text)
    assert "[email]" in out
    assert "[phone]" in out
    assert "[otp]" in out
    assert "[secret]" in out
    assert "jane@example.com" not in out


@pytest.mark.asyncio
async def test_redact_with_mentions_no_resolver():
    out = await redact.redact_with_mentions("hey <@U02ABC> ping")
    assert "@slack:U02ABC" in out


def test_extract_refs_picks_ticket_keys():
    refs = entities.extract_refs_regex(
        "see PROD-1421 and AUTH-9 — also engineer:eng_priya is on it",
        known_services=["auth", "billing"],
    )
    assert "ticket:PROD-1421" in refs
    assert "ticket:AUTH-9" in refs
    assert "engineer:eng_priya" in refs
    assert "service:auth" in refs
