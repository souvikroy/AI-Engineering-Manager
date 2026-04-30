"""Identity resolution — Slack U… ↔ GitHub login ↔ Jira accountId ↔ engineer entity.

Confidence rule: NEVER auto-merge below 0.9. Below the threshold we create a
new entity per provider id; manual review consolidates later.
"""
from __future__ import annotations

from ..db import acquire

CONFIDENCE_AUTO_MERGE = 0.9


async def resolve_provider_id(
    provider: str, provider_id: str, *, workspace_id: str | None = None
) -> str | None:
    """Return the canonical entity id for (provider, provider_id), or None."""
    async with acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT entity_id FROM rag.identity
            WHERE provider = $1 AND provider_id = $2
              AND ($3::text IS NULL OR workspace_id IS NULL OR workspace_id = $3)
            ORDER BY confidence DESC LIMIT 1
            """,
            provider,
            provider_id,
            workspace_id,
        )
    return str(row["entity_id"]) if row else None


async def upsert_entity_with_identity(
    *,
    entity_id: str,
    kind: str,
    name: str,
    provider: str,
    provider_id: str,
    handle: str | None,
    confidence: float = 1.0,
    workspace_id: str | None = None,
    metadata: dict | None = None,
) -> str:
    """Idempotent: ensures the canonical entity exists and its provider link is recorded.

    If the (provider, provider_id) is already mapped to a different entity with
    confidence >= 0.9, returns the existing entity_id (no merge).
    """
    existing = await resolve_provider_id(provider, provider_id, workspace_id=workspace_id)
    if existing is not None:
        return existing

    async with acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                INSERT INTO rag.entity (id, workspace_id, kind, name, metadata)
                VALUES ($1, $2, $3, $4, $5::jsonb)
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    metadata = rag.entity.metadata || EXCLUDED.metadata,
                    updated_at = now()
                """,
                entity_id,
                workspace_id,
                kind,
                name,
                __import__("json").dumps(metadata or {}),
            )
            await conn.execute(
                """
                INSERT INTO rag.identity
                    (workspace_id, entity_id, provider, provider_id, handle, confidence)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (provider, provider_id) DO UPDATE SET
                    handle = EXCLUDED.handle,
                    confidence = GREATEST(rag.identity.confidence, EXCLUDED.confidence)
                """,
                workspace_id,
                entity_id,
                provider,
                provider_id,
                handle,
                confidence,
            )
    return entity_id
