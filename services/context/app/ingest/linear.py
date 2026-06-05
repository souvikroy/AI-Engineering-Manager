"""Linear ingest — webhook (`Issue` subscription) + cron 5min backfill via GraphQL.

Activates when `LINEAR_API_KEY` is set. The webhook path handles a single issue
per call; the cron path pulls all issues updated since the cursor.

Identity: Linear users have an email; we map `email → identity(provider="linear")`.
Entity refs: `ticket:<identifier>` (e.g. `ticket:ENG-42`), team key, assignee.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from ..config import get_settings
from ..db import acquire
from ..rag.chunk import chunk_jira_issue
from .base import upsert_document

log = logging.getLogger(__name__)


def _refs_for(issue: dict[str, Any]) -> list[str]:
    refs: list[str] = []
    ident = issue.get("identifier")
    if ident:
        refs.append(f"ticket:{ident}")
    team = (issue.get("team") or {}).get("key")
    if team:
        refs.append(f"team:{team.lower()}")
    assignee_email = (issue.get("assignee") or {}).get("email")
    if assignee_email:
        # We use email as a stable provider id since Linear emails are unique.
        refs.append(f"engineer:linear:{assignee_email.split('@')[0]}")
    return refs


def _comment_bodies(issue: dict[str, Any]) -> list[str]:
    edges = ((issue.get("comments") or {}).get("nodes")) or []
    return [c.get("body", "") for c in edges if c.get("body")]


async def _upsert_one(issue: dict[str, Any], *, workspace_id: str | None = None) -> dict:
    ident = issue.get("identifier")
    if not ident:
        return {"skipped": True, "reason": "no_identifier"}
    title = issue.get("title", ident)
    desc = issue.get("description") or ""
    comments = _comment_bodies(issue)
    body = "\n\n".join([desc, *comments]).strip()
    if not body:
        body = title  # ensure something is indexed
    return await upsert_document(
        source="linear",
        source_id=ident,
        title=title,
        content=body,
        source_url=issue.get("url"),
        metadata={
            "team": (issue.get("team") or {}).get("key"),
            "state": (issue.get("state") or {}).get("name"),
            "priority": issue.get("priority"),
        },
        entity_refs=_refs_for(issue),
        chunker_fn=lambda _s: chunk_jira_issue(desc, comments),
        workspace_id=workspace_id,
        cursor_id=f"linear:{(issue.get('team') or {}).get('key', 'all')}",
        cursor=issue.get("updatedAt"),
    )


async def ingest_webhook(payload: dict[str, Any], *, workspace_id: str | None = None) -> dict:
    """Linear sends `{ action, type, data }`. We care about action in {create, update}
    and type == "Issue"."""
    if payload.get("type") != "Issue":
        return {"skipped": True, "reason": "wrong_type"}
    if payload.get("action") not in {"create", "update"}:
        return {"skipped": True, "reason": "unhandled_action"}
    return await _upsert_one(payload.get("data") or {}, workspace_id=workspace_id)


# ─── GraphQL backfill ────────────────────────────────────────────────────────

ISSUES_QUERY = """
query Backfill($since: DateTimeOrDuration!, $first: Int!) {
  issues(filter: { updatedAt: { gt: $since } }, first: $first, orderBy: updatedAt) {
    nodes {
      id
      identifier
      title
      description
      url
      priority
      updatedAt
      state { name }
      team { key }
      assignee { email name }
      comments(first: 20) { nodes { body createdAt user { email } } }
    }
  }
}
"""


async def _last_cursor(team_key: str) -> str | None:
    async with acquire() as conn:
        row = await conn.fetchrow(
            "SELECT cursor FROM rag.ingest_cursor WHERE id = $1", f"linear:{team_key}"
        )
    return row["cursor"] if row else None


async def backfill(*, workspace_id: str | None = None, team: str = "all") -> dict[str, int]:
    settings = get_settings()
    if not settings.linear_api_key:
        return {"accepted": 0, "skipped": 0, "reason_no_creds": 1}
    try:
        from gql import Client, gql
        from gql.transport.httpx import HTTPXAsyncTransport
    except ImportError:
        log.warning("gql not installed; linear backfill disabled")
        return {"accepted": 0, "skipped": 0, "reason_no_gql": 1}

    transport = HTTPXAsyncTransport(
        url="https://api.linear.app/graphql",
        headers={"Authorization": settings.linear_api_key},
    )
    accepted = 0
    skipped = 0
    since = await _last_cursor(team) or "P30D"  # last 30 days when bootstrapping

    async with Client(transport=transport, fetch_schema_from_transport=False) as session:
        result = await session.execute(
            gql(ISSUES_QUERY), variable_values={"since": since, "first": 100}
        )
    nodes = ((result or {}).get("issues") or {}).get("nodes") or []
    for issue in nodes:
        out = await _upsert_one(issue, workspace_id=workspace_id)
        if out.get("skipped"):
            skipped += 1
        else:
            accepted += 1
    log.info(
        "linear.backfill", team=team, accepted=accepted, skipped=skipped, since=since
    )
    if nodes:
        # Keep the cursor at the most recent updatedAt we saw.
        latest = max((n.get("updatedAt") or "") for n in nodes)
        if latest:
            async with acquire() as conn:
                now = datetime.now(timezone.utc)
                await conn.execute(
                    """
                    INSERT INTO rag.ingest_cursor (id, cursor, last_run_at, last_ok_at, error_streak)
                    VALUES ($1, $2, $3, $3, 0)
                    ON CONFLICT (id) DO UPDATE SET
                        cursor = EXCLUDED.cursor,
                        last_run_at = EXCLUDED.last_run_at,
                        last_ok_at = EXCLUDED.last_ok_at,
                        error_streak = 0
                    """,
                    f"linear:{team}",
                    latest,
                    now,
                )
    return {"accepted": accepted, "skipped": skipped}
