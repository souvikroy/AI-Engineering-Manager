"""Notion ingest — webhook + cron hourly via `notion-client`.

Activates when `NOTION_TOKEN` is set. Notion's official REST API exposes:
- `pages.retrieve` — page metadata (incl. `last_edited_time`).
- `blocks.children.list` — recursively pulls page content.

Notion does NOT (yet, in beta) emit consistent webhooks for content changes;
we do polling via `databases.query` on a configured database id, plus an
on-demand webhook receiver for partner integrations that send `page.updated`.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from ..config import get_settings
from ..db import acquire
from ..rag.chunk import chunk_markdown
from .base import upsert_document

log = logging.getLogger(__name__)


def _client():
    settings = get_settings()
    if not settings.notion_token:
        return None
    try:
        from notion_client import Client
    except ImportError:
        log.warning("notion-client not installed; notion ingest disabled")
        return None
    return Client(auth=settings.notion_token)


def _flatten_blocks(blocks: list[dict[str, Any]]) -> str:
    """Reduce Notion block list to a markdown-ish text body for chunking."""
    out: list[str] = []
    for block in blocks:
        btype = block.get("type", "")
        node = block.get(btype) or {}
        rich = node.get("rich_text") or []
        text = "".join(r.get("plain_text", "") for r in rich)
        if not text and btype not in {"divider", "image"}:
            continue
        if btype == "heading_1":
            out.append(f"# {text}")
        elif btype == "heading_2":
            out.append(f"## {text}")
        elif btype == "heading_3":
            out.append(f"### {text}")
        elif btype == "bulleted_list_item":
            out.append(f"- {text}")
        elif btype == "numbered_list_item":
            out.append(f"1. {text}")
        elif btype == "to_do":
            checked = node.get("checked", False)
            out.append(f"- [{'x' if checked else ' '}] {text}")
        elif btype == "code":
            lang = node.get("language", "")
            out.append(f"```{lang}\n{text}\n```")
        elif btype == "quote":
            out.append(f"> {text}")
        elif btype == "divider":
            out.append("---")
        elif text:
            out.append(text)
    return "\n\n".join(out)


def _page_title(page: dict[str, Any]) -> str:
    props = page.get("properties") or {}
    for prop in props.values():
        if prop.get("type") == "title":
            return "".join(t.get("plain_text", "") for t in prop.get("title", []))
    return page.get("id", "")[:8]


async def _upsert_page(page: dict[str, Any], *, workspace_id: str | None = None) -> dict:
    client = _client()
    if client is None:
        return {"skipped": True, "reason": "no_creds"}
    page_id = page.get("id")
    if not page_id:
        return {"skipped": True, "reason": "no_id"}

    # Pull blocks (one level deep is enough for most pages; recurse for toggles later)
    children = client.blocks.children.list(block_id=page_id, page_size=100)
    body = _flatten_blocks(children.get("results", []) or [])
    if not body.strip():
        return {"skipped": True, "reason": "empty"}

    title = _page_title(page)
    return await upsert_document(
        source="notion",
        source_id=page_id,
        title=title,
        content=body,
        source_url=page.get("url"),
        metadata={
            "last_edited_time": page.get("last_edited_time"),
            "created_time": page.get("created_time"),
            "object": page.get("object"),
        },
        chunker_fn=chunk_markdown,
        workspace_id=workspace_id,
        cursor_id=f"notion:{page.get('parent', {}).get('database_id', 'root')}",
        cursor=page.get("last_edited_time"),
    )


async def ingest_webhook(payload: dict[str, Any], *, workspace_id: str | None = None) -> dict:
    """Partner-integration webhook that supplies a Notion page id.

    Body shape we accept: `{"page_id": "..."}` (kept simple — Notion doesn't
    have a stable webhook payload). Pulls the latest content + upserts.
    """
    page_id = payload.get("page_id") or (payload.get("data") or {}).get("page_id")
    if not page_id:
        return {"skipped": True, "reason": "no_page_id"}
    client = _client()
    if client is None:
        return {"skipped": True, "reason": "no_creds"}
    page = client.pages.retrieve(page_id=page_id)
    return await _upsert_page(page, workspace_id=workspace_id)


async def sync_database(
    database_id: str, *, workspace_id: str | None = None, limit: int = 50
) -> dict[str, int]:
    """Cron path — pull every page from a configured Notion database that
    has been edited since the cursor."""
    client = _client()
    if client is None:
        return {"accepted": 0, "skipped": 0, "reason_no_creds": 1}

    async with acquire() as conn:
        row = await conn.fetchrow(
            "SELECT cursor FROM rag.ingest_cursor WHERE id = $1",
            f"notion:{database_id}",
        )
    cursor = row["cursor"] if row else None

    filter_obj = None
    if cursor:
        filter_obj = {"timestamp": "last_edited_time", "last_edited_time": {"after": cursor}}
    query = client.databases.query(
        database_id=database_id, filter=filter_obj, page_size=limit
    )
    accepted = 0
    skipped = 0
    latest_cursor = cursor
    for page in query.get("results", []):
        out = await _upsert_page(page, workspace_id=workspace_id)
        if out.get("skipped"):
            skipped += 1
        else:
            accepted += 1
        edited = page.get("last_edited_time") or ""
        if edited and (latest_cursor is None or edited > latest_cursor):
            latest_cursor = edited

    if latest_cursor and latest_cursor != cursor:
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
                f"notion:{database_id}",
                latest_cursor,
                now,
            )
    log.info("notion.sync_database", database_id=database_id, accepted=accepted, skipped=skipped)
    return {"accepted": accepted, "skipped": skipped}


async def sync_all_known_databases(*, workspace_id: str | None = None) -> dict[str, int]:
    async with acquire() as conn:
        rows = await conn.fetch(
            "SELECT id FROM rag.ingest_cursor WHERE id LIKE 'notion:%'"
        )
    totals = {"accepted": 0, "skipped": 0}
    for r in rows:
        db_id = str(r["id"]).removeprefix("notion:")
        out = await sync_database(db_id, workspace_id=workspace_id)
        for k, v in out.items():
            totals[k] = totals.get(k, 0) + int(v)
    return totals
