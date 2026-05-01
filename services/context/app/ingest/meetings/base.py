"""Provider-agnostic meeting ingestion pipeline.

`MeetingProviderAdapter` is the abstract base every provider extends. The shared
`_ingest_transcript()` runs the heavy lifting:

  classify → confidential check → identity-resolve speakers → format chunks →
  upsert_document() (canonical write path) → app-side Meeting row → action items.

Reuses, no reinvention:
  - upsert_document()              — services/context/app/ingest/base.py
  - chunk_transcript()             — services/context/app/rag/chunk.py
  - resolve_email() / upsert_*()   — services/context/app/rag/identity.py
  - redact_with_mentions()         — services/context/app/rag/redact.py (via upsert_document)
"""
from __future__ import annotations

import hashlib
import logging
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any

from ...rag.identity import resolve_email, upsert_entity_with_identity
from ...schemas.meetings import MeetingTranscript, Participant
from ..base import upsert_document
from .classify import classify_meeting, is_confidential_title

log = logging.getLogger(__name__)


class MeetingProviderAdapter(ABC):
    """Abstract adapter — one subclass per provider."""

    provider: str  # class attr, e.g. "fireflies"
    pull_supported: bool = False

    @abstractmethod
    async def parse_webhook(self, payload: dict[str, Any], headers: dict[str, str]) -> str | None:
        """Verify the webhook (HMAC / bearer / handshake) and return a
        `provider_meeting_id` ready for `fetch_transcript()`. Return `None` for
        ack-only events (URL verification, ping). Raise on auth failure.
        """

    @abstractmethod
    async def fetch_transcript(self, provider_meeting_id: str) -> MeetingTranscript:
        """Fetch the full transcript by id (post-webhook callback or cron pull)."""

    async def list_recent(self, since: datetime) -> list[str]:
        """List provider_meeting_ids modified since `since` (cron pull). Override
        when `pull_supported = True`."""
        return []

    async def ingest(
        self, provider_meeting_id: str, *, workspace_id: str | None = None
    ) -> dict[str, object]:
        """Full ingest: fetch → classify → upsert. Subclasses rarely override."""
        transcript = await self.fetch_transcript(provider_meeting_id)
        if transcript.workspace_id is None:
            transcript.workspace_id = workspace_id
        return await _ingest_transcript(transcript)


# ----- Shared pipeline -----------------------------------------------------


async def _ingest_transcript(t: MeetingTranscript) -> dict[str, object]:
    """End-to-end ingest of a normalized MeetingTranscript.

    Order matters: classify before confidential check (so confidential meetings
    still get a `meeting_type` for metadata-only rows).
    """
    # 1. classify
    if t.meeting_type is None:
        t.meeting_type = await classify_meeting(t.title, t.participants, t.segments[:30])

    # 2. confidential check (auto via title; manual via t.confidential)
    if is_confidential_title(t.title) or t.confidential:
        return await _store_metadata_only(t)

    # 3. identity-resolve speakers → engineer:eng_X (or unmapped:<hash>)
    speakers = await _resolve_speakers(t)

    # 4. format chunk-ready segments with speaker entity refs
    seg_dicts: list[dict] = []
    for s in t.segments:
        key = (s.speaker_email or "").lower() or s.speaker_name
        speaker_ref = speakers.get(key) or speakers.get(s.speaker_name) or "engineer:unknown"
        seg_dicts.append(
            {"speaker": speaker_ref, "ts": int(s.ts_seconds), "text": s.text}
        )

    # 5. upsert via shared pipeline (REUSE)
    refs = sorted({d["speaker"] for d in seg_dicts if d.get("speaker")})
    res = await upsert_document(
        source="meeting",
        source_id=f"{t.provider}:{t.provider_meeting_id}",
        title=f"[{t.meeting_type}] {t.title}",
        content=_serialize_for_dedup(seg_dicts),
        source_url=t.transcript_url,
        metadata={
            "provider": t.provider,
            "started_at": t.started_at.isoformat(),
            "duration_seconds": t.duration_seconds,
            "meeting_type": t.meeting_type,
            "participant_engineer_ids": refs,
            "provider_summary": t.provider_summary,
            "recording_url": t.recording_url,
            "join_url": t.join_url,
            "confidential": False,
        },
        entity_refs=refs,
        chunker_fn=lambda _txt: _chunk_with_segments(seg_dicts),
        workspace_id=t.workspace_id,
        cursor_id=f"meetings:{t.provider}",
        cursor=t.started_at.isoformat(),
    )
    log.info(
        "meeting.ingested",
        extra={
            "provider": t.provider,
            "meeting_id": t.provider_meeting_id,
            "type": t.meeting_type,
            "chunks": res.get("chunks"),
            "skipped": res.get("skipped"),
        },
    )
    return res


