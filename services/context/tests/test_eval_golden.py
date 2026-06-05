"""Eval-harness scaffold (Phase 6).

Not yet wired to a real DB — this file defines the golden-set shape and the
recall@k + citation-precision metrics so we can grow the suite as integrations
land. A future PR runs this against a seeded test database.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class GoldenQuery:
    question: str
    # Document ids (or `source:source_id` keys) the retriever MUST surface.
    expected_doc_keys: set[str]
    # Optional entity filters the chat layer would apply.
    entities: list[str] | None = None


# Seeded examples — replace with real exports once ingest writes are flowing.
GOLDEN: list[GoldenQuery] = [
    GoldenQuery(
        question="What did we decide about the auth migration?",
        expected_doc_keys={"confluence:demo-1"},
        entities=["service:auth"],
    ),
    GoldenQuery(
        question="What is engineer Priya stuck on right now?",
        expected_doc_keys={"slack:C0123:1700000001.000100"},
        entities=["engineer:eng_priya"],
    ),
]


def recall_at_k(retrieved_keys: list[str], expected: set[str], k: int) -> float:
    top = set(retrieved_keys[:k])
    if not expected:
        return 1.0
    return len(top & expected) / len(expected)


def citation_precision(cited_keys: list[str], expected: set[str]) -> float:
    if not cited_keys:
        return 0.0
    return sum(1 for c in cited_keys if c in expected) / len(cited_keys)


def test_metrics_self_consistent():
    assert recall_at_k(["a", "b"], {"a"}, 10) == 1.0
    assert recall_at_k(["a", "b"], {"c"}, 10) == 0.0
    assert citation_precision(["a", "b"], {"a"}) == 0.5
    assert citation_precision([], {"a"}) == 0.0
