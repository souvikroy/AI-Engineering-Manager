"""Event bus.

`emit_event(...)`: write to Postgres `JobEvent` (durable) AND to Upstash Redis stream
`events:job:<id>` (realtime). SSE handler tails the Redis stream and degrades to
Postgres polling if Upstash is unavailable.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Optional

from sqlalchemy import select

from reviewer.persistence.models import Job, JobEvent, session_maker

from ..security.upstash import upstash

log = logging.getLogger(__name__)


def _stream_key(job_id: str) -> str:
    return f"events:job:{job_id}"


def emit_event_sync(job_id: str, *, stage: str, workflow: Optional[int] = None, message: Optional[str] = None,
                    data: Optional[dict[str, Any]] = None, user_id: Optional[str] = None) -> int:
    """Synchronous event emission. Writes to Postgres always; pushes to Redis best-effort.
    Returns the event's row id (also used as the SSE event id).
    """
    with session_maker()() as s:
        ev = JobEvent(
            job_id=job_id,
            user_id=user_id,
            stage=stage,
            workflow=workflow,
            message=message,
            data=data or {},
        )
        s.add(ev)
        s.commit()
        s.refresh(ev)
        evt_id = ev.id

    # Best-effort Redis push (fire-and-forget).
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.create_task(_publish_redis(job_id, evt_id, stage, workflow, message, data))
        else:
            asyncio.run(_publish_redis(job_id, evt_id, stage, workflow, message, data))
    except Exception as e:  # noqa: BLE001
        log.debug("redis publish skipped: %s", e)
    return evt_id


async def _publish_redis(job_id: str, evt_id: int, stage: str, workflow: Optional[int],
                         message: Optional[str], data: Optional[dict[str, Any]]) -> None:
    u = upstash()
    if not u.configured:
        return
    try:
        await u.xadd(_stream_key(job_id), {
            "evt_id": str(evt_id),
            "stage": stage,
            "workflow": str(workflow) if workflow is not None else "",
            "message": message or "",
            "data": json.dumps(data or {}),
            "ts": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as e:  # noqa: BLE001
        log.warning("xadd failed: %s", e)


def replay_history(job_id: str, *, since_id: int = 0) -> list[dict]:
    with session_maker()() as s:
        rows = list(s.scalars(
            select(JobEvent).where(JobEvent.job_id == job_id, JobEvent.id > since_id).order_by(JobEvent.id)
        ))
    return [_row_to_dict(r) for r in rows]


def _row_to_dict(r: JobEvent) -> dict:
    return {
        "id": r.id,
        "stage": r.stage,
        "workflow": r.workflow,
        "message": r.message,
        "data": r.data or {},
        "ts": r.ts.isoformat() if r.ts else None,
    }


async def tail(job_id: str, *, since_id: int = 0, idle_timeout_s: int = 600) -> AsyncIterator[dict]:
    """Yield events: replay history first, then tail Redis stream until job is done."""
    # 1. Replay durable history.
    last_id = since_id
    for ev in replay_history(job_id, since_id=since_id):
        yield ev
        last_id = max(last_id, ev["id"])

    # 2. Tail Redis stream.
    u = upstash()
    last_redis_id = "$"
    deadline = asyncio.get_event_loop().time() + idle_timeout_s
    while True:
        if not u.configured:
            # Degrade to Postgres polling.
            await asyncio.sleep(2.0)
            new_rows = replay_history(job_id, since_id=last_id)
            for ev in new_rows:
                yield ev
                last_id = max(last_id, ev["id"])
                if ev["stage"] in ("done", "failed"):
                    return
            if asyncio.get_event_loop().time() > deadline:
                return
            continue

        try:
            res = await u.xread_block(_stream_key(job_id), last_redis_id, block_ms=20000, count=50)
        except Exception as e:  # noqa: BLE001
            log.warning("tail xread error: %s", e)
            await asyncio.sleep(2.0)
            continue
        if not res:
            # heartbeat poll
            if asyncio.get_event_loop().time() > deadline:
                return
            continue
        # Upstash returns: [[stream_name, [[entry_id, [field, value, field, value, ...]], ...]], ...]
        for _stream, entries in res:
            for entry in entries:
                entry_id, fields_list = entry
                last_redis_id = entry_id
                event = _entry_to_event(fields_list)
                yield event
                if event.get("id"):
                    last_id = max(last_id, int(event["id"]))
                if event.get("stage") in ("done", "failed"):
                    return


def _entry_to_event(fields_list: list[Any]) -> dict[str, Any]:
    flat: dict[str, str] = {}
    for i in range(0, len(fields_list), 2):
        flat[str(fields_list[i])] = str(fields_list[i + 1])
    out = {
        "id": int(flat.get("evt_id", "0")) or None,
        "stage": flat.get("stage", ""),
        "workflow": int(flat["workflow"]) if flat.get("workflow") else None,
        "message": flat.get("message"),
        "ts": flat.get("ts"),
    }
    raw = flat.get("data", "{}")
    try:
        out["data"] = json.loads(raw)
    except json.JSONDecodeError:
        out["data"] = {}
    return out