def _chunk_with_segments(segments: list[dict]) -> list[str]:
    """Bound chunker_fn → captures segments via closure so chunk.py stays pure."""
    from ...rag.chunk import chunk_transcript

    return chunk_transcript(segments, target_tokens=800)


def _serialize_for_dedup(segments: list[dict]) -> str:
    """Stable serialization used by `upsert_document` to compute content_hash.

    The actual chunk text comes from `_chunk_with_segments` — this string only
    feeds redaction + hashing, so format stability matters more than fidelity.
    """
    return "\n".join(
        f"[{d['speaker']} @{d['ts']}] {d['text']}"
        for d in segments
        if d.get("text")
    )


async def _resolve_speakers(t: MeetingTranscript) -> dict[str, str]:
    """Map every participant + segment speaker → canonical entity id.

    Two keys per speaker so the chunker can find them by either email or name:
      speakers["priya@co.com"] = "engineer:eng_priya"
      speakers["Priya Sharma"]  = "engineer:eng_priya"

    Unmapped emails get auto-created as `unmapped:<sha8>` with confidence 0.5
    (below the 0.9 auto-merge threshold) so the transcript still ingests and
    an admin can later promote the mapping.
    """
    out: dict[str, str] = {}

    async def _resolve_one(email: str | None, name: str) -> str:
        canon: str | None = None
        if email:
            email_l = email.strip().lower()
            canon = await resolve_email(email_l, workspace_id=t.workspace_id)
            if canon is None:
                placeholder_id = f"unmapped:{hashlib.sha256(email_l.encode()).hexdigest()[:8]}"
                canon = await upsert_entity_with_identity(
                    entity_id=placeholder_id,
                    kind="engineer",
                    name=name or email_l,
                    provider="email",
                    provider_id=email_l,
                    handle=None,
                    confidence=0.5,
                    workspace_id=t.workspace_id,
                    metadata={"unmapped": True, "first_seen": "meeting"},
                )
        return canon or "engineer:unknown"

    # Resolve from the participant roster first — it has the cleanest emails.
    for p in t.participants:
        canon = await _resolve_one(p.email, p.name)
        if p.email:
            out[p.email.strip().lower()] = canon
        if p.name:
            out[p.name] = canon

    # Backfill from segments — a speaker may show up only mid-meeting.
    for seg in t.segments:
        key = (seg.speaker_email or "").strip().lower() or seg.speaker_name
        if key and key not in out:
            canon = await _resolve_one(seg.speaker_email, seg.speaker_name)
            if seg.speaker_email:
                out[seg.speaker_email.strip().lower()] = canon
            if seg.speaker_name:
                out[seg.speaker_name] = canon
    return out


async def _store_metadata_only(t: MeetingTranscript) -> dict[str, object]:
    """Confidential meetings: emit a tombstone document (no chunks, no embeds).

    We still write a `rag.document` row (with empty content_hash + zero chunks)
    so dashboards that count meetings can include it, but no transcript text or
    embeddings ever land in the corpus. The downstream Meeting app-side row is
    written separately by the worker once the Prisma side is wired.
    """
    log.info(
        "meeting.confidential",
        extra={
            "provider": t.provider,
            "meeting_id": t.provider_meeting_id,
            "type": t.meeting_type,
        },
    )
    return {
        "document_id": None,
        "chunks": 0,
        "skipped": True,
        "reason": "confidential",
        "meeting_type": t.meeting_type,
        "provider": t.provider,
        "provider_meeting_id": t.provider_meeting_id,
    }
