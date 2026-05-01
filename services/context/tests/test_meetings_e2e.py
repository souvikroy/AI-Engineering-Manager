"""End-to-end smoke for the /ingest/meetings/fireflies route.

Stubs out the GraphQL fetch and the DB-touching `upsert_document`, so this
exercises:
  - FastAPI router dispatch on /ingest/meetings/{provider}
  - HMAC signature verification (matching + tampered)
  - Fireflies.parse_webhook → meeting_id extraction
  - Fireflies.fetch_transcript → MeetingTranscript normalization
  - _ingest_transcript → classification → segment formatting → upsert payload

What we ASSERT:
  - 401 on bad signature
  - 200 + accepted=1 on good signature
  - upsert_document was called once with source="meeting", a chunker_fn that
    yields ≥1 chunk preserving speaker entity refs, and metadata containing
    meeting_type="standup" + provider="fireflies"
"""
from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def app_with_stubs(monkeypatch):
    """Build the FastAPI app with DB + Anthropic + Voyage stubbed.

    We monkey-patch:
      - app.ingest.base.upsert_document → captures the call args
      - app.ingest.meetings.base._resolve_speakers → returns canonical refs by name
      - app.ingest.meetings.fireflies.Fireflies.fetch_transcript → returns a fixture
      - app.config.get_settings → injects fireflies_webhook_secret
    """
    # Lazy imports — only after monkeypatch is set up.
    from app import config as cfg
    from app.config import Settings

    class _Settings(Settings):
        model_config = {"extra": "ignore"}

    fake = _Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        anthropic_api_key=None,
        voyage_api_key=None,
        fireflies_api_key="fake-key",
        fireflies_webhook_secret="topsecret",
        workspace_id="test-ws",
    )
    monkeypatch.setattr(cfg, "get_settings", lambda: fake)
    # Also patch the cached version some modules imported at import time.
    monkeypatch.setattr("app.ingest.meetings.fireflies.get_settings", lambda: fake)

    # Capture upsert_document calls instead of touching DB.
    captured: dict[str, Any] = {"calls": []}

    async def _fake_upsert_document(**kwargs):
        # Materialise the chunker output so we can assert on it.
        chunker_fn = kwargs.get("chunker_fn")
        chunks = chunker_fn(kwargs.get("content", "")) if chunker_fn else []
        captured["calls"].append({**kwargs, "_chunks": chunks})
        return {"document_id": "doc-fixture-1", "chunks": len(chunks), "skipped": False}

    monkeypatch.setattr("app.ingest.base.upsert_document", _fake_upsert_document)
    monkeypatch.setattr("app.ingest.meetings.base.upsert_document", _fake_upsert_document)

    # Skip DB-bound speaker resolution — return canonical refs keyed by name + email.
    async def _fake_resolve_speakers(t):
        out: dict[str, str] = {}
        name_to_id = {
            "Souvik Roy": "engineer:eng_souvik",
            "Priya Sharma": "engineer:eng_priya",
            "Ravi Kumar": "engineer:eng_ravi",
        }
        for p in t.participants:
            canon = name_to_id.get(p.name, f"engineer:unknown")
            if p.email:
                out[p.email.lower()] = canon
            out[p.name] = canon
        return out

    monkeypatch.setattr("app.ingest.meetings.base._resolve_speakers", _fake_resolve_speakers)

    # Stub Fireflies fetch — return a normalized MeetingTranscript directly.
    from datetime import datetime, timezone

    from app.ingest.meetings.fireflies import _normalize

    fixture = {
        "id": "ff_meeting_e2e_1",
        "title": "Daily standup — May 1",
        "dateString": "2026-05-01T09:00:00Z",
        "duration": 12,
        "transcript_url": "https://app.fireflies.ai/view/ff_meeting_e2e_1",
        "organizer_email": "souvik@allysai.com",
        "meeting_attendees": [
            {"name": "Souvik Roy", "email": "souvik@allysai.com"},
            {"name": "Priya Sharma", "email": "priya@allysai.com"},
            {"name": "Ravi Kumar", "email": "ravi@allysai.com"},
        ],
        "sentences": [
            {"speaker_name": "Souvik Roy", "text": "Quick standup. Priya, you go.", "start_time": 0},
            {"speaker_name": "Priya Sharma",
             "text": "Yesterday I shipped the auth refresh. Today: rate limiting. No blockers.",
             "start_time": 6},
            {"speaker_name": "Ravi Kumar",
             "text": "Blocked on the schema migration — DBA hasn't approved.",
             "start_time": 25},
        ],
        "summary": {
            "overview": "Standup covering auth, rate limiting, blocked schema migration.",
            "action_items": "- Ravi: ping the DBA",
        },
    }

    fetch_mock = AsyncMock(return_value=_normalize(fixture))
    monkeypatch.setattr(
        "app.ingest.meetings.fireflies.Fireflies.fetch_transcript", fetch_mock
    )

    # Build a minimal FastAPI app with only the ingest router mounted, so we
    # don't hit the production lifespan (which inits a Postgres pool we don't
    # have). This isolates the test to routing + provider dispatch.
    from fastapi import FastAPI

    from app.routers.ingest import router as ingest_router

    fastapi_app = FastAPI()
    fastapi_app.include_router(ingest_router)
    return fastapi_app, captured, fake


