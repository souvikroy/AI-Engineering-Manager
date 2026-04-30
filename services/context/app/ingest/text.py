"""Generic text ingest — for local dev + eval-harness fixtures.

POST /ingest/text takes any blob with explicit metadata so end-to-end retrieval
can be validated without wiring a real source. Treat as a development door;
production traffic should go through source-specific webhooks.
"""
from __future__ import annotations

from ..rag.chunk import chunk_markdown
from ..schemas.common import SourceLiteral
from .base import upsert_document


async def ingest_text(
    *,
    source: SourceLiteral,
    source_id: str,
    title: str,
    text: str,
    source_url: str | None = None,
    entity_refs: list[str] | None = None,
    metadata: dict | None = None,
    workspace_id: str | None = None,
) -> dict:
    return await upsert_document(
        source=source,
        source_id=source_id,
        title=title,
        content=text,
        source_url=source_url,
        entity_refs=entity_refs,
        metadata=metadata or {},
        chunker_fn=chunk_markdown,
        workspace_id=workspace_id,
        cursor_id=f"{source}:dev",
        cursor=None,
    )
