"""Shared `upsert_document()` pipeline used by every source ingester.

End-to-end shape:
1. Compute content_hash; if unchanged for an existing (source, source_id), skip.
2. Redact PII.
3. Chunk via the source's chunker (or generic fallback).
4. Extract entity_refs (regex; Haiku later).
5. Embed all chunks via Voyage.
6. UPSERT document and replace its chunks atomically.
7. Update ingest_cursor on success.
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Awaitable, Callable

from ..db import acquire
from ..schemas.common import SourceLiteral
from .. rag import chunk as chunker
from ..rag import entities, redact
from ..rag.embed import embed_texts

log = logging.getLogger(__name__)

ChunkerFn = Callable[[str], list[str]]


def _hash(content: str, metadata: dict) -> str:
    h = hashlib.sha256()
    h.update(content.encode("utf-8"))
    h.update(json.dumps(metadata, sort_keys=True).encode("utf-8"))
    return h.hexdigest()


async def upsert_document(
    *,
    source: SourceLiteral,
    source_id: str,
    title: str,
    content: str,
    source_url: str | None = None,
    metadata: dict | None = None,
    entity_refs: list[str] | None = None,
    chunker_fn: ChunkerFn | None = None,
    workspace_id: str | None = None,
    resolve_slack: Callable[[str], Awaitable[str | None]] | None = None,
    cursor_id: str | None = None,
    cursor: str | None = None,
) -> dict[str, object]:
    """Upsert a Document and replace its chunks. Returns counts + document_id.

    Idempotent on (source, source_id, content_hash): if the hash matches the
    existing row we no-op.
    """
    metadata = metadata or {}
    cleaned = await redact.redact_with_mentions(content, resolve_slack=resolve_slack)
    if not cleaned.strip():
        return {"document_id": None, "chunks": 0, "skipped": True, "reason": "empty"}

    content_hash = _hash(cleaned, metadata)
    pieces = chunker_fn(cleaned) if chunker_fn else chunker.chunk_generic(cleaned)
    if not pieces:
        return {"document_id": None, "chunks": 0, "skipped": True, "reason": "no_chunks"}

    refs_set: set[str] = set(entity_refs or [])
    for p in pieces:
        refs_set.update(entities.extract_refs_regex(p))
    refs = sorted(refs_set)

    vectors, embed_model, embed_version = await embed_texts(pieces, input_type="document")

    async with acquire() as conn:
        async with conn.transaction():
            existing = await conn.fetchrow(
                "SELECT id, content_hash FROM rag.document "
                "WHERE source = $1 AND source_id = $2",
                source,
                source_id,
            )
            if existing and existing["content_hash"] == content_hash:
                if cursor_id:
                    await _bump_cursor(conn, cursor_id, cursor)
                return {
                    "document_id": str(existing["id"]),
                    "chunks": 0,
                    "skipped": True,
                    "reason": "unchanged",
                }
            doc_row = await conn.fetchrow(
                """
                INSERT INTO rag.document
                    (workspace_id, source, source_id, source_url, title,
                     content_hash, metadata, entity_refs, updated_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,now())
                ON CONFLICT (source, source_id) DO UPDATE SET
                    workspace_id = EXCLUDED.workspace_id,
                    source_url   = EXCLUDED.source_url,
                    title        = EXCLUDED.title,
                    content_hash = EXCLUDED.content_hash,
                    metadata     = EXCLUDED.metadata,
                    entity_refs  = EXCLUDED.entity_refs,
                    updated_at   = now()
                RETURNING id
                """,
                workspace_id,
                source,
                source_id,
                source_url,
                title,
                content_hash,
                json.dumps(metadata),
                refs,
            )
            doc_id = doc_row["id"]
            await conn.execute("DELETE FROM rag.chunk WHERE document_id = $1", doc_id)
            for ordinal, (text, vec) in enumerate(zip(pieces, vectors, strict=True)):
                await conn.execute(
                    """
                    INSERT INTO rag.chunk
                        (workspace_id, document_id, ordinal, text, token_count,
                         entity_refs, embedding, tsv,
                         embedding_model, embedding_version)
                    VALUES ($1,$2,$3,$4,$5,$6,$7::vector,
                            to_tsvector('simple', $4), $8, $9)
                    """,
                    workspace_id,
                    doc_id,
                    ordinal,
                    text,
                    chunker.token_count(text),
                    sorted(set(entities.extract_refs_regex(text)) | set(refs)),
                    vec,
                    embed_model,
                    embed_version,
                )
            if cursor_id:
                await _bump_cursor(conn, cursor_id, cursor)
    return {
        "document_id": str(doc_id),
        "chunks": len(pieces),
        "skipped": False,
        "reason": None,
    }


async def _bump_cursor(conn, cursor_id: str, cursor: str | None) -> None:
    now = datetime.now(timezone.utc)
    await conn.execute(
        """
        INSERT INTO rag.ingest_cursor (id, cursor, last_run_at, last_ok_at, error_streak)
        VALUES ($1, $2, $3, $3, 0)
        ON CONFLICT (id) DO UPDATE SET
            cursor       = COALESCE(EXCLUDED.cursor, rag.ingest_cursor.cursor),
            last_run_at  = EXCLUDED.last_run_at,
            last_ok_at   = EXCLUDED.last_ok_at,
            error_streak = 0
        """,
        cursor_id,
        cursor,
        now,
    )
