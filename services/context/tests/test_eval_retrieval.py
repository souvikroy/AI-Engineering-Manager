"""Real retrieval eval — runs against a live Python+Postgres stack.

Skipped automatically unless `EVAL_LIVE_URL` points at a running context
service (e.g. `EVAL_LIVE_URL=http://localhost:8000`). When live, it:

1. Seeds N golden documents via `/ingest/text` (idempotent — content_hash dedup).
2. For each `GoldenQuery`, calls `/search`, records the top-k doc ids.
3. Computes recall@k and citation precision against the expected source ids.
4. Asserts bar values; the bar is conservative for early Phase 6.

This is the gate we tighten as ingest pipelines mature.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

import httpx
import pytest

from tests.test_eval_golden import citation_precision, recall_at_k


LIVE_URL = os.environ.get("EVAL_LIVE_URL")
pytestmark = pytest.mark.skipif(LIVE_URL is None, reason="EVAL_LIVE_URL not set; skipping live eval")


@dataclass
class Doc:
    source: str
    source_id: str
    title: str
    text: str
    entity_refs: list[str]


@dataclass
class Query:
    question: str
    expected_source_ids: set[str]  # source:source_id keys
    entities: list[str] | None = None


GOLDEN_DOCS: list[Doc] = [
    Doc(
        source="confluence",
        source_id="auth-migration-rfc",
        title="Auth Migration RFC",
        text=(
            "# Auth Migration RFC\n\n"
            "We are moving JWT refresh rotation from sticky sessions to a stateless approach. "
            "Owner: eng_priya. Linked tickets: AUTH-12, AUTH-19.\n\n"
            "## Risk\nClock skew across regions can yield false rejections; mitigate with 60s grace.\n\n"
            "## Decision\nGo with stateless rotation behind feature flag auth.refresh.v2.\n"
        ),
        entity_refs=["engineer:eng_priya", "service:auth"],
    ),
    Doc(
        source="jira",
        source_id="AUTH-19",
        title="AUTH-19: Implement stateless JWT rotation",
        text=(
            "Implementation ticket for the auth migration RFC. "
            "Splits the work: signing key rollover (Marco), grace-window flag (Priya). "
            "Status: In Progress. Sprint: S-42."
        ),
        entity_refs=["engineer:eng_priya", "engineer:eng_marco", "service:auth", "ticket:AUTH-19"],
    ),
    Doc(
        source="slack",
        source_id="C0DEMO:1700000099.000999",
        title="standup msg",
        text=(
            "Priya: blocked on the auth.refresh.v2 flag review — paged Marco yesterday, "
            "still waiting on signing-key rollover decision."
        ),
        entity_refs=["engineer:eng_priya", "engineer:eng_marco", "service:auth"],
    ),
    Doc(
        source="sentry",
        source_id="MOB-7",
        title="Crash rate spike on Pixel 7a (FCM v3)",
        text=(
            "Crash rate spike on Pixel 7a after FCM v3 upgrade. "
            "Top frame: com.aiem.mobile.notif.handle. Owner: eng_ling."
        ),
        entity_refs=["engineer:eng_ling", "service:mobile"],
    ),
]

GOLDEN_QUERIES: list[Query] = [
    Query(
        question="What did we decide about the auth migration risk?",
        expected_source_ids={"confluence:auth-migration-rfc"},
        entities=["service:auth"],
    ),
    Query(
        question="Who owns AUTH-19 and what is its status?",
        expected_source_ids={"jira:AUTH-19"},
    ),
    Query(
        question="Is anyone blocked waiting on Marco?",
        expected_source_ids={
            "slack:C0DEMO:1700000099.000999",
            "jira:AUTH-19",
        },
    ),
    Query(
        question="What's going on with mobile crash rate?",
        expected_source_ids={"sentry:MOB-7"},
        entities=["service:mobile"],
    ),
]


@pytest.fixture(scope="module")
async def seeded_client():
    async with httpx.AsyncClient(base_url=LIVE_URL, timeout=30) as client:
        # Seed each golden doc — idempotent on content_hash.
        for d in GOLDEN_DOCS:
            r = await client.post(
                "/ingest/text",
                json={
                    "source": d.source,
                    "source_id": d.source_id,
                    "title": d.title,
                    "text": d.text,
                    "entity_refs": d.entity_refs,
                },
            )
            assert r.status_code == 200, r.text
        yield client


def _key(source: str, source_id: str) -> str:
    return f"{source}:{source_id}"


@pytest.mark.asyncio
async def test_retrieval_quality(seeded_client):
    recalls: list[float] = []
    precisions: list[float] = []
    for q in GOLDEN_QUERIES:
        r = await seeded_client.post(
            "/search",
            json={
                "query": q.question,
                "k": 10,
                "entities": q.entities,
            },
        )
        assert r.status_code == 200, r.text
        data = r.json()

        # Match: build the keys for each cited doc by re-fetching the doc by id.
        # Cheaper: use the citation list (kind + id-as-uuid) and resolve via /doc.
        retrieved_keys: list[str] = []
        for cite in data.get("citations", []):
            doc_id = cite["id"]
            doc_resp = await seeded_client.get(f"/doc/{doc_id}")
            if doc_resp.status_code != 200:
                continue
            d = doc_resp.json()
            retrieved_keys.append(_key(d["source"], d["source_id"]))

        recalls.append(recall_at_k(retrieved_keys, q.expected_source_ids, k=10))
        precisions.append(citation_precision(retrieved_keys, q.expected_source_ids))

    avg_recall = sum(recalls) / len(recalls)
    avg_precision = sum(precisions) / len(precisions)
    # Conservative bars for the early eval. Tighten as the corpus grows.
    assert avg_recall >= 0.75, f"recall@10 = {avg_recall:.2f}, recalls={recalls}"
    assert avg_precision >= 0.30, f"citation_precision = {avg_precision:.2f}, precisions={precisions}"
