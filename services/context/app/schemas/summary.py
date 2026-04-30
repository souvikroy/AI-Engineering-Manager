"""Hierarchical summary (L1/L2/L3) responses."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from .common import Citation, EntityKindLiteral

WindowLiteral = Literal["day", "week", "sprint", "quarter"]


class SummaryResponse(BaseModel):
    layer: Literal[1, 2, 3]
    entity_type: EntityKindLiteral | None
    entity_id: str | None
    window: WindowLiteral | None
    window_start: datetime | None
    window_end: datetime | None
    text: str
    token_count: int
    citations: list[Citation]
    freshness_seconds: int | None = Field(default=None)
