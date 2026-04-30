"""L1/L2/L3 summary read + future write paths.

Phase-1 scope: read-side only — `fetch_summary()` returns the freshest matching
row from `rag.summary`. The writer/L1+L2+L3 worker logic lands in Phase 3 once
Slack ingest is online.
"""
from __future__ import annotations

from datetime import datetime, timezone

from ..db import acquire
from ..schemas.common import Citation
from ..schemas.summary import SummaryResponse, WindowLiteral


async def fetch_summary(
    *,
    layer: int,
    entity_type: str | None,
    entity_id: str | None,
    window: WindowLiteral | None,
    workspace_id: str | None,
) -> SummaryResponse | None:
    sql = """
        SELECT id, layer, entity_type, entity_id, window,
               window_start, window_end, text, token_count,
               source_chunk_ids, source_doc_ids, created_at
        FROM rag.summary
        WHERE layer = $1
          AND ($2::text IS NULL OR workspace_id IS NULL OR workspace_id = $2)
          AND (entity_type IS NOT DISTINCT FROM $3)
          AND (entity_id   IS NOT DISTINCT FROM $4)
          AND (window      IS NOT DISTINCT FROM $5)
        ORDER BY window_end DESC NULLS LAST, created_at DESC
        LIMIT 1
        """
    async with acquire() as conn:
        r = await conn.fetchrow(sql, layer, workspace_id, entity_type, entity_id, window)
    if r is None:
        return None
    now = datetime.now(timezone.utc)
    freshness = int((now - r["created_at"].replace(tzinfo=timezone.utc)).total_seconds())
    citations: list[Citation] = []
    for d in (r["source_doc_ids"] or [])[:8]:
        citations.append(Citation(kind="github", id=str(d), url=None, freshness_seconds=freshness))
        # NOTE: `kind` here defaults to "github" only because Citation.kind is a literal union;
        # Phase-3 fills the real source by joining rag.document. This stub just keeps the
        # schema valid for Phase-1 read paths.
    return SummaryResponse(
        layer=r["layer"],
        entity_type=r["entity_type"],
        entity_id=r["entity_id"],
        window=r["window"],
        window_start=r["window_start"],
        window_end=r["window_end"],
        text=r["text"],
        token_count=r["token_count"] or 0,
        citations=citations,
        freshness_seconds=freshness,
    )