def _sign(secret: str, body: bytes) -> str:
    from app.security.hmac_verify import hmac_sha256_hex
    return hmac_sha256_hex(secret, body)


def test_meetings_route_404_for_unknown_provider(app_with_stubs):
    app, _captured, _ = app_with_stubs
    with TestClient(app) as client:
        resp = client.post("/ingest/meetings/not_a_provider", json={"meetingId": "x"})
    assert resp.status_code == 404
    assert "unknown_provider" in resp.json()["detail"]


def test_meetings_fireflies_rejects_bad_signature(app_with_stubs):
    app, _captured, _ = app_with_stubs
    body = json.dumps({"meetingId": "ff_meeting_e2e_1"}).encode()
    with TestClient(app) as client:
        resp = client.post(
            "/ingest/meetings/fireflies",
            content=body,
            headers={
                "Content-Type": "application/json",
                "X-Fireflies-Signature": "deadbeef",  # wrong
            },
        )
    assert resp.status_code == 401
    assert resp.json()["detail"] == "bad_signature"


def test_meetings_fireflies_full_round_trip(app_with_stubs):
    app, captured, settings = app_with_stubs
    body = json.dumps({"meetingId": "ff_meeting_e2e_1"}).encode()
    sig = _sign(settings.fireflies_webhook_secret, body)
    with TestClient(app) as client:
        resp = client.post(
            "/ingest/meetings/fireflies",
            content=body,
            headers={
                "Content-Type": "application/json",
                "X-Fireflies-Signature": sig,
            },
        )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["accepted"] == 1
    assert data["source"] == "meeting"

    # The shared pipeline got exactly one upsert call.
    assert len(captured["calls"]) == 1
    call = captured["calls"][0]
    assert call["source"] == "meeting"
    assert call["source_id"] == "fireflies:ff_meeting_e2e_1"
    assert call["title"].startswith("[standup] Daily standup")
    md = call["metadata"]
    assert md["provider"] == "fireflies"
    assert md["meeting_type"] == "standup"
    assert "engineer:eng_priya" in md["participant_engineer_ids"]
    assert "engineer:eng_ravi" in md["participant_engineer_ids"]

    # Chunks preserve speaker entity refs verbatim.
    chunks = call["_chunks"]
    assert len(chunks) >= 1
    joined = "\n".join(chunks)
    assert "[engineer:eng_priya" in joined
    assert "[engineer:eng_ravi" in joined
    assert "rate limiting" in joined
    assert "schema migration" in joined


def test_meetings_fireflies_confidential_title_short_circuits(app_with_stubs, monkeypatch):
    """A confidential title should skip embedding and not call upsert."""
    app, captured, settings = app_with_stubs

    # Override the fetched transcript with a confidential title.
    from app.ingest.meetings.fireflies import _normalize
    confidential_fixture = {
        "id": "ff_secret_1",
        "title": "Q2 Performance review — Priya",
        "dateString": "2026-05-01T09:00:00Z",
        "duration": 30,
        "meeting_attendees": [{"name": "Souvik Roy", "email": "souvik@allysai.com"}],
        "sentences": [
            {"speaker_name": "Souvik Roy", "text": "feedback content", "start_time": 0}
        ],
        "summary": {"action_items": ""},
    }
    monkeypatch.setattr(
        "app.ingest.meetings.fireflies.Fireflies.fetch_transcript",
        AsyncMock(return_value=_normalize(confidential_fixture)),
    )

    body = json.dumps({"meetingId": "ff_secret_1"}).encode()
    sig = _sign(settings.fireflies_webhook_secret, body)
    pre_count = len(captured["calls"])
    with TestClient(app) as client:
        resp = client.post(
            "/ingest/meetings/fireflies",
            content=body,
            headers={"Content-Type": "application/json", "X-Fireflies-Signature": sig},
        )
    assert resp.status_code == 200
    assert resp.json()["accepted"] == 0
    assert resp.json()["detail"] == "confidential"
    # No upsert was made — embedding-skipping respected.
    assert len(captured["calls"]) == pre_count
