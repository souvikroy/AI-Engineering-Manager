"""FastAPI entrypoint for the AI-EM context service.

Exposes:
- POST /search                — hybrid retrieval (BM25 + vector + rerank), with recursive overflow valve
- GET  /summary               — L1/L2/L3 hierarchical summaries
- GET  /doc/{id}              — fetch a single Document
- GET  /freshness             — per-source data age in seconds
- POST /ingest/{source}       — webhook receivers for live integrations
- POST /admin/sync/{source}   — trigger backfill for a source
- GET  /healthz               — liveness/readiness

All responses include provenance citations so the Next.js chat layer can enforce
its post-generation verifier.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI

from .config import get_settings
from .db import close_pool, init_pool
from .routers import admin, doc, freshness, health, ingest, retrieve, summary
from .workers import scheduler as workers

settings = get_settings()
logging.basicConfig(level=settings.log_level)
log = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    log.info("service.startup", schema=settings.rag_schema)
    await init_pool()
    if settings.sentry_dsn_self:
        import sentry_sdk

        sentry_sdk.init(dsn=settings.sentry_dsn_self, traces_sample_rate=0.1)
    workers.start_scheduler()
    yield
    await workers.stop_scheduler()
    await close_pool()
    log.info("service.shutdown")


app = FastAPI(
    title="AI-EM Context Engine",
    version="0.1.0",
    description="Recursive RAG + ingest pipelines for the AI-EM Copilot.",
    lifespan=lifespan,
)

app.include_router(health.router)
app.include_router(retrieve.router)
app.include_router(summary.router)
app.include_router(doc.router)
app.include_router(freshness.router)
app.include_router(ingest.router)
app.include_router(admin.router)
