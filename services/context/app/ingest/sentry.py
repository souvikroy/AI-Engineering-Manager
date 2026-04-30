"""Sentry ingest — webhook for issue.created/issue.resolved + cron 10min backfill."""
from __future__ import annotations

from typing import Any

from ..rag.chunk import chunk_sentry_issue
from .base import upsert_document


async def ingest_webhook(payload: dict[str, Any], *, workspace_id: str | None = None) -> dict:
    data = payload.get("data") or {}
    issue = data.get("issue") or payload.get("issue") or {}
    issue_id = str(issue.get("id") or issue.get("shortId") or "")
    if not issue_id:
        return {"skipped": True, "reason": "no_id"}
    title = issue.get("title") or issue.get("metadata", {}).get("title", "")
    culprit = issue.get("culprit") or ""
    top_frame = ""
    first_event_msg = ""
    last_event = (issue.get("lastSeen") or "")

    project = (issue.get("project") or {}).get("slug", "")
    assignee = (issue.get("assignedTo") or {}).get("username")
    refs = [f"sentry:{issue.get('shortId') or issue_id}"]
    if project:
        refs.append(f"service:{project}")
    if assignee:
        refs.append(f"engineer:gh:{assignee}")

    body = "\n\n".join([title, culprit, top_frame, first_event_msg]).strip()
    return await upsert_document(
        source="sentry",
        source_id=issue_id,
        title=title or f"Sentry issue {issue_id}",
        content=body,
        source_url=issue.get("permalink") or issue.get("web_url"),
        metadata={
            "project": project,
            "level": issue.get("level"),
            "status": issue.get("status"),
            "occurrence_count": issue.get("count"),
        },
        entity_refs=refs,
        chunker_fn=lambda _s: chunk_sentry_issue(title, culprit, top_frame, first_event_msg)
        or [body],
        workspace_id=workspace_id,
        cursor_id=f"sentry:{project or 'all'}",
        cursor=last_event,
    )
