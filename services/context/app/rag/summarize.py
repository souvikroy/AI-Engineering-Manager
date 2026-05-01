"""Hierarchical summary read + write paths.

Layers:
- **L1 (source rollup)** — one summary per Document. Regenerated on content_hash change.
- **L2 (entity rollup)** — per-entity, per-window. Aggregates the relevant L1s.
- **L3 (time digest)** — daily brief / weekly org / quarterly OKR retrospective.

All writes are content-hash idempotent: if the input set hasn't changed, we no-op.
Anthropic prompt-cache is used aggressively on the summarize-input block.
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from ..config import get_settings
from ..db import acquire
from ..schemas.common import Citation, SourceLiteral
from ..schemas.summary import SummaryResponse, WindowLiteral
from .chunk import token_count

log = logging.getLogger(__name__)

WINDOW_DELTAS: dict[str, timedelta] = {
    "day": timedelta(days=1),
    "week": timedelta(days=7),
    "sprint": timedelta(days=14),
    "quarter": timedelta(days=92),
}


# ─── Read path ────────────────────────────────────────────────────────────────


async def fetch_summary(
    *,
    layer: int,
    entity_type: str | None,
    entity_id: str | None,
    window: WindowLiteral | None,
    workspace_id: str | None,
) -> SummaryResponse | None:
    sql = """
        SELECT s.id, s.layer, s.entity_type, s.entity_id, s.window,
               s.window_start, s.window_end, s.text, s.token_count,
               s.source_chunk_ids, s.source_doc_ids, s.created_at
        FROM rag.summary s
        WHERE s.layer = $1
          AND ($2::text IS NULL OR s.workspace_id IS NULL OR s.workspace_id = $2)
          AND (s.entity_type IS NOT DISTINCT FROM $3)
          AND (s.entity_id   IS NOT DISTINCT FROM $4)
          AND (s.window      IS NOT DISTINCT FROM $5)
        ORDER BY s.window_end DESC NULLS LAST, s.created_at DESC
        LIMIT 1
        """
    async with acquire() as conn:
        row = await conn.fetchrow(sql, layer, workspace_id, entity_type, entity_id, window)
    if row is None:
        return None
    now = datetime.now(timezone.utc)
    freshness = int((now - row["created_at"].replace(tzinfo=timezone.utc)).total_seconds())

    # Resolve citations from source documents (joined)
    citations = await _citations_for_doc_ids(row["source_doc_ids"] or [], freshness=freshness)

    return SummaryResponse(
        layer=row["layer"],
        entity_type=row["entity_type"],
        entity_id=row["entity_id"],
        window=row["window"],
        window_start=row["window_start"],
        window_end=row["window_end"],
        text=row["text"],
        token_count=row["token_count"] or 0,
        citations=citations,
        freshness_seconds=freshness,
    )


async def _citations_for_doc_ids(
    doc_ids: list[Any], *, freshness: int | None
) -> list[Citation]:
    if not doc_ids:
        return []
    async with acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, source, source_url FROM rag.document WHERE id = ANY($1::uuid[])",
            doc_ids,
        )
    return [
        Citation(
            kind=row["source"],
            id=str(row["id"]),
            url=row["source_url"],
            freshness_seconds=freshness,
        )
        for row in rows
    ]


# ─── Anthropic helper ─────────────────────────────────────────────────────────


_anthropic_client = None


def _get_anthropic():
    global _anthropic_client
    if _anthropic_client is None:
        settings = get_settings()
        if not settings.anthropic_api_key:
            return None
        try:
            import anthropic

            _anthropic_client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        except ImportError:
            log.warning("anthropic SDK missing — summarization disabled")
            return None
    return _anthropic_client


async def _summarize_with_haiku(
    *, system: str, user: str, max_tokens: int = 800, cache_user: bool = True
) -> str:
    """Call Haiku with optional prompt caching on the user block. Returns text."""
    client = _get_anthropic()
    settings = get_settings()
    if client is None:
        # No API key — emit a deterministic stub so the pipeline still runs.
        return _fallback_summary(user)
    user_blocks: list[dict[str, Any]] = [{"type": "text", "text": user}]
    if cache_user:
        user_blocks[0]["cache_control"] = {"type": "ephemeral"}
    msg = await client.messages.create(
        model=settings.anthropic_model_fast,
        max_tokens=max_tokens,
        temperature=0.2,
        system=[{"type": "text", "text": system}],
        messages=[{"role": "user", "content": user_blocks}],
    )
    return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text").strip()


def _fallback_summary(user: str) -> str:
    """Deterministic stub summary used when no Anthropic key is configured.

    Picks the first non-empty line of each section so we still write something
    useful to the cache table. NOT for production.
    """
    lines = [ln.strip() for ln in user.splitlines() if ln.strip()]
    head = " ".join(lines[:3])[:600]
    return f"[dev-summary] {head}"


def _hash(items: list[str]) -> str:
    h = hashlib.sha256()
    for it in sorted(items):
        h.update(it.encode("utf-8"))
        h.update(b"\x1e")
    return h.hexdigest()


# ─── L1 source rollup ─────────────────────────────────────────────────────────

L1_SYSTEM = (
    "You write 2-4 sentence summaries of a single source artifact "
    "(Slack thread, Jira ticket, Sentry issue, design doc, PR review). "
    "Be concrete; cite engineer names, ticket keys, and service names verbatim. "
    "No fluff, no preamble — just the summary."
)


async def build_l1_summary(document_id: str, *, workspace_id: str | None = None) -> str | None:
    """Build (or refresh) the L1 summary for a single Document."""
    async with acquire() as conn:
        doc = await conn.fetchrow(
            """
            SELECT d.id, d.source, d.source_id, d.source_url, d.title, d.content_hash,
                   d.entity_refs, d.updated_at
            FROM rag.document d
            WHERE d.id = $1::uuid AND d.deleted_at IS NULL
            """,
            document_id,
        )
        if doc is None:
            return None
        chunks = await conn.fetch(
            "SELECT id, text FROM rag.chunk WHERE document_id = $1 ORDER BY ordinal",
            doc["id"],
        )

    body = "\n\n".join(c["text"] for c in chunks)
    content_hash = _hash([str(doc["content_hash"]), body])
    async with acquire() as conn:
        existing = await conn.fetchrow(
            """
            SELECT id, content_hash FROM rag.summary
            WHERE layer = 1 AND $1 = ANY(source_doc_ids)
            ORDER BY created_at DESC LIMIT 1
            """,
            doc["id"],
        )
        if existing and existing["content_hash"] == content_hash:
            return str(existing["id"])

    user = f"# {doc['title']}\n\n{body}"
    text = await _summarize_with_haiku(system=L1_SYSTEM, user=user, max_tokens=400)
    chunk_ids = [c["id"] for c in chunks]

    async with acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO rag.summary
                (workspace_id, layer, entity_type, entity_id, window,
                 window_start, window_end, text, token_count,
                 source_chunk_ids, source_doc_ids, content_hash)
            VALUES ($1, 1, NULL, NULL, NULL, NULL, NULL,
                    $2, $3, $4::uuid[], ARRAY[$5::uuid], $6)
            RETURNING id
            """,
            workspace_id,
            text,
            token_count(text),
            chunk_ids,
            doc["id"],
            content_hash,
        )
    return str(row["id"])


