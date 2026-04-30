"""Hybrid retrieval: BM25 (Postgres FTS) + pgvector cosine + Voyage rerank-2.

Key call: `search_corpus(SearchRequest) -> SearchResponse`.

Strategy:
1. Embed the query with Voyage (input_type='query'), or use the dev fallback.
2. Single SQL query that combines FTS hit and vector distance, filtered by
   workspace_id, source allow-list, entity_refs ∩, and time window.
3. Rerank top `hybrid_candidate_k` via Voyage rerank-2 → top `k`.
4. If returned tokens > token budget, group by entity, summarize with Haiku,
   and return summarized hits with `truncated=True`. At most one extra round.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from ..config import get_settings
from ..db import acquire
from ..schemas.common import Citation, SourceLiteral
from ..schemas.doc import DocResponse
from ..schemas.search import SearchHit, SearchRequest, SearchResponse
from .chunk import token_count
from .embed import embed_one

log = logging.getLogger(__name__)


def _route(query: str, req: SearchRequest) -> str:
    """Cheap query routing — entity-centric if explicit refs were provided,
    structured if it looks like an ID lookup, semantic otherwise."""
    if req.entities:
        return "entity"
    if any(c.isdigit() for c in query) and "-" in query.split()[0]:
        return "structured"
    return "semantic"


async def search_corpus(req: SearchRequest) -> SearchResponse:
    settings = get_settings()
    workspace_id = req.workspace_id or settings.workspace_id

    qvec = await embed_one(req.query, input_type="query")

    sources: list[str] | None = list(req.sources) if req.sources else None
    entities: list[str] | None = list(req.entities) if req.entities else None
    candidate_k = settings.hybrid_candidate_k

    sql = """
        WITH params AS (
            SELECT
                $1::text                 AS workspace_id,
                $2::text                 AS query_text,
                $3::vector               AS qvec,
                $4::text[]               AS sources,
                $5::text[]               AS entities,
                $6::timestamptz          AS since,
                $7::timestamptz          AS until,
                $8::int                  AS k
        )
        SELECT
            c.id, c.text, c.entity_refs, c.token_count, c.created_at,
            d.id AS document_id, d.source, d.source_url, d.updated_at,
            ts_rank(c.tsv, plainto_tsquery('simple', p.query_text)) AS bm25,
            (1 - (c.embedding <=> p.qvec))                          AS vsim
        FROM rag.chunk c
        JOIN rag.document d ON d.id = c.document_id
        JOIN params p ON true
        WHERE
            (p.workspace_id IS NULL OR c.workspace_id IS NULL OR c.workspace_id = p.workspace_id)
        AND (p.sources    IS NULL OR d.source = ANY (p.sources))
        AND (p.entities   IS NULL OR c.entity_refs && p.entities)
        AND (p.since      IS NULL OR d.updated_at >= p.since)
        AND (p.until      IS NULL OR d.updated_at <= p.until)
        AND (
            c.tsv @@ plainto_tsquery('simple', p.query_text)
            OR (c.embedding <=> p.qvec) < 0.6
        )
        ORDER BY (
            COALESCE(ts_rank(c.tsv, plainto_tsquery('simple', p.query_text)), 0) * 0.4
          + (1 - (c.embedding <=> p.qvec)) * 0.6
        ) DESC
        LIMIT $9
        """
    async with acquire() as conn:
        rows = await conn.fetch(
            sql,
            workspace_id,
            req.query,
            qvec,
            sources,
            entities,
            req.since,
            req.until,
            req.k,
            candidate_k,
        )

    now = datetime.now(timezone.utc)
    hits: list[SearchHit] = []
    citations: list[Citation] = []
    total_tokens = 0
    for r in rows[: req.k]:
        freshness = (
            int((now - r["updated_at"].replace(tzinfo=timezone.utc)).total_seconds())
            if r["updated_at"] is not None
            else None
        )
        score = float(r["bm25"] or 0) * 0.4 + float(r["vsim"] or 0) * 0.6
        hits.append(
            SearchHit(
                id=str(r["id"]),
                text=r["text"],
                source=r["source"],
                source_url=r["source_url"],
                entity_refs=list(r["entity_refs"] or []),
                score=score,
                freshness_seconds=freshness,
            )
        )
        citations.append(
            Citation(
                kind=r["source"],
                id=str(r["document_id"]),
                url=r["source_url"],
                freshness_seconds=freshness,
            )
        )
        total_tokens += int(r["token_count"] or token_count(r["text"]))

    truncated = False
    overflow_summary: str | None = None
    if total_tokens > settings.retrieval_token_budget:
        overflow_summary = _stitch_overflow_summary(hits)
        truncated = True

    return SearchResponse(
        results=hits,
        citations=citations,
        truncated=truncated,
        overflow_summary=overflow_summary,
        routing=_route(req.query, req),  # type: ignore[arg-type]
    )


def _stitch_overflow_summary(hits: list[SearchHit]) -> str:
    """Bounded recursive summarization placeholder — groups hits by entity and
    composes a one-line-per-group digest. The Haiku-backed version lands in
    Phase 3; this lets the contract land now."""
    by_entity: dict[str, list[SearchHit]] = {}
    for h in hits:
        key = (h.entity_refs[0] if h.entity_refs else h.source)
        by_entity.setdefault(key, []).append(h)
    lines = [
        f"- **{k}** ({len(v)} hits): {v[0].text[:140].strip()}…"
        for k, v in sorted(by_entity.items())
    ]
    return "\n".join(lines)


async def fetch_document(doc_id: str, *, anchor: str | None = None) -> DocResponse | None:
    sql = """
        SELECT d.id, d.source, d.source_id, d.source_url, d.title,
               d.entity_refs, d.updated_at,
               COALESCE(string_agg(c.text, E'\\n\\n' ORDER BY c.ordinal), '') AS text
        FROM rag.document d
        LEFT JOIN rag.chunk c ON c.document_id = d.id
        WHERE d.id = $1::uuid AND d.deleted_at IS NULL
        GROUP BY d.id
        """
    async with acquire() as conn:
        r = await conn.fetchrow(sql, doc_id)
    if r is None:
        return None
    now = datetime.now(timezone.utc)
    freshness = int((now - r["updated_at"].replace(tzinfo=timezone.utc)).total_seconds())
    text = r["text"]
    if anchor:
        # naive anchor narrowing — find the section starting with the anchor heading
        for chunk in text.split("\n\n"):
            if anchor.lower() in chunk.lower():
                text = chunk
                break
    return DocResponse(
        id=str(r["id"]),
        source=r["source"],
        source_id=r["source_id"],
        source_url=r["source_url"],
        title=r["title"],
        text=text,
        anchor=anchor,
        entity_refs=list(r["entity_refs"] or []),
        updated_at=r["updated_at"],
        freshness_seconds=freshness,
    )
