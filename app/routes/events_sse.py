"""SSE endpoint for live job progress."""

from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from reviewer.persistence.models import Job, session_maker

from ..auth.jwt_codec import verify_token
from ..events.bus import tail

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/jobs", tags=["events"])


@router.get("/{job_id}/events")
async def sse_events(job_id: str, request: Request,
                     t: str = Query(..., description="short-lived event token from /event-token"),
                     last_event_id: int = Query(default=0, alias="last_event_id")) -> StreamingResponse:
    try:
        payload = verify_token(t, scope="events")
    except PermissionError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e

    if payload.get("job_id") != job_id:
        raise HTTPException(status_code=403, detail="token job mismatch")
    user_id = str(payload["sub"])

    # Verify ownership.
    with session_maker()() as s:
        j = s.get(Job, job_id)
        if j is None or j.user_id != user_id:
            raise HTTPException(status_code=404, detail="job not found")

    async def stream():
        # Allow reconnection via Last-Event-ID header.
        since = last_event_id or 0
        header_id = request.headers.get("last-event-id")
        if header_id and header_id.isdigit():
            since = int(header_id)

        # Heartbeat task to keep proxy connections open.
        async def heartbeat():
            while True:
                yield ": ping\n\n"
                await asyncio.sleep(15)

        last_heartbeat = asyncio.get_event_loop().time()
        try:
            async for event in tail(job_id, since_id=since):
                payload = {
                    "stage": event.get("stage"),
                    "workflow": event.get("workflow"),
                    "message": event.get("message"),
                    "data": event.get("data"),
                    "ts": event.get("ts"),
                }
                evt_id = event.get("id") or 0
                yield f"id: {evt_id}\ndata: {json.dumps(payload)}\n\n"
                # Inject heartbeat if quiet.
                now = asyncio.get_event_loop().time()
                if now - last_heartbeat > 15:
                    yield ": ping\n\n"
                    last_heartbeat = now
                if event.get("stage") in ("done", "failed"):
                    yield "event: end\ndata: {}\n\n"
                    return
        except asyncio.CancelledError:
            log.info("SSE cancelled by client for job %s", job_id)
            raise

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
