"""Document fetch endpoint."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..rag import retrieve as rag_retrieve
from ..schemas.doc import DocResponse

router = APIRouter(tags=["doc"])


@router.get("/doc/{doc_id}", response_model=DocResponse)
async def get_doc(doc_id: str, anchor: str | None = None) -> DocResponse:
    """Fetch a single Document by id, optionally narrowed to an anchor (heading/section)."""
    res = await rag_retrieve.fetch_document(doc_id, anchor=anchor)
    if res is None:
        raise HTTPException(status_code=404, detail=f"Document {doc_id} not found.")
    return res
