"""Jira ingest — webhook + cron backfill.

Webhook payload shape (subset we care about):
    {
      "webhookEvent": "jira:issue_updated",
      "issue": { "key": "PROD-123", "fields": {...}, "self": "...", "renderedFields": {...} }
    }
"""
from __future__ import annotations

from typing import Any

from ..rag.chunk import chunk_jira_issue
from .base import upsert_document


async def ingest_webhook(payload: dict[str, Any], *, workspace_id: str | None = None) -> dict:
    issue = payload.get("issue") or {}
    key = issue.get("key")
    if not key:
        return {"skipped": True, "reason": "no_key"}
    fields = issue.get("fields", {}) or {}
    rendered = issue.get("renderedFields", {}) or {}
    summary = fields.get("summary") or ""
    desc = rendered.get("description") or fields.get("description") or ""
    comments_raw = (fields.get("comment") or {}).get("comments", []) or []
    comments = [
        (c.get("renderedBody") or c.get("body") or "")
        for c in comments_raw
        if (c.get("renderedBody") or c.get("body"))
    ]
    body = "\n\n".join([summary, desc] + comments).strip()
    if not body:
        return {"skipped": True, "reason": "empty"}

    project = (fields.get("project") or {}).get("key", "")
    assignee = (fields.get("assignee") or {}).get("accountId")
    refs = [f"ticket:{key}"]
    if project:
        refs.append(f"team:{project.lower()}")
    if assignee:
        refs.append(f"engineer:jira:{assignee}")

    return await upsert_document(
        source="jira",
        source_id=key,
        title=summary or key,
        content=body,
        source_url=issue.get("self"),
        metadata={"project": project, "status": (fields.get("status") or {}).get("name")},
        entity_refs=refs,
        chunker_fn=lambda _s: chunk_jira_issue(desc, comments),
        workspace_id=workspace_id,
        cursor_id=f"jira:{project or 'all'}",
        cursor=fields.get("updated"),
    )
