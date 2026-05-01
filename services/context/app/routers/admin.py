"""Admin endpoints for ops + manual triggers (dev / debugging).

These are NOT auth-protected at this layer; protect via reverse-proxy ACL or
network boundary in any non-local environment.
"""
from __future__ import annotations

from fastapi import APIRouter, Body, HTTPException, Query

from ..ingest import confluence as confluence_ingest
from ..ingest import gsheet as gsheet_ingest
from ..ingest import linear as linear_ingest
from ..ingest import notion as notion_ingest
from ..rag import summarize
from ..schemas.summary import WindowLiteral
from ..workers import scheduler as workers

router = APIRouter(tags=["admin"], prefix="/admin")


@router.post("/summarize/l1/{document_id}")
async def trigger_l1(document_id: str, workspace_id: str | None = Query(default=None)):
    sid = await summarize.build_l1_summary(document_id, workspace_id=workspace_id)
    if sid is None:
        raise HTTPException(404, f"Document {document_id} not found")
    return {"ok": True, "summary_id": sid}


@router.post("/summarize/l2")
async def trigger_l2(
    entity_type: str = Body(...),
    entity_id: str = Body(...),
    window: WindowLiteral = Body("week"),
    workspace_id: str | None = Body(None),
):
    sid = await summarize.build_l2_summary(
        entity_type=entity_type, entity_id=entity_id, window=window, workspace_id=workspace_id
    )
    if sid is None:
        return {"ok": False, "reason": "no_input_in_window"}
    return {"ok": True, "summary_id": sid}


@router.post("/summarize/l3/daily")
async def trigger_l3_daily(workspace_id: str | None = Query(default=None)):
    sid = await summarize.build_l3_daily_digest(workspace_id=workspace_id)
    if sid is None:
        return {"ok": False, "reason": "no_l2_in_window"}
    return {"ok": True, "summary_id": sid}


@router.post("/sweep/l1")
async def sweep_l1(workspace_id: str | None = Query(default=None)):
    n = await workers.sweep_l1_missing(workspace_id=workspace_id)
    return {"ok": True, "summaries_built": n}


@router.post("/sweep/l2")
async def sweep_l2(workspace_id: str | None = Query(default=None)):
    n = await workers.run_l2_for_active(workspace_id=workspace_id)
    return {"ok": True, "summaries_built": n}


@router.post("/sync/confluence")
async def sync_confluence(
    space: str = Body(..., embed=True),
    workspace_id: str | None = Body(default=None),
):
    """Trigger a Confluence pull for one space. Registers the cursor on first run
    so the hourly worker picks it up automatically thereafter."""
    out = await confluence_ingest.sync_space(space, workspace_id=workspace_id)
    return {"ok": True, **out}


@router.post("/sync/notion")
async def sync_notion(
    database_id: str = Body(..., embed=True),
    workspace_id: str | None = Body(default=None),
):
    """Trigger a Notion database pull. First call registers the cursor."""
    out = await notion_ingest.sync_database(database_id, workspace_id=workspace_id)
    return {"ok": True, **out}


@router.post("/sync/gsheet")
async def sync_gsheet(
    sheet_id: str = Body(...),
    range_a1: str = Body("Sheet1!A1:Z1000"),
    workspace_id: str | None = Body(default=None),
):
    """Trigger a Google Sheets pull. First call registers the cursor."""
    out = await gsheet_ingest.sync_spreadsheet(
        sheet_id, range_a1=range_a1, workspace_id=workspace_id
    )
    return {"ok": True, **out}


@router.post("/sync/linear")
async def sync_linear(
    workspace_id: str | None = Body(default=None),
    team: str = Body(default="all"),
):
    """Trigger a Linear backfill. The hourly job will keep it fresh thereafter."""
    out = await linear_ingest.backfill(workspace_id=workspace_id, team=team)
    return {"ok": True, **out}
