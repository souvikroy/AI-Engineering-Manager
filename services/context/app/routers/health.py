"""Liveness + readiness probes."""
from __future__ import annotations

from fastapi import APIRouter

from ..db import acquire

router = APIRouter(tags=["health"])


@router.get("/healthz")
async def healthz() -> dict[str, object]:
    """Liveness — always 200 if the process is up."""
    return {"ok": True}


@router.get("/readyz")
async def readyz() -> dict[str, object]:
    """Readiness — verifies DB connectivity + pgvector + rag schema."""
    async with acquire() as conn:
        version = await conn.fetchval("SELECT version()")
        has_vector = await conn.fetchval(
            "SELECT 1 FROM pg_extension WHERE extname = 'vector'"
        )
    return {"ok": True, "postgres": version, "pgvector": bool(has_vector)}
