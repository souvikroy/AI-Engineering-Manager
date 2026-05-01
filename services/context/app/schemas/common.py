"""Common types reused across endpoints."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

SourceLiteral = Literal[
    "slack", "jira", "linear", "sentry", "confluence", "notion", "gsheet", "github", "meeting"
]
EntityKindLiteral = Literal["engineer", "team", "service", "sprint", "ticket"]


class Citation(BaseModel):
    """Provenance pointer attached to every retrieval result and summary.

    The chat layer's post-generation verifier requires every model claim to
    cite at least one Citation.id from the union of all tool results.
    """

    kind: SourceLiteral
    id: str
    url: str | None = None
    freshness_seconds: int | None = Field(
        default=None,
        description="Age of the underlying source data, in seconds. None = unknown.",
    )


class FreshnessMap(BaseModel):
    """Per-source data age in seconds. Surfaced in the chat UI."""

    sources: dict[SourceLiteral, int | None]
    as_of: datetime
