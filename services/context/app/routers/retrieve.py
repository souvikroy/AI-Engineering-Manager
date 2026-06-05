"""Hybrid retrieval endpoint."""
from __future__ import annotations

from fastapi import APIRouter

from ..rag import retrieve as rag_retrieve
from ..schemas.search import SearchRequest, SearchResponse

router = APIRouter(tags=["retrieval"])


@router.post("/search", response_model=SearchResponse)
async def search(req: SearchRequest) -> SearchResponse:
    """Hybrid (BM25 + vector + rerank) search with recursive overflow valve.

    - Routes the query (entity-centric / semantic / structured / mixed).
    - Single asyncpg query combines `tsv @@ plainto_tsquery` and `embedding <=> $vec`.
    - Reranks top-50 candidates via Voyage rerank-2 down to top-k.
    - If returned tokens exceed `retrieval_token_budget`, summarizes-then-returns once.
    """
    return await rag_retrieve.search_corpus(req)
