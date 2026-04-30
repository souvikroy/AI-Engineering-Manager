"""Slack ingest — Events API webhook + backfill via slack-sdk.

Phase 1: webhook receiver shape + thread-rollup helper.
Phase 3 (live): wire `slack_sdk.AsyncWebClient` for backfill, run the L2 worker.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from ..rag.identity import resolve_provider_id
from .base import upsert_document


def _channel_thread_url(team: str | None, channel: str, ts: str) -> str | None:
    if not team:
        return None
    flat = ts.replace(".", "")
    return f"https://{team}.slack.com/archives/{channel}/p{flat}"


async def ingest_event(payload: dict[str, Any], *, workspace_id: str | None = None) -> dict:
    """Handle a single Slack `event_callback` payload.

    Stores either a single message Document or appends to an existing thread Doc
    (Phase-3 path). For now we treat each message as its own Document.
    """
    event = payload.get("event", {})
    if event.get("type") != "message" or event.get("subtype") in {"bot_message"}:
        return {"skipped": True, "reason": "not_user_message"}

    text = (event.get("text") or "").strip()
    if not text:
        return {"skipped": True, "reason": "empty"}

    ts = event.get("ts") or str(datetime.now(timezone.utc).timestamp())
    channel = event.get("channel", "")
    team = payload.get("team_id")
    user = event.get("user")

    async def _resolve(slack_uid: str) -> str | None:
        return await resolve_provider_id("slack", slack_uid, workspace_id=workspace_id)

    return await upsert_document(
        source="slack",
        source_id=f"{channel}:{ts}",
        title=text[:120],
        content=text,
        source_url=_channel_thread_url(team, channel, ts),
        metadata={
            "channel": channel,
            "ts": ts,
            "user": user,
            "thread_ts": event.get("thread_ts"),
        },
        chunker_fn=lambda s: [s],
        workspace_id=workspace_id,
        resolve_slack=_resolve,
        cursor_id=f"slack:{channel}",
        cursor=ts,
    )
