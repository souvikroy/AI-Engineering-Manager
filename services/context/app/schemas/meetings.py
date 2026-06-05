"""Normalized meeting-transcript shape — one schema across all providers.

Every provider adapter (Fireflies, Read.ai, Otter, Grain, tl;dv) is responsible
for producing a `MeetingTranscript` from its provider-native payload. Downstream
ingest, chunking, classification, and extractors only ever see this shape.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

ProviderLiteral = Literal["fireflies", "readai", "otter", "grain", "tldv"]
MeetingTypeLiteral = Literal[
    "standup", "1on1", "planning", "retro", "review", "demo", "general"
]
ParticipantRoleLiteral = Literal["organizer", "attendee"]


class TranscriptSegment(BaseModel):
    speaker_name: str
    speaker_email: EmailStr | None = None
    speaker_provider_id: str | None = None
    ts_seconds: float = Field(ge=0.0)
    text: str


class Participant(BaseModel):
    email: EmailStr | None = None
    name: str
    provider_id: str | None = None
    role: ParticipantRoleLiteral = "attendee"


class MeetingActionItem(BaseModel):
    text: str
    assignee_email: EmailStr | None = None
    due_iso: str | None = None
    confidence: float = 0.7


class MeetingTranscript(BaseModel):
    """Provider-agnostic meeting payload, ready for the shared ingest pipeline."""

    provider: ProviderLiteral
    provider_meeting_id: str
    title: str
    started_at: datetime
    duration_seconds: int = Field(ge=0)
    join_url: str | None = None
    recording_url: str | None = None
    transcript_url: str | None = None
    participants: list[Participant]
    segments: list[TranscriptSegment]
    provider_summary: str | None = None
    provider_action_items: list[MeetingActionItem] = Field(default_factory=list)
    meeting_type: MeetingTypeLiteral | None = None
    confidential: bool = False
    workspace_id: str | None = None
