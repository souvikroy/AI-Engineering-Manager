"""Meeting type classification + confidential detection.

Two-stage classification:
1. Title regex (deterministic, ~80% hit rate, free).
2. Haiku fallback (rare, when no regex fires).

Confidential detection is title-only — meetings flagged confidential get stored
as metadata-only `Meeting` rows, never reach `rag.document` or get embedded.
"""
from __future__ import annotations

import re
from typing import Iterable

from ...schemas.meetings import MeetingTypeLiteral, Participant, TranscriptSegment

_RE_STANDUP = re.compile(r"\b(stand[ -]?up|daily(?:\s+sync)?)\b", re.IGNORECASE)
_RE_1ON1 = re.compile(
    r"\b(1[ :\-]?on[ \-]?1|1[:\-]?1|one[ \-]on[ \-]one|sync with)\b", re.IGNORECASE
)
_RE_PLANNING = re.compile(r"\b(sprint\s+planning|backlog\s+grooming|planning)\b", re.IGNORECASE)
_RE_RETRO = re.compile(r"\bretro(?:spective)?\b", re.IGNORECASE)
_RE_REVIEW = re.compile(r"\b(review|demo|showcase|stakeholder)\b", re.IGNORECASE)


CONFIDENTIAL_RE = re.compile(
    r"\b("
    r"performance\s+review|"
    r"perf\s+review|"
    r"hr(?!\w)|"
    r"comp(?:ensation)?(?!\w)|"
    r"salary|"
    r"firing|"
    r"\bpip\b|"
    r"onboarding\s+feedback|"
    r"exit\s+interview"
    r")\b",
    re.IGNORECASE,
)


def is_confidential_title(title: str) -> bool:
    """True when the title trips a confidential keyword. Used to gate ingest."""
    return bool(CONFIDENTIAL_RE.search(title or ""))


def classify_by_title(
    title: str, participants: Iterable[Participant]
) -> MeetingTypeLiteral | None:
    """Deterministic regex pass. Returns None if nothing matches."""
    t = title or ""
    n_part = sum(1 for _ in participants)

    if _RE_STANDUP.search(t):
        return "standup"
    if _RE_1ON1.search(t) and n_part <= 3:
        return "1on1"
    if _RE_PLANNING.search(t):
        return "planning"
    if _RE_RETRO.search(t):
        return "retro"
    if _RE_REVIEW.search(t):
        # "demo" wins over generic review when both present
        if re.search(r"\bdemo\b", t, re.IGNORECASE):
            return "demo"
        return "review"
    # Heuristic: 2-person untagged meeting is almost always a 1:1
    if n_part == 2:
        return "1on1"
    return None


async def classify_meeting(
    title: str,
    participants: list[Participant],
    segments_preview: list[TranscriptSegment] | None = None,
) -> MeetingTypeLiteral:
    """Two-stage classifier. Falls back to Haiku only when title regex is silent.

    The Haiku call is intentionally minimal — title + participant count + first
    ~1500 tokens of transcript. Default to "general" if Haiku is unavailable
    (no Anthropic key configured).
    """
    by_title = classify_by_title(title, participants)
    if by_title is not None:
        return by_title

    # Haiku fallback — kept as a soft import so unit tests don't need the SDK.
    try:
        return await _classify_with_haiku(title, participants, segments_preview or [])
    except Exception:  # noqa: BLE001 — never fail ingestion on classification
        return "general"


async def _classify_with_haiku(
    title: str,
    participants: list[Participant],
    segments_preview: list[TranscriptSegment],
) -> MeetingTypeLiteral:
    """Lazy Haiku classification. Imports anthropic only when called."""
    from ...config import get_settings

    settings = get_settings()
    if not settings.anthropic_api_key:
        return "general"

    import anthropic

    preview = "\n".join(
        f"{s.speaker_name}: {s.text}" for s in segments_preview[:30] if s.text
    )[:6000]
    sys_prompt = (
        "Classify the meeting type. Choose exactly one of: "
        "standup, 1on1, planning, retro, review, demo, general. "
        "Respond with ONLY the label."
    )
    user_prompt = (
        f"Title: {title}\n"
        f"Participants ({len(participants)}): "
        f"{', '.join(p.name for p in participants)}\n\n"
        f"Transcript preview:\n{preview}"
    )
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    msg = await client.messages.create(
        model=settings.anthropic_model_fast,
        max_tokens=8,
        system=sys_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    )
    raw = (msg.content[0].text if msg.content else "").strip().lower()
    valid: set[str] = {"standup", "1on1", "planning", "retro", "review", "demo", "general"}
    return raw if raw in valid else "general"  # type: ignore[return-value]
