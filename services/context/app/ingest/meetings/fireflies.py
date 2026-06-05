"""Fireflies.ai meeting-transcript adapter.

Webhook contract (Fireflies → us):
- Header `X-Fireflies-Signature: <hex_hmac_sha256_of_raw_body>` (no prefix).
- Body: `{ "meetingId": "<id>", "eventType": "Transcription completed" }`.

We verify HMAC, then fetch the full transcript via GraphQL and normalize it
into the shared `MeetingTranscript` shape.

GraphQL query — `transcript(id: ID!)` — returns:
  id, title, dateString, duration, organizer_email, participants,
  meeting_attendees{name, email}, sentences{speaker_name, raw_speaker, text,
  start_time, speaker_id}, summary{action_items, keywords, overview, outline}.

Reference: https://docs.fireflies.ai/graphql-api
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import HTTPException

from ...config import get_settings
from ...security.hmac_verify import verify_hmac_sha256
from ...schemas.meetings import (
    MeetingActionItem,
    MeetingTranscript,
    Participant,
    TranscriptSegment,
)
from .base import MeetingProviderAdapter

GRAPHQL_URL = "https://api.fireflies.ai/graphql"

_TRANSCRIPT_QUERY = """
query Transcript($id: String!) {
  transcript(id: $id) {
    id
    title
    date
    dateString
    duration
    transcript_url
    organizer_email
    meeting_attendees { name email }
    sentences {
      speaker_name
      raw_speaker
      speaker_id
      text
      start_time
    }
    summary {
      overview
      action_items
      keywords
    }
  }
}
"""


class Fireflies(MeetingProviderAdapter):
    provider = "fireflies"
    pull_supported = False  # webhook-only in Phase 1; pull stub for Phase 2

    async def parse_webhook(
        self, payload: dict[str, Any], headers: dict[str, str]
    ) -> str | None:
        """Verify HMAC and extract `meetingId`. Raises 401 on bad signature."""
        settings = get_settings()
        secret = settings.fireflies_webhook_secret
        # Header keys arrive lowercased in our dict (Starlette normalizes).
        sig_header = headers.get("x-fireflies-signature") or headers.get("X-Fireflies-Signature")

        # Re-encode the verified raw body. The router passes it via state; if
        # absent we use the parsed payload as a fallback (signature will fail).
        raw = headers.get("__raw_body__")  # set by route layer
        body_bytes = raw.encode("utf-8") if isinstance(raw, str) else (raw or b"")

        if not secret:
            # No secret configured: in dev we accept (logged). In prod, set the env var.
            return str(payload.get("meetingId") or "")
        if not verify_hmac_sha256(secret, body_bytes, sig_header, prefix=""):
            raise HTTPException(status_code=401, detail="bad_signature")

        meeting_id = str(payload.get("meetingId") or "")
        if not meeting_id:
            return None
        return meeting_id

    async def fetch_transcript(self, provider_meeting_id: str) -> MeetingTranscript:
        settings = get_settings()
        api_key = settings.fireflies_api_key
        if not api_key:
            raise RuntimeError("FIREFLIES_API_KEY not configured")

        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                GRAPHQL_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "query": _TRANSCRIPT_QUERY,
                    "variables": {"id": provider_meeting_id},
                },
            )
            resp.raise_for_status()
            data = resp.json()

        return _normalize(data.get("data", {}).get("transcript") or {})


def _normalize(t: dict[str, Any]) -> MeetingTranscript:
    """Fireflies → MeetingTranscript. Pure function; unit-testable on fixtures."""
    started_at = _parse_started_at(t.get("date"), t.get("dateString"))

    participants = [
        Participant(name=a.get("name") or (a.get("email") or "").split("@")[0], email=a.get("email"))
        for a in (t.get("meeting_attendees") or [])
    ]
    organizer_email = t.get("organizer_email")
    if organizer_email and not any(p.email == organizer_email for p in participants):
        participants.insert(
            0, Participant(name=organizer_email.split("@")[0], email=organizer_email, role="organizer")
        )

    # Build email lookup: speaker_name → email (Fireflies sometimes puts email
    # into raw_speaker or only into meeting_attendees).
    name_to_email: dict[str, str] = {}
    for p in participants:
        if p.email:
            name_to_email[p.name] = p.email

    segments: list[TranscriptSegment] = []
    for s in (t.get("sentences") or []):
        if not s.get("text"):
            continue
        speaker = (s.get("speaker_name") or s.get("raw_speaker") or "").strip()
        if not speaker:
            continue
        segments.append(
            TranscriptSegment(
                speaker_name=speaker,
                speaker_email=name_to_email.get(speaker),
                speaker_provider_id=str(s.get("speaker_id")) if s.get("speaker_id") is not None else None,
                ts_seconds=float(s.get("start_time") or 0),
                text=s["text"],
            )
        )

    summary = (t.get("summary") or {})
    raw_action_items = summary.get("action_items") or ""
    provider_action_items: list[MeetingActionItem] = []
    if isinstance(raw_action_items, str) and raw_action_items.strip():
        for line in raw_action_items.splitlines():
            line = line.strip().lstrip("-•* ").strip()
            if line:
                provider_action_items.append(MeetingActionItem(text=line))
    elif isinstance(raw_action_items, list):
        for item in raw_action_items:
            if isinstance(item, str) and item.strip():
                provider_action_items.append(MeetingActionItem(text=item.strip()))

    return MeetingTranscript(
        provider="fireflies",
        provider_meeting_id=str(t.get("id") or ""),
        title=t.get("title") or "(untitled meeting)",
        started_at=started_at,
        duration_seconds=int((t.get("duration") or 0) * 60) if isinstance(t.get("duration"), (int, float)) else 0,
        transcript_url=t.get("transcript_url"),
        participants=participants,
        segments=segments,
        provider_summary=summary.get("overview"),
        provider_action_items=provider_action_items,
    )


def _parse_started_at(date_field: Any, date_string: str | None) -> datetime:
    """Fireflies returns either an ISO string in `dateString` or an epoch ms `date`."""
    if isinstance(date_field, (int, float)) and date_field > 0:
        # epoch ms
        return datetime.fromtimestamp(date_field / 1000, tz=timezone.utc)
    if date_string:
        try:
            return datetime.fromisoformat(date_string.replace("Z", "+00:00"))
        except ValueError:
            pass
    return datetime.now(timezone.utc)
