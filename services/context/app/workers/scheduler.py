"""APScheduler driver for L1/L2/L3 builds + integration polls.

L1 is built on-demand from `upsert_document()` callers (Phase 3 wires that),
plus a sweeper that catches any docs lacking an L1.
L2 runs hourly per active entity.
L3 runs daily at 06:00 UTC.

In dev / single-instance prod, APScheduler runs in-process. For multi-instance,
swap to an external scheduler (Cloud Scheduler, k8s CronJob).
"""
from __future__ import annotations

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from ..config import get_settings
from ..db import acquire
from ..ingest import confluence as confluence_ingest
from ..ingest import gsheet as gsheet_ingest
from ..ingest import linear as linear_ingest
from ..ingest import notion as notion_ingest
from ..rag import summarize

log = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None


async def sweep_l1_missing(*, workspace_id: str | None = None) -> int:
    """Build L1 for any Document without one. Cheap on Haiku."""
    async with acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT d.id
            FROM rag.document d
            LEFT JOIN rag.summary s ON s.layer = 1 AND d.id = ANY(s.source_doc_ids)
            WHERE d.deleted_at IS NULL AND s.id IS NULL
              AND ($1::text IS NULL OR d.workspace_id IS NULL OR d.workspace_id = $1)
            ORDER BY d.updated_at DESC
            LIMIT 50
            """,
            workspace_id,
        )
    n = 0
    for r in rows:
        if await summarize.build_l1_summary(str(r["id"]), workspace_id=workspace_id):
            n += 1
    if n:
        log.info("worker.l1_swept", count=n)
    return n


async def run_l2_for_active(*, workspace_id: str | None = None) -> int:
    """Rebuild week-window L2s for every entity touched in the last 14 days."""
    entities = await summarize.list_active_entities(workspace_id=workspace_id)
    n = 0
    for kind, eid in entities:
        try:
            sid = await summarize.build_l2_summary(
                entity_type=kind, entity_id=eid, window="week", workspace_id=workspace_id
            )
            if sid:
                n += 1
        except Exception:  # one bad entity must not kill the sweep
            log.exception("worker.l2_failed", entity=f"{kind}:{eid}")
    if n:
        log.info("worker.l2_built", count=n)
    return n


async def run_l3_daily(*, workspace_id: str | None = None) -> int:
    sid = await summarize.build_l3_daily_digest(workspace_id=workspace_id)
    if sid:
        log.info("worker.l3_built", id=sid)
        return 1
    return 0


async def run_confluence_pull(*, workspace_id: str | None = None) -> dict:
    out = await confluence_ingest.sync_all_known_spaces(workspace_id=workspace_id)
    if out.get("accepted"):
        log.info("worker.confluence_pulled", **out)
    return out


async def run_notion_pull(*, workspace_id: str | None = None) -> dict:
    out = await notion_ingest.sync_all_known_databases(workspace_id=workspace_id)
    if out.get("accepted"):
        log.info("worker.notion_pulled", **out)
    return out


async def run_gsheet_pull(*, workspace_id: str | None = None) -> dict:
    out = await gsheet_ingest.sync_all_known(workspace_id=workspace_id)
    if out.get("accepted"):
        log.info("worker.gsheet_pulled", **out)
    return out


async def run_linear_backfill(*, workspace_id: str | None = None) -> dict:
    out = await linear_ingest.backfill(workspace_id=workspace_id)
    if out.get("accepted"):
        log.info("worker.linear_backfilled", **out)
    return out


def start_scheduler() -> AsyncIOScheduler:
    """Start the in-process scheduler. Idempotent."""
    global _scheduler
    if _scheduler is not None:
        return _scheduler
    settings = get_settings()
    sched = AsyncIOScheduler(timezone="UTC")
    ws = settings.workspace_id

    sched.add_job(
        sweep_l1_missing, IntervalTrigger(minutes=10), kwargs={"workspace_id": ws},
        id="l1_sweep", max_instances=1, coalesce=True,
    )
    sched.add_job(
        run_l2_for_active, CronTrigger(minute=15), kwargs={"workspace_id": ws},
        id="l2_hourly", max_instances=1, coalesce=True,
    )
    sched.add_job(
        run_l3_daily, CronTrigger(hour=6, minute=0), kwargs={"workspace_id": ws},
        id="l3_daily", max_instances=1, coalesce=True,
    )
    sched.add_job(
        run_confluence_pull, IntervalTrigger(minutes=60), kwargs={"workspace_id": ws},
        id="confluence_hourly", max_instances=1, coalesce=True,
    )
    sched.add_job(
        run_notion_pull, IntervalTrigger(minutes=60), kwargs={"workspace_id": ws},
        id="notion_hourly", max_instances=1, coalesce=True,
    )
    sched.add_job(
        run_gsheet_pull, IntervalTrigger(minutes=30), kwargs={"workspace_id": ws},
        id="gsheet_30min", max_instances=1, coalesce=True,
    )
    sched.add_job(
        run_linear_backfill, IntervalTrigger(minutes=5), kwargs={"workspace_id": ws},
        id="linear_5min", max_instances=1, coalesce=True,
    )

    sched.start()
    _scheduler = sched
    log.info("scheduler.started", jobs=[j.id for j in sched.get_jobs()])
    return sched


async def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
