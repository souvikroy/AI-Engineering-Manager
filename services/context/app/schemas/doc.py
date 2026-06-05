"""Document fetch response."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from .common import SourceLiteral


class DocResponse(BaseModel):
    id: str
    source: SourceLiteral
    source_id: str
    source_url: str | None
    title: str
    text: str
    anchor: str | None = None
    entity_refs: list[str]
    updated_at: datetime
    freshness_seconds: int | None
