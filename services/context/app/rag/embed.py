"""Voyage embedding client with a deterministic dev fallback.

If `VOYAGE_API_KEY` is set we call Voyage `voyage-3` (1024 dims).
If it's missing we emit a hash-derived deterministic vector so the rest of the
pipeline still runs end-to-end during local dev. The fallback is clearly
labelled via `embedding_model="dev-hash"` so we can find and re-embed those
chunks once a key is configured.
"""
from __future__ import annotations

import hashlib
import logging
from collections.abc import Sequence

from tenacity import retry, stop_after_attempt, wait_exponential

from ..config import get_settings

log = logging.getLogger(__name__)


_voyage_client = None


def _get_voyage():
    global _voyage_client
    if _voyage_client is None:
        settings = get_settings()
        if not settings.voyage_api_key:
            return None
        try:
            import voyageai

            _voyage_client = voyageai.Client(api_key=settings.voyage_api_key)
        except ImportError:
            log.warning("voyageai not installed — falling back to dev-hash embeddings")
            return None
    return _voyage_client


def _hash_vector(text: str, dim: int) -> list[float]:
    """Deterministic dev-only embedding. NOT for production."""
    digest = hashlib.sha512(text.encode("utf-8")).digest()
    # Repeat to cover the dim, then normalize roughly.
    raw = (digest * ((dim // len(digest)) + 1))[:dim]
    # Center on 0 and scale.
    vec = [(b / 255.0) * 2 - 1 for b in raw]
    # L2-normalize so cosine distance behaves similarly to real embeddings.
    norm = sum(v * v for v in vec) ** 0.5 or 1.0
    return [v / norm for v in vec]


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
async def embed_texts(
    texts: Sequence[str], *, input_type: str = "document"
) -> tuple[list[list[float]], str, str]:
    """Return (vectors, model_used, version_used). `input_type` is "document" or "query"."""
    settings = get_settings()
    client = _get_voyage()
    if client is None:
        return (
            [_hash_vector(t, settings.embedding_dim) for t in texts],
            "dev-hash",
            settings.embedding_version,
        )
    # voyageai client is sync; in production we'd use voyageai.AsyncClient.
    result = client.embed(
        list(texts), model=settings.embedding_model, input_type=input_type
    )
    return result.embeddings, settings.embedding_model, settings.embedding_version


async def embed_one(text: str, *, input_type: str = "query") -> list[float]:
    vecs, _, _ = await embed_texts([text], input_type=input_type)
    return vecs[0]
