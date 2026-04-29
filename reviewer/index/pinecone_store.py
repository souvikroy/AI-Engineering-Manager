"""Pinecone-backed vector store. Drop-in for BM25Store.

**One Pinecone index per repo.** Each repo gets its own index named `rev-<repo_id12>`,
created lazily on first review with whatever dimension the current embedding model
returns. This gives:
- Strong isolation: queries can never cross repos by accident — there isn't even
  a shared container to scope into.
- Per-repo dimension freedom: changing embedding models doesn't break existing repos;
  new repos get fresh indexes at the new dim while old ones keep theirs.
- Per-repo lifecycle: archiving a repo deletes its index, no orphan vectors to GC.
- Per-repo billing/quota visibility in Pinecone's UI.

Embeddings come from OpenRouter via the embedding endpoint. Falls back to BM25 if
Pinecone isn't configured or any single call fails — safe degradation, never blocks
a review.

Design rules learned the hard way:
- Never call `asyncio.run()` from inside a running event loop. Both `index()` and
  `search()` are sync entry points but get called from async worker code, so we
  use thread-pool execution when there is a running loop, and `asyncio.run()` only
  when there is none.
- Probe the embedding dimension on first use and create the per-repo index at that
  dim. If we hit a pre-existing index whose dim doesn't match, disable Pinecone for
  the run (clean log line) instead of spamming 400s.
- Don't send Pinecone serverless filter operators it doesn't support
  (`$contains` was the original sin); only `$eq`/`$in`/numeric comparators are safe.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import math
import re
import threading
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import httpx

from ..core.config import get_settings
from ..ingest.chunker import Chunk, ChunkIndex
from .store import BM25Store, Hit  # re-use the data class

log = logging.getLogger(__name__)

TOK_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]+|\d+")


def _tokens(text: str) -> list[str]:
    return [t.lower() for t in TOK_RE.findall(text)]


def _run_coro_blocking(coro):
    """Run a coroutine to completion and return its result, regardless of whether
    we're currently inside an event loop or not.

    Inside a running loop: spin a one-shot worker thread that runs its own loop.
    Outside any loop: just `asyncio.run(coro)`.

    Don't use `asyncio.get_event_loop().run_until_complete(...)` — that raises in
    a running loop, and the typical fallback (`asyncio.run` inside the same loop)
    raises too. The thread-detour is the only correct sync-from-async bridge.
    """
    try:
        asyncio.get_running_loop()
        in_loop = True
    except RuntimeError:
        in_loop = False
    if not in_loop:
        return asyncio.run(coro)
    result_box: dict = {}

    def _worker() -> None:
        try:
            result_box["v"] = asyncio.run(coro)
        except BaseException as e:  # noqa: BLE001
            result_box["e"] = e

    t = threading.Thread(target=_worker, daemon=True)
    t.start()
    t.join()
    if "e" in result_box:
        raise result_box["e"]
    return result_box.get("v")


@dataclass
class _Vector:
    id: str
    chunk: Chunk
    dense: list[float]
    sparse_indices: list[int]
    sparse_values: list[float]


def repo_index_name(repo_id: str, *, prefix: str = "rev") -> str:
    """Deterministic Pinecone index name for a given repo_id.

    Pinecone constraints: ≤ 45 chars, lowercase a-z / 0-9 / hyphens, must start with a letter.
    We hash the full repo_id and take 12 hex chars so the distribution is uniform — this avoids
    collisions when two ids share a prefix (real UUIDv4s won't, but truncating raw inputs feels
    fragile, and the hash is only marginally less readable).
    Final form: `rev-<12 hex>` e.g. `rev-3f9a2b1c0d4e` (16 chars, well under 45).
    """
    raw = (repo_id or "x")
    digest = hashlib.md5(raw.encode("utf-8")).hexdigest()[:12]
    return f"{prefix}-{digest}"


class PineconeStore:
    """Drop-in for BM25Store. One index per repo. Falls back to BM25 on any error."""

    def __init__(self, *, repo_id: str | None = None, namespace: str | None = None,
                 embed_model: str | None = None) -> None:
        # Backward compat: accept legacy `namespace="repo:<id>"` and recover repo_id from it.
        if repo_id is None and namespace and namespace.startswith("repo:"):
            repo_id = namespace.split(":", 1)[1]
        if not repo_id:
            raise ValueError("PineconeStore now requires repo_id (one index per repo).")
        self.repo_id = repo_id
        self._fallback = BM25Store()
        self._chunks: list[Chunk] = []
        self._chunk_by_id: dict[str, Chunk] = {}
        s = get_settings()
        self._api_key = s.pinecone_api_key
        self._index_name = repo_index_name(repo_id)
        self._embed_model = embed_model or s.model_embed
        self._client: httpx.AsyncClient | None = None
        self._index_host: str | None = None
        self._index_dim: int | None = None  # probed from /indexes
        self._embed_dim: int | None = None  # probed from first /embeddings response
        self.configured = bool(self._api_key) and s.vector_backend == "pinecone"
        self._disabled_reason: str | None = None

    # ---- Public API mirroring BM25Store ----

    def index(self, idx: ChunkIndex) -> None:
        """Build the BM25 fallback synchronously; Pinecone upserts happen in the
        background but we DO NOT block on them — searches will use BM25 until the
        upsert task finishes (typical: tens of seconds for a few thousand chunks).
        """
        self._fallback.index(idx)
        self._chunks = list(idx.chunks)
        self._chunk_by_id = {self._chunk_id(c): c for c in self._chunks}
        if not self.configured:
            return
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self._ensure_index_and_upsert())
        except RuntimeError:
            # No running loop — run to completion synchronously.
            try:
                asyncio.run(self._ensure_index_and_upsert())
            except Exception as e:  # noqa: BLE001
                log.warning("pinecone bootstrap failed (using BM25): %s", e)

    def search(self, query: str, *, k: int = 8, path_filter: str | None = None) -> list[Hit]:
        """Synchronous wrapper used by the recursive RAG loop. Falls back to BM25 on failure."""
        if not self.configured or self._disabled_reason:
            return self._fallback.search(query, k=k, path_filter=path_filter)
        try:
            return _run_coro_blocking(self._search_async(query, k=k, path_filter=path_filter))
        except Exception as e:  # noqa: BLE001
            self._disable_once(f"search failed: {e!r}")
            return self._fallback.search(query, k=k, path_filter=path_filter)

    async def search_async(self, query: str, *, k: int = 8, path_filter: str | None = None) -> list[Hit]:
        """Async-native search — preferred entry point from async callers."""
        if not self.configured or self._disabled_reason:
            return self._fallback.search(query, k=k, path_filter=path_filter)
        try:
            return await self._search_async(query, k=k, path_filter=path_filter)
        except Exception as e:  # noqa: BLE001
            self._disable_once(f"search failed: {e!r}")
            return self._fallback.search(query, k=k, path_filter=path_filter)

    def stats(self) -> dict:
        return {
            **self._fallback.stats(),
            "repo_id": self.repo_id,
            "pinecone_index": self._index_name,
            "configured": self.configured,
            "pinecone_disabled_reason": self._disabled_reason,
            "index_dim": self._index_dim,
            "embed_dim": self._embed_dim,
        }

    # ---- Internals ----

    def _disable_once(self, reason: str) -> None:
        if self._disabled_reason is None:
            self._disabled_reason = reason
            log.warning("pinecone disabled for this run; falling back to BM25 — %s", reason)

    @staticmethod
    def _chunk_id(c: Chunk) -> str:
        h = hashlib.md5(f"{c.path}:{c.start_line}-{c.end_line}".encode()).hexdigest()
        return h[:24]

    async def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=30.0)
        return self._client

    async def _embed(self, texts: list[str]) -> list[list[float]]:
        s = get_settings()
        if not s.openrouter_api_key:
            raise RuntimeError("OPENROUTER_API_KEY required for embeddings")
        c = await self._http()
        r = await c.post(
            f"{s.openrouter_base_url}/embeddings",
            headers={"Authorization": f"Bearer {s.openrouter_api_key}"},
            json={"model": self._embed_model, "input": texts},
        )
        r.raise_for_status()
        data = r.json()
        out = [d["embedding"] for d in data["data"]]
        if out and self._embed_dim is None:
            self._embed_dim = len(out[0])
        return out

    def _sparse(self, text: str, idf: dict[str, float]) -> tuple[list[int], list[float]]:
        toks = _tokens(text)
        tf = Counter(toks)
        idx_val: list[tuple[int, float]] = []
        for term, count in tf.items():
            if term not in idf:
                continue
            score = (1 + math.log(count)) * idf[term]
            idx_val.append((self._term_to_index(term), score))
        idx_val.sort()
        return [i for i, _ in idx_val], [v for _, v in idx_val]

    @staticmethod
    def _term_to_index(term: str) -> int:
        return int(hashlib.md5(term.encode()).hexdigest()[:8], 16) % 100_000

    async def _ensure_index_and_upsert(self) -> None:
        try:
            await self._ensure_index()
            if self._disabled_reason:
                # _ensure_index already detected a fatal mismatch; skip upsert.
                return
            await self._upsert_chunks()
        except Exception as e:  # noqa: BLE001
            self._disable_once(f"upsert failed: {e!r}")

    async def _ensure_index(self) -> None:
        c = await self._http()
        r = await c.get(
            "https://api.pinecone.io/indexes",
            headers={"Api-Key": self._api_key, "X-Pinecone-API-Version": "2024-07"},
        )
        r.raise_for_status()
        indexes = r.json().get("indexes", [])
        match = next((i for i in indexes if i.get("name") == self._index_name), None)
        if match is None:
            # Create index sized to the actual embedding dim. Probe first if we don't know it.
            if self._embed_dim is None:
                probe = await self._embed(["dimension probe"])
                self._embed_dim = len(probe[0]) if probe else None
            if not self._embed_dim:
                self._disable_once("could not determine embedding dimension")
                return
            create = await c.post(
                "https://api.pinecone.io/indexes",
                headers={"Api-Key": self._api_key, "X-Pinecone-API-Version": "2024-07"},
                json={
                    "name": self._index_name,
                    "dimension": self._embed_dim,
                    "metric": "cosine",
                    "spec": {"serverless": {"cloud": "aws", "region": "us-east-1"}},
                },
            )
            create.raise_for_status()
            match = create.json()
            self._index_dim = self._embed_dim
        else:
            self._index_dim = int(match.get("dimension") or 0)
        self._index_host = "https://" + match["host"]

        # If the existing index dimension can't fit our embeddings, disable cleanly.
        if self._embed_dim and self._index_dim and self._embed_dim != self._index_dim:
            self._disable_once(
                f"index '{self._index_name}' is dim={self._index_dim} but the embedding model "
                f"'{self._embed_model}' returns dim={self._embed_dim}. "
                f"Recreate the index with the matching dimension to re-enable Pinecone."
            )

    async def _upsert_chunks(self) -> None:
        if not self._index_host or not self._chunks:
            return
        # Compute per-repo IDF for sparse vectors.
        df: Counter[str] = Counter()
        for c in self._chunks:
            for term in set(_tokens(c.text)):
                df[term] += 1
        N = max(len(self._chunks), 1)
        idf = {t: math.log((N + 1) / (d + 1)) + 1.0 for t, d in df.items()}

        # Embed in batches.
        BATCH = 64
        c = await self._http()
        for i in range(0, len(self._chunks), BATCH):
            batch = self._chunks[i : i + BATCH]
            embeddings = await self._embed([ck.text for ck in batch])
            # Re-check after first real embed — bail early on dim mismatch instead of
            # POSTing a doomed batch.
            if self._index_dim and self._embed_dim and self._embed_dim != self._index_dim:
                self._disable_once(
                    f"embed dim {self._embed_dim} != index dim {self._index_dim}; aborting upsert"
                )
                return
            vectors = []
            for ck, dense in zip(batch, embeddings):
                idx_, vals_ = self._sparse(ck.text, idf)
                vectors.append({
                    "id": self._chunk_id(ck),
                    "values": dense,
                    "sparse_values": {"indices": idx_, "values": vals_},
                    "metadata": {
                        "path": ck.path,
                        "start_line": ck.start_line,
                        "end_line": ck.end_line,
                        "lang": ck.lang,
                        "symbol": ck.symbol or "",
                    },
                })
            r = await c.post(
                f"{self._index_host}/vectors/upsert",
                headers={"Api-Key": self._api_key},
                json={"vectors": vectors},
            )
            r.raise_for_status()
        log.info("pinecone upsert complete: %d vectors in index=%s (repo=%s)",
                 len(self._chunks), self._index_name, self.repo_id)

    @classmethod
    async def delete_repo_index(cls, repo_id: str) -> bool:
        """Best-effort delete of a repo's Pinecone index. Safe to call when no index exists.

        Returns True if Pinecone confirmed the delete (or 404'd on a non-existent index),
        False if Pinecone wasn't configured / errored. Caller should swallow the result.
        """
        s = get_settings()
        if not (s.pinecone_api_key and s.vector_backend == "pinecone"):
            return False
        name = repo_index_name(repo_id)
        async with httpx.AsyncClient(timeout=15.0) as c:
            try:
                r = await c.delete(
                    f"https://api.pinecone.io/indexes/{name}",
                    headers={"Api-Key": s.pinecone_api_key, "X-Pinecone-API-Version": "2024-07"},
                )
                if r.status_code in (200, 202, 204):
                    log.info("pinecone index deleted: %s (repo=%s)", name, repo_id)
                    return True
                if r.status_code == 404:
                    return True  # already gone — idempotent success
                log.warning("pinecone delete index %s returned %d: %s",
                            name, r.status_code, r.text[:200])
                return False
            except Exception as e:  # noqa: BLE001
                log.warning("pinecone delete index %s failed: %s", name, e)
                return False

    async def _search_async(self, query: str, *, k: int, path_filter: str | None) -> list[Hit]:
        if not self._index_host:
            await self._ensure_index()
            if self._disabled_reason:
                return self._fallback.search(query, k=k, path_filter=path_filter)
        if not self._index_host:
            return self._fallback.search(query, k=k, path_filter=path_filter)
        c = await self._http()
        embeddings = await self._embed([query])
        if self._index_dim and self._embed_dim and self._embed_dim != self._index_dim:
            self._disable_once(
                f"embed dim {self._embed_dim} != index dim {self._index_dim}"
            )
            return self._fallback.search(query, k=k, path_filter=path_filter)
        body = {
            "vector": embeddings[0],
            "topK": k,
            "includeMetadata": True,
        }
        # Pinecone serverless metadata filters: $eq/$ne/$in/$nin/$gt/$gte/$lt/$lte only.
        # `$contains` is not supported, so we fall back to client-side path filtering below
        # rather than ship a request that 400s.
        r = await c.post(f"{self._index_host}/query", headers={"Api-Key": self._api_key}, json=body)
        r.raise_for_status()
        out: list[Hit] = []
        for m in r.json().get("matches", []):
            cid = m.get("id")
            ck = self._chunk_by_id.get(cid)
            if ck is None:
                md = m.get("metadata", {})
                ck = Chunk(
                    path=md.get("path", ""),
                    start_line=int(md.get("start_line", 0)),
                    end_line=int(md.get("end_line", 0)),
                    lang=md.get("lang", "text"),
                    symbol=md.get("symbol", ""),
                    text="",
                )
            if path_filter and path_filter not in (ck.path or ""):
                continue
            out.append(Hit(chunk=ck, score=float(m.get("score", 0.0))))
        return out
