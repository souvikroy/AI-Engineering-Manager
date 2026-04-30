"""L1/L2/L3 hierarchical summary endpoint."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ..rag import summarize
from ..schemas.summary import SummaryResponse, WindowLiteral

router = APIRouter(tags=["summary"])


@router.get("/summary", response_model=SummaryResponse)
async def get_summary(
    entity_type: str | None = Query(default=None),
    entity_id: str | None = Query(default=None),
    window: WindowLiteral | None = Query(default=None),
    layer: int = Query(default=2, ge=1, le=3),
    workspace_id: str | None = Query(default=None),
) -> SummaryResponse:
    """Fetch the freshest precomputed summary for the requested layer/entity/window."""
    res = await summarize.fetch_summary(
        layer=layer,
        entity_type=entity_type,
        entity_id=entity_id,
        window=window,
        workspace_id=workspace_id,
    )
    if res is None:
        raise HTTPException(status_code=404, detail="No summary found for the given key.")
    return res
