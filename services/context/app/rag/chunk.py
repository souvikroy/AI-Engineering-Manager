"""Source-specific chunkers. Each returns a list of (ordinal, text) pairs.

Strategy by source:
- slack:     1 message per chunk (already small).
- jira:      description + each comment is its own chunk.
- sentry:    title+culprit+top-frame+first-event = single chunk; later events bump count, no re-chunk.
- confluence/notion/gsheet: split on headings, ~800 token target with 100-token overlap.
- github:    PR description + each review comment is its own chunk.
- generic:   recursive paragraph splitter as a fallback.
"""
from __future__ import annotations

import re

import tiktoken

_ENCODING = tiktoken.get_encoding("cl100k_base")


def token_count(text: str) -> int:
    return len(_ENCODING.encode(text))


def _split_by_tokens(text: str, target: int = 800, overlap: int = 100) -> list[str]:
    tokens = _ENCODING.encode(text)
    if len(tokens) <= target:
        return [text]
    chunks: list[str] = []
    start = 0
    while start < len(tokens):
        end = min(start + target, len(tokens))
        chunks.append(_ENCODING.decode(tokens[start:end]))
        if end == len(tokens):
            break
        start = end - overlap
    return chunks


_HEADING_RE = re.compile(r"(?m)^#{1,3}\s+.+$")


def chunk_markdown(text: str, *, target: int = 800, overlap: int = 100) -> list[str]:
    """Split markdown on H1/H2/H3 boundaries, then bound each block to ~target tokens."""
    if not text.strip():
        return []
    matches = list(_HEADING_RE.finditer(text))
    if not matches:
        return _split_by_tokens(text, target=target, overlap=overlap)
    blocks: list[str] = []
    boundaries = [m.start() for m in matches] + [len(text)]
    if boundaries[0] > 0:
        blocks.append(text[: boundaries[0]])
    for a, b in zip(boundaries[:-1], boundaries[1:], strict=False):
        blocks.append(text[a:b])
    out: list[str] = []
    for b in blocks:
        out.extend(_split_by_tokens(b, target=target, overlap=overlap))
    return [b.strip() for b in out if b.strip()]


def chunk_slack_thread(messages: list[dict[str, str]]) -> list[str]:
    """One chunk per message; the thread itself is the parent Document."""
    return [m.get("text", "").strip() for m in messages if m.get("text", "").strip()]


def chunk_jira_issue(description: str, comments: list[str]) -> list[str]:
    parts = [description.strip()] if description.strip() else []
    parts.extend(c.strip() for c in comments if c.strip())
    return parts


def chunk_sentry_issue(title: str, culprit: str, top_frame: str, first_event: str) -> list[str]:
    body = "\n".join(
        s for s in [title.strip(), culprit.strip(), top_frame.strip(), first_event.strip()] if s
    )
    return [body] if body else []


def chunk_generic(text: str) -> list[str]:
    return _split_by_tokens(text)
