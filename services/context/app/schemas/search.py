"""Hybrid retrieval (BM25 + vector + rerank) request/response."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from .common import Citation, SourceLiteral


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=2000)
    since: datetime | None = None
    until: datetime | None = None
    sources: list[SourceLiteral] | None = None
    entities: list[str] | None = Field(
        default=None,
        description="Entity refs to filter on, e.g. ['engineer:eng_priya', 'sprint:S-42'].",
    )
    k: int = Field(default=10, ge=1, le=50)
    workspace_id: str | None = None


class SearchHit(BaseModel):
    id: str
    text: str
    source: SourceLiteral
    source_url: str | None
    entity_refs: list[str]
    score: float
    freshness_seconds: int | None


class SearchResponse(BaseModel):
    results: list[SearchHit]
    citations: list[Citation]
    truncated: bool = Field(
        default=False,
        description="True when results were summarized via the recursive overflow valve.",
    )
    overflow_summary: str | None = None
    routing: Literal["entity", "semantic", "structured", "mixed"] = "mixed"
