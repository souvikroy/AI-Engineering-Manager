"""Initial rag schema — Document, Chunk, Summary, Entity, Identity, IngestCursor, OAuthCredential.

Revision ID: 0001_rag_initial
Revises:
Create Date: 2026-04-30
"""
from __future__ import annotations

from alembic import op

revision = "0001_rag_initial"
down_revision = None
branch_labels = None
depends_on = None

# Note: vector dimension matches Settings.embedding_dim (default 1024 for voyage-3).
EMBEDDING_DIM = 1024


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute("CREATE SCHEMA IF NOT EXISTS rag")

    # ─── document ──────────────────────────────────────────────────────────────
    op.execute(
        """
        CREATE TABLE rag.document (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            workspace_id  TEXT,
            source        TEXT NOT NULL,
            source_id     TEXT NOT NULL,
            source_url    TEXT,
            title         TEXT NOT NULL DEFAULT '',
            content_hash  TEXT NOT NULL,
            metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
            entity_refs   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            deleted_at    TIMESTAMPTZ,
            UNIQUE (source, source_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX document_workspace_source_updated_idx "
        "ON rag.document (workspace_id, source, updated_at DESC)"
    )
    op.execute(
        "CREATE INDEX document_entity_refs_gin "
        "ON rag.document USING GIN (entity_refs)"
    )
    op.execute(
        "CREATE INDEX document_metadata_gin "
        "ON rag.document USING GIN (metadata jsonb_path_ops)"
    )

    # ─── chunk ─────────────────────────────────────────────────────────────────
    op.execute(
        f"""
        CREATE TABLE rag.chunk (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            workspace_id        TEXT,
            document_id         UUID NOT NULL REFERENCES rag.document(id) ON DELETE CASCADE,
            ordinal             INTEGER NOT NULL,
            text                TEXT NOT NULL,
            token_count         INTEGER NOT NULL DEFAULT 0,
            entity_refs         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
            embedding           vector({EMBEDDING_DIM}),
            tsv                 tsvector,
            embedding_model     TEXT NOT NULL,
            embedding_version   TEXT NOT NULL,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (document_id, ordinal)
        )
        """
    )
    op.execute(
        "CREATE INDEX chunk_tsv_gin ON rag.chunk USING GIN (tsv)"
    )
    op.execute(
        "CREATE INDEX chunk_entity_refs_gin ON rag.chunk USING GIN (entity_refs)"
    )
    # IVFFlat needs ANALYZE to choose `lists` well; 100 is a fine default for cold start.
    op.execute(
        f"CREATE INDEX chunk_embedding_ivfflat ON rag.chunk USING ivfflat "
        f"(embedding vector_cosine_ops) WITH (lists = 100)"
    )
    op.execute(
        "CREATE INDEX chunk_workspace_idx ON rag.chunk (workspace_id, document_id, ordinal)"
    )

    # ─── summary (L1/L2/L3) ────────────────────────────────────────────────────
    op.execute(
        f"""
        CREATE TABLE rag.summary (
            id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            workspace_id      TEXT,
            layer             SMALLINT NOT NULL CHECK (layer IN (1, 2, 3)),
            entity_type       TEXT,
            entity_id         TEXT,
            window            TEXT,
            window_start      TIMESTAMPTZ,
            window_end        TIMESTAMPTZ,
            text              TEXT NOT NULL,
            token_count       INTEGER NOT NULL DEFAULT 0,
            source_chunk_ids  UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
            source_doc_ids    UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
            embedding         vector({EMBEDDING_DIM}),
            content_hash      TEXT NOT NULL,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX summary_lookup_idx ON rag.summary "
        "(workspace_id, layer, entity_type, entity_id, window_end DESC NULLS LAST)"
    )
    op.execute(
        "CREATE INDEX summary_embedding_ivfflat ON rag.summary USING ivfflat "
        "(embedding vector_cosine_ops) WITH (lists = 50)"
    )

    # ─── entity (canonical) + identity (resolution) ────────────────────────────
    op.execute(
        """
        CREATE TABLE rag.entity (
            id            TEXT PRIMARY KEY,
            workspace_id  TEXT,
            kind          TEXT NOT NULL,
            name          TEXT NOT NULL,
            metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX entity_kind_idx ON rag.entity (workspace_id, kind)")

    op.execute(
        """
        CREATE TABLE rag.identity (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            workspace_id  TEXT,
            entity_id     TEXT NOT NULL REFERENCES rag.entity(id) ON DELETE CASCADE,
            provider      TEXT NOT NULL,
            provider_id   TEXT NOT NULL,
            handle        TEXT,
            confidence    DOUBLE PRECISION NOT NULL DEFAULT 1.0
                              CHECK (confidence >= 0 AND confidence <= 1),
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (provider, provider_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX identity_entity_idx ON rag.identity (entity_id)"
    )

    # ─── ingest_cursor ─────────────────────────────────────────────────────────
    op.execute(
        """
        CREATE TABLE rag.ingest_cursor (
            id            TEXT PRIMARY KEY,
            workspace_id  TEXT,
            cursor        TEXT,
            last_run_at   TIMESTAMPTZ,
            last_ok_at    TIMESTAMPTZ,
            error_streak  INTEGER NOT NULL DEFAULT 0,
            metadata      JSONB NOT NULL DEFAULT '{}'::jsonb
        )
        """
    )

    # ─── oauth_credential (encrypt at app layer; column is opaque ciphertext) ──
    op.execute(
        """
        CREATE TABLE rag.oauth_credential (
            id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            workspace_id   TEXT,
            provider       TEXT NOT NULL,
            access_token   TEXT NOT NULL,
            refresh_token  TEXT,
            expires_at     TIMESTAMPTZ,
            scopes         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
            created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (workspace_id, provider)
        )
        """
    )


def downgrade() -> None:
    for tbl in (
        "oauth_credential",
        "ingest_cursor",
        "identity",
        "entity",
        "summary",
        "chunk",
        "document",
    ):
        op.execute(f"DROP TABLE IF EXISTS rag.{tbl} CASCADE")
    op.execute("DROP SCHEMA IF EXISTS rag CASCADE")