# ─── L2 entity rollup ─────────────────────────────────────────────────────────

L2_SYSTEM = (
    "You write a 4-7 bullet weekly digest about ONE entity (engineer / team / service / sprint). "
    "Group bullets by theme (progress · blockers · risks · social signals). "
    "Cite ticket keys, Sentry IDs, Slack timestamps verbatim from the inputs. No invention."
)


async def build_l2_summary(
    *,
    entity_type: str,
    entity_id: str,
    window: WindowLiteral,
    workspace_id: str | None = None,
) -> str | None:
    """Aggregate the L1s + recent chunks for a single entity over a window."""
    delta = WINDOW_DELTAS[window]
    end = datetime.now(timezone.utc)
    start = end - delta

    entity_ref = f"{entity_type}:{entity_id}"
    async with acquire() as conn:
        # All L1 summaries whose source docs reference this entity, in window
        l1s = await conn.fetch(
            """
            SELECT s.id, s.text, s.source_doc_ids
            FROM rag.summary s
            JOIN rag.document d ON d.id = ANY(s.source_doc_ids)
            WHERE s.layer = 1
              AND ($1::text IS NULL OR s.workspace_id IS NULL OR s.workspace_id = $1)
              AND $2 = ANY(d.entity_refs)
              AND d.updated_at BETWEEN $3 AND $4
            ORDER BY d.updated_at DESC
            LIMIT 60
            """,
            workspace_id,
            entity_ref,
            start,
            end,
        )

    if not l1s:
        # Fall back to raw chunks if no L1s exist yet (early-bootstrap path)
        async with acquire() as conn:
            raw = await conn.fetch(
                """
                SELECT c.id, c.text, c.document_id
                FROM rag.chunk c JOIN rag.document d ON d.id = c.document_id
                WHERE $1 = ANY(c.entity_refs)
                  AND d.updated_at BETWEEN $2 AND $3
                ORDER BY d.updated_at DESC
                LIMIT 30
                """,
                entity_ref,
                start,
                end,
            )
        bodies = [r["text"] for r in raw]
        chunk_ids = [r["id"] for r in raw]
        doc_ids = sorted({r["document_id"] for r in raw})
    else:
        bodies = [r["text"] for r in l1s]
        chunk_ids = []
        doc_ids = sorted({d for r in l1s for d in (r["source_doc_ids"] or [])})

    if not bodies:
        return None

    body_blob = "\n\n---\n\n".join(bodies)
    content_hash = _hash([entity_ref, window, body_blob])

    async with acquire() as conn:
        existing = await conn.fetchrow(
            """
            SELECT id, content_hash FROM rag.summary
            WHERE layer = 2 AND entity_type = $1 AND entity_id = $2 AND window = $3
            ORDER BY window_end DESC NULLS LAST, created_at DESC LIMIT 1
            """,
            entity_type,
            entity_id,
            window,
        )
        if existing and existing["content_hash"] == content_hash:
            return str(existing["id"])

    user = f"# Entity: {entity_ref}  · window={window}\n\n{body_blob}"
    text = await _summarize_with_haiku(system=L2_SYSTEM, user=user, max_tokens=900)

    async with acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO rag.summary
                (workspace_id, layer, entity_type, entity_id, window,
                 window_start, window_end, text, token_count,
                 source_chunk_ids, source_doc_ids, content_hash)
            VALUES ($1, 2, $2, $3, $4, $5, $6, $7, $8, $9::uuid[], $10::uuid[], $11)
            RETURNING id
            """,
            workspace_id,
            entity_type,
            entity_id,
            window,
            start,
            end,
            text,
            token_count(text),
            chunk_ids,
            doc_ids,
            content_hash,
        )
    return str(row["id"])


# ─── L3 time digest ───────────────────────────────────────────────────────────

L3_SYSTEM = (
    "You write a calm, senior engineering chief-of-staff digest for a CEO. "
    "2-4 sentence narrative, then sections: progress · risks · decisions needed. "
    "Cite engineer names, ticket keys, and service names verbatim. No invention."
)


async def build_l3_daily_digest(
    *, when: datetime | None = None, workspace_id: str | None = None
) -> str | None:
    """Daily org-wide digest from the L2 entity rollups + L1s in the last 24h."""
    end = when or datetime.now(timezone.utc)
    start = end - timedelta(days=1)

    async with acquire() as conn:
        l2s = await conn.fetch(
            """
            SELECT id, entity_type, entity_id, text, source_doc_ids
            FROM rag.summary
            WHERE layer = 2
              AND ($1::text IS NULL OR workspace_id IS NULL OR workspace_id = $1)
              AND window IN ('day', 'week')
              AND window_end >= $2
            ORDER BY window_end DESC
            LIMIT 30
            """,
            workspace_id,
            start,
        )

    if not l2s:
        return None
    bodies = [f"## {r['entity_type']}:{r['entity_id']}\n{r['text']}" for r in l2s]
    body_blob = "\n\n".join(bodies)
    content_hash = _hash(["daily", end.date().isoformat(), body_blob])

    async with acquire() as conn:
        existing = await conn.fetchrow(
            """
            SELECT id, content_hash FROM rag.summary
            WHERE layer = 3 AND window = 'day' AND window_end::date = $1::date
            ORDER BY created_at DESC LIMIT 1
            """,
            end.date(),
        )
        if existing and existing["content_hash"] == content_hash:
            return str(existing["id"])

    user = f"# Org daily digest — {end.date()}\n\n{body_blob}"
    text = await _summarize_with_haiku(system=L3_SYSTEM, user=user, max_tokens=1100)

    doc_ids = sorted({d for r in l2s for d in (r["source_doc_ids"] or [])})
    async with acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO rag.summary
                (workspace_id, layer, entity_type, entity_id, window,
                 window_start, window_end, text, token_count,
                 source_chunk_ids, source_doc_ids, content_hash)
            VALUES ($1, 3, NULL, NULL, 'day', $2, $3, $4, $5,
                    ARRAY[]::uuid[], $6::uuid[], $7)
            RETURNING id
            """,
            workspace_id,
            start,
            end,
            text,
            token_count(text),
            doc_ids,
            content_hash,
        )
    return str(row["id"])


async def list_active_entities(
    *, workspace_id: str | None = None, since: datetime | None = None
) -> list[tuple[str, str]]:
    """Entities touched recently — drives the L2 worker's iteration list."""
    since = since or (datetime.now(timezone.utc) - timedelta(days=14))
    async with acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT DISTINCT unnest(d.entity_refs) AS ref
            FROM rag.document d
            WHERE ($1::text IS NULL OR d.workspace_id IS NULL OR d.workspace_id = $1)
              AND d.updated_at >= $2
              AND d.deleted_at IS NULL
            """,
            workspace_id,
            since,
        )
    out: list[tuple[str, str]] = []
    for r in rows:
        ref = str(r["ref"])
        if ":" not in ref:
            continue
        kind, _, eid = ref.partition(":")
        if kind in {"engineer", "team", "service", "sprint"} and eid:
            out.append((kind, eid))
    return out
