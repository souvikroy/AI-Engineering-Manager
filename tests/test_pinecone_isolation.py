"""Tests for per-repo Pinecone index isolation.

We don't hit the real Pinecone API in tests — instead we verify:
1. Index names are deterministic, unique per repo, and within Pinecone's constraints.
2. Two stores for two different repos have non-overlapping configuration.
3. The legacy `namespace="repo:<id>"` constructor form still maps to the right repo_id.
4. Construction without a repo_id fails fast (no silent shared state).
"""

from __future__ import annotations

import pytest

from reviewer.index.pinecone_store import PineconeStore, repo_index_name


def test_index_name_format():
    name = repo_index_name("b60120c0-f650-4e6a-bcf6-6fbdabc03cf7")
    # Pinecone constraints: ≤ 45 chars, lowercase alnum + hyphen, must start with a letter.
    assert len(name) <= 45
    assert name == name.lower()
    assert all(c.isalnum() or c == "-" for c in name)
    assert name[0].isalpha()
    # Deterministic for the same input
    assert name == repo_index_name("b60120c0-f650-4e6a-bcf6-6fbdabc03cf7")
    # Shape: prefix + hyphen + 12 hex
    assert name.startswith("rev-")
    assert len(name) == len("rev-") + 12


def test_index_name_distinct_per_repo():
    a = repo_index_name("11111111-2222-3333-4444-555555555555")
    b = repo_index_name("99999999-aaaa-bbbb-cccc-dddddddddddd")
    assert a != b
    # Two different repos must not collide on the 12-hex-char prefix
    assert repo_index_name("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee") != \
           repo_index_name("aaaaaaaa-bbbb-cccc-dddd-ffffffffffff")


def test_index_name_handles_short_or_empty_id():
    # Should never produce an invalid index name even for malformed inputs.
    name = repo_index_name("")
    assert len(name) > 1 and name.startswith("rev-") and name[0].isalpha()
    name = repo_index_name("x")
    assert name.startswith("rev-") and len(name) == len("rev-") + 12
    # Different short inputs still produce different names
    assert repo_index_name("a") != repo_index_name("b")


def test_store_requires_repo_id():
    with pytest.raises(ValueError):
        PineconeStore()  # type: ignore[call-arg]
    with pytest.raises(ValueError):
        PineconeStore(repo_id="")


def test_legacy_namespace_argument_recovers_repo_id():
    """The old call site `PineconeStore(namespace='repo:<id>')` must still work."""
    s = PineconeStore(namespace="repo:b60120c0-f650-4e6a-bcf6-6fbdabc03cf7")
    assert s.repo_id == "b60120c0-f650-4e6a-bcf6-6fbdabc03cf7"
    # Index name derived from repo_id, not the namespace string
    assert s._index_name == repo_index_name("b60120c0-f650-4e6a-bcf6-6fbdabc03cf7")


def test_two_repos_get_distinct_index_names_and_state():
    a = PineconeStore(repo_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
    b = PineconeStore(repo_id="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
    # Different indexes
    assert a._index_name != b._index_name
    # Different fallbacks (no shared mutable state by accident)
    assert a._fallback is not b._fallback
    assert a._chunk_by_id is not b._chunk_by_id
    # stats() reflects the per-repo index name
    assert a.stats()["pinecone_index"] == a._index_name
    assert b.stats()["pinecone_index"] == b._index_name
    assert a.stats()["repo_id"] == a.repo_id
    assert b.stats()["repo_id"] == b.repo_id


def test_disabled_store_falls_back_to_isolated_bm25(monkeypatch):
    """When Pinecone is disabled, BM25 fallbacks must still be repo-isolated.

    BM25 is in-memory per-instance, so two stores can't see each other's chunks even
    if Pinecone is off — this is the safety net that prevents 'clubbing' regardless
    of remote state.
    """
    from reviewer.ingest.chunker import Chunk, ChunkIndex

    def mk_chunk(path: str, text: str) -> Chunk:
        return Chunk(path=path, start_line=1, end_line=1, lang="text", symbol="", text=text)

    a = PineconeStore(repo_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
    b = PineconeStore(repo_id="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
    # Disable Pinecone so all queries hit the per-instance BM25 fallback.
    a.configured = False
    b.configured = False
    a._fallback.index(ChunkIndex(chunks=[mk_chunk("a/secret.py", "alphafoxtrot is the password")]))
    b._fallback.index(ChunkIndex(chunks=[mk_chunk("b/other.py", "bravoecho not related")]))

    a_hits = a.search("alphafoxtrot")
    b_hits = b.search("alphafoxtrot")
    assert any("secret.py" in h.chunk.path for h in a_hits)
    # Repo B must NOT see repo A's content even though they share the same query.
    assert all("secret.py" not in h.chunk.path for h in b_hits)
