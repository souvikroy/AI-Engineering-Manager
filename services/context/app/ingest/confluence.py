"""Confluence ingest — cron-driven CQL pull of recently-modified pages.

Activates only when both `CONFLUENCE_BASE_URL` and `CONFLUENCE_PAT` are set;
otherwise `sync_confluence` is a no-op so the scheduler doesn't crash in dev.

Strategy:
- Use atlassian-python-api when available (lazy import).
- CQL: `lastModified >= cursor AND type = "page"`.
- Each page becomes a Document; chunked on H2/H3 by the markdown chunker.
- Cursor stored at `confluence:<space>` granularity.
- PDF/image attachments are NOT yet OCR'd; we mark
  `metadata.has_unindexed_attachments=true` so the UI can surface that.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

from ..config import get_settings
from ..db import acquire
from ..rag.chunk import chunk_markdown
from .base import upsert_document

log = logging.getLogger(__name__)


def _strip_html(html: str) -> str:
    """Cheap HTML→text. We avoid bs4 to keep dependencies tight; Confluence's
    storage format is XHTML-ish and a tag-strip works fine for chunking."""
    text = re.sub(r"<br\s*/?>", "\n", html, flags=re.IGNORECASE)
    text = re.sub(r"</p>", "\n\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text


def _client():
    settings = get_settings()
    if not (settings.confluence_base_url and settings.confluence_pat):
        return None
    try:
        from atlassian import Confluence
    except ImportError:
        log.warning("atlassian-python-api not installed; confluence ingest disabled")
        return None
    return Confluence(
        url=settings.confluence_base_url,
        token=settings.confluence_pat,
        cloud=True,
    )


async def _last_cursor_for(space: str) -> str | None:
    async with acquire() as conn:
        row = await conn.fetchrow(
            "SELECT cursor FROM rag.ingest_cursor WHERE id = $1",
            f"confluence:{space}",
        )
    return row["cursor"] if row else None


async def sync_space(space: str, *, workspace_id: str | None = None) -> dict[str, int]:
    """Pull pages from a single Confluence space modified since the cursor."""
    client = _client()
    if client is None:
        return {"accepted": 0, "skipped": 0, "reason_no_creds": 1}

    cursor = await _last_cursor_for(space)
    cql = f'space = "{space}" AND type = "page"'
    if cursor:
        cql += f' AND lastModified > "{cursor}"'

    accepted = 0
    skipped = 0
    # The atlassian client is sync; this loop is fine for hourly cron volume.
    for page in client.cql(cql, expand="body.storage,version", limit=200).get("results", []):
        content_html = page.get("body", {}).get("storage", {}).get("value", "") or ""
        text = _strip_html(content_html)
        if not text.strip():
            skipped += 1
            continue
        title = page.get("title", "")
        page_id = str(page.get("id"))
        url = (page.get("_links", {}).get("base", "") or "") + (
            page.get("_links", {}).get("webui", "") or ""
        )
        version = page.get("version", {}).get("when") or ""
        attachments_count = page.get("metadata", {}).get("properties", {}).get("attachments", 0)
        res = await upsert_document(
            source="confluence",
            source_id=page_id,
            title=title,
            content=text,
            source_url=url or None,
            metadata={
                "space": space,
                "version_when": version,
                "has_unindexed_attachments": bool(attachments_count),
            },
            chunker_fn=chunk_markdown,
            workspace_id=workspace_id,
            cursor_id=f"confluence:{space}",
            cursor=version or datetime.now(timezone.utc).isoformat(),
        )
        if res.get("skipped"):
            skipped += 1
        else:
            accepted += 1
    log.info("confluence.sync_space", space=space, accepted=accepted, skipped=skipped)
    return {"accepted": accepted, "skipped": skipped}


async def sync_all_known_spaces(*, workspace_id: str | None = None) -> dict[str, int]:
    """Sync every space that already has a cursor row — i.e. spaces we've seen before.

    For a fresh install, call sync_space(<space-key>) once manually via the
    /admin/sync/confluence endpoint to register the cursor.
    """
    async with acquire() as conn:
        rows = await conn.fetch(
            "SELECT id FROM rag.ingest_cursor WHERE id LIKE 'confluence:%'"
        )
    totals = {"accepted": 0, "skipped": 0}
    for r in rows:
        space = str(r["id"]).removeprefix("confluence:")
        out = await sync_space(space, workspace_id=workspace_id)
        for k, v in out.items():
            totals[k] = totals.get(k, 0) + int(v)
    return totals
