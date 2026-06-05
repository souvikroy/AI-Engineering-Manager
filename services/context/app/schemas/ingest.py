"""Generic ingest acknowledgement. Per-source webhook bodies are typed at the router layer."""
from __future__ import annotations

from pydantic import BaseModel


class IngestAck(BaseModel):
    ok: bool = True
    source: str
    accepted: int = 0
    deduplicated: int = 0
    failed: int = 0
    detail: str | None = None
