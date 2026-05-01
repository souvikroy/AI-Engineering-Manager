"""Ingest endpoints — webhook receivers + a generic /ingest/text dev door."""
from __future__ import annotations

import json

from fastapi import APIRouter, Body, Depends, HTTPException, Request

from ..ingest import gsheet as gsheet_ingest
from ..ingest import jira as jira_ingest
from ..ingest import linear as linear_ingest
from ..ingest import notion as notion_ingest
from ..ingest import sentry as sentry_ingest
from ..ingest import slack as slack_ingest
from ..ingest import text as text_ingest
from ..ingest.meetings import PROVIDERS as MEETING_PROVIDERS
from ..schemas.common import SourceLiteral
from ..schemas.ingest import IngestAck
from ..security.slack_dep import verify_slack_request

router = APIRouter(tags=["ingest"], prefix="/ingest")


@router.post("/text", response_model=IngestAck)
async def ingest_text(
    source: SourceLiteral = Body(...),
    source_id: str = Body(...),
    title: str = Body(""),
    text: str = Body(...),
    source_url: str | None = Body(None),
    entity_refs: list[str] | None = Body(None),
    metadata: dict | None = Body(None),
    workspace_id: str | None = Body(None),
) -> IngestAck:
    """Generic ingest — useful for fixtures, eval harness, and quickly seeding rag.document.

    Production traffic should use the per-source webhooks below; this is a dev door.
    """
    res = await text_ingest.ingest_text(
        source=source,
        source_id=source_id,
        title=title,
        text=text,
        source_url=source_url,
        entity_refs=entity_refs,
        metadata=metadata,
        workspace_id=workspace_id,
    )
    return IngestAck(
        source=source,
        accepted=0 if res.get("skipped") else 1,
        deduplicated=1 if res.get("reason") == "unchanged" else 0,
        detail=str(res.get("reason") or "ok"),
    )


@router.post("/slack", response_model=IngestAck)
async def ingest_slack(
    _request: Request,
    raw_body: bytes = Depends(verify_slack_request),
) -> IngestAck:
    """Slack Events API receiver — verifies HMAC signature, then dispatches.

    The dependency reads the raw request body, validates `X-Slack-Signature`
    + `X-Slack-Request-Timestamp`, and only then returns the bytes. We re-parse
    here so the verification is over the exact bytes Slack signed (signing
    over Pydantic-deserialized objects would break the HMAC contract).
    """
    payload = json.loads(raw_body or b"{}")
    if payload.get("type") == "url_verification":
        # Slack handshake — return the challenge so the Events API URL verifies.
        return IngestAck(source="slack", accepted=0, detail=payload.get("challenge"))
    res = await slack_ingest.ingest_event(payload)
    return IngestAck(
        source="slack",
        accepted=0 if res.get("skipped") else 1,
        detail=str(res.get("reason") or "ok"),
    )


@router.post("/jira", response_model=IngestAck)
async def ingest_jira(payload: dict = Body(...)) -> IngestAck:
    res = await jira_ingest.ingest_webhook(payload)
    return IngestAck(source="jira", accepted=0 if res.get("skipped") else 1, detail=str(res.get("reason") or "ok"))


@router.post("/sentry", response_model=IngestAck)
async def ingest_sentry(payload: dict = Body(...)) -> IngestAck:
    res = await sentry_ingest.ingest_webhook(payload)
    return IngestAck(source="sentry", accepted=0 if res.get("skipped") else 1, detail=str(res.get("reason") or "ok"))


@router.post("/linear", response_model=IngestAck)
async def ingest_linear(payload: dict = Body(...)) -> IngestAck:
    """Linear webhook ('Issue' subscription). Parses one issue per call."""
    res = await linear_ingest.ingest_webhook(payload)
    return IngestAck(
        source="linear",
        accepted=0 if res.get("skipped") else 1,
        detail=str(res.get("reason") or "ok"),
    )


@router.post("/confluence", response_model=IngestAck)
async def ingest_confluence(_payload: dict = Body(...)) -> IngestAck:
    # Confluence is cron-driven — webhook arrival is rare. Triggered via /admin/sync/confluence.
    return IngestAck(source="confluence", accepted=0, detail="cron_only")


@router.post("/notion", response_model=IngestAck)
async def ingest_notion(payload: dict = Body(...)) -> IngestAck:
    """Notion webhook (page.updated/created)."""
    res = await notion_ingest.ingest_webhook(payload)
    return IngestAck(
        source="notion",
        accepted=0 if res.get("skipped") else 1,
        detail=str(res.get("reason") or "ok"),
    )


@router.post("/gsheet", response_model=IngestAck)
async def ingest_gsheet(_payload: dict = Body(...)) -> IngestAck:
    # Sheets has no useful webhooks for OKR rows; trigger via /admin/sync/gsheet.
    return IngestAck(source="gsheet", accepted=0, detail="cron_only")


@router.post("/github", response_model=IngestAck)
async def ingest_github(_payload: dict = Body(...)) -> IngestAck:
    return IngestAck(source="github", accepted=0, detail="not_yet_implemented")


@router.post("/meetings/{provider}", response_model=IngestAck)
async def ingest_meeting(provider: str, request: Request) -> IngestAck:
    """Meeting-transcript webhook receiver.

    The provider adapter handles per-provider auth (HMAC for Fireflies / Otter /
    Grain / tl;dv, bearer for Read.ai). We hand it the raw bytes via a shim
    header so signature verification operates on the exact bytes the provider
    signed.
    """
    adapter = MEETING_PROVIDERS.get(provider)
    if adapter is None:
        raise HTTPException(status_code=404, detail=f"unknown_provider:{provider}")
    raw_body = await request.body()
    payload = json.loads(raw_body or b"{}") if raw_body else {}
    headers = {k.lower(): v for k, v in request.headers.items()}
    headers["__raw_body__"] = raw_body.decode("utf-8", errors="replace")
    pm_id = await adapter.parse_webhook(payload, headers)
    if pm_id is None:
        return IngestAck(source="meeting", accepted=0, detail="ack_only")
    res = await adapter.ingest(pm_id)
    return IngestAck(
        source="meeting",
        accepted=0 if res.get("skipped") else 1,
        deduplicated=1 if res.get("reason") == "unchanged" else 0,
        detail=str(res.get("reason") or "ok"),
    )
