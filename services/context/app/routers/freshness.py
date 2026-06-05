"""Per-source freshness endpoint — what's the age of the most recent successful sync per source."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter

from ..db import acquire
from ..schemas.common import FreshnessMap

router = APIRouter(tags=["freshness"])


@router.get("/freshness", response_model=FreshnessMap)
async def get_freshness() -> FreshnessMap:
    """Return seconds-since-last-OK-sync per source. None means the source has never synced."""
    sources: dict[str, int | None] = {
        "slack": None,
        "jira": None,
        "linear": None,
        "sentry": None,
        "confluence": None,
        "notion": None,
        "gsheet": None,
        "github": None,
    }
    now = datetime.now(timezone.utc)
    async with acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, last_ok_at
            FROM rag.ingest_cursor
            WHERE last_ok_at IS NOT NULL
            """
        )
    for row in rows:
        source = str(row["id"]).split(":", 1)[0]
        if source not in sources:
            continue
        age = int((now - row["last_ok_at"].replace(tzinfo=timezone.utc)).total_seconds())
        # keep the freshest sync per source
        cur = sources[source]
        if cur is None or age < cur:
            sources[source] = age
    return FreshnessMap(sources=sources, as_of=now)  # type: ignore[arg-type]
