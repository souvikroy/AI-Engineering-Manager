"""Vector / lexical store. In-memory BM25 baseline; optional embedding-augmented hybrid.

Picked for MVP because it has zero infra dependencies and handles single-repo scale comfortably.
Swap in Qdrant when REVIEWER_VECTOR_BACKEND=qdrant (requires `pip install reviewer[qdrant]`).
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass

from ..ingest.chunker import Chunk, ChunkIndex

TOK_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]+|\d+")


def tokenize(text: str) -> list[str]:
    return [t.lower() for t in TOK_RE.findall(text)]


@dataclass
class Hit:
    chunk: Chunk
    score: float


class BM25Store:
    """Compact BM25 over tokenized chunks. Good enough for code retrieval at single-repo scale."""

    def __init__(self, k1: float = 1.5, b: float = 0.75) -> None:
        self.k1 = k1
        self.b = b
        self._chunks: list[Chunk] = []
        self._docs: list[Counter[str]] = []
        self._lengths: list[int] = []
        self._df: Counter[str] = Counter()
        self._avgdl: float = 0.0

    def index(self, idx: ChunkIndex) -> None:
        self._chunks = list(idx.chunks)
        self._docs = []
        self._lengths = []
        self._df = Counter()
        for c in self._chunks:
            toks = tokenize(c.text)
            tf = Counter(toks)
            self._docs.append(tf)
            self._lengths.append(len(toks))
            for term in tf:
                self._df[term] += 1
        self._avgdl = (sum(self._lengths) / len(self._lengths)) if self._lengths else 0.0

    async def search_async(self, query: str, *, k: int = 8, path_filter: str | None = None) -> list[Hit]:
        """Async-native search. BM25 is CPU-bound and tiny, so the sync impl runs in-line."""
        return self.search(query, k=k, path_filter=path_filter)

    def search(self, query: str, *, k: int = 8, path_filter: str | None = None) -> list[Hit]:
        q_terms = tokenize(query)
        if not q_terms or not self._chunks:
            return []
        N = len(self._chunks)
        scores: list[tuple[float, int]] = []
        for i, tf in enumerate(self._docs):
            if path_filter and path_filter not in self._chunks[i].path:
                continue
            score = 0.0
            dl = max(self._lengths[i], 1)
            for term in q_terms:
                f = tf.get(term, 0)
                if f == 0:
                    continue
                df = self._df.get(term, 0)
                idf = math.log(1 + (N - df + 0.5) / (df + 0.5))
                num = f * (self.k1 + 1)
                den = f + self.k1 * (1 - self.b + self.b * (dl / max(self._avgdl, 1.0)))
                score += idf * (num / den)
            if score > 0:
                scores.append((score, i))
        scores.sort(reverse=True)
        return [Hit(chunk=self._chunks[i], score=s) for s, i in scores[:k]]

    def stats(self) -> dict:
        return {
            "n_chunks": len(self._chunks),
            "n_files": len({c.path for c in self._chunks}),
            "avg_chunk_len_tokens": round(self._avgdl, 1),
            "vocab": len(self._df),
        }
