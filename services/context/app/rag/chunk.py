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


def _format_block(speaker: str, ts_seconds: int, text: str) -> str:
    mm, ss = divmod(max(0, int(ts_seconds)), 60)
    return f"[{speaker} @{mm:02d}:{ss:02d}] {text.strip()}"


def chunk_transcript(
    segments: list[dict],
    *,
    target_tokens: int = 800,
) -> list[str]:
    """Speaker-grouped chunker for meeting transcripts.

    Input: a list of `{speaker, ts, text}` dicts where `speaker` is the canonical
    entity ref (e.g. `engineer:eng_priya`) and `ts` is seconds from meeting start.

    Algorithm:
    1. Collapse adjacent same-speaker segments into one block; first segment's ts wins.
    2. Format each block as `[<speaker> @MM:SS] <text>` so retrieval surfaces who
       said what, and the entity-ref regex auto-discovers `engineer:` refs.
    3. Greedy-pack blocks into chunks until ~target_tokens. Break only between
       blocks (never mid-turn).
    4. Overlap = the last block of the previous chunk prepended to the next, so
       turn boundaries stay intact.
    """
    if not segments:
        return []

    # 1. collapse adjacent same-speaker turns
    blocks: list[str] = []
    cur_speaker: str | None = None
    cur_ts: int = 0
    cur_parts: list[str] = []
    for seg in segments:
        speaker = (seg.get("speaker") or "").strip()
        text = (seg.get("text") or "").strip()
        if not speaker or not text:
            continue
        ts = int(seg.get("ts") or 0)
        if speaker == cur_speaker:
            cur_parts.append(text)
        else:
            if cur_parts and cur_speaker is not None:
                blocks.append(_format_block(cur_speaker, cur_ts, " ".join(cur_parts)))
            cur_speaker = speaker
            cur_ts = ts
            cur_parts = [text]
    if cur_parts and cur_speaker is not None:
        blocks.append(_format_block(cur_speaker, cur_ts, " ".join(cur_parts)))

    if not blocks:
        return []

    # 2. greedy-pack blocks under target_tokens, break on speaker boundary
    chunks: list[str] = []
    cur_chunk_blocks: list[str] = []
    cur_tokens: int = 0
    for block in blocks:
        bt = token_count(block)
        if cur_chunk_blocks and cur_tokens + bt > target_tokens:
            chunks.append("\n\n".join(cur_chunk_blocks))
            # overlap: carry the last block forward into the next chunk
            cur_chunk_blocks = [cur_chunk_blocks[-1], block]
            cur_tokens = token_count(cur_chunk_blocks[-2]) + bt
        else:
            cur_chunk_blocks.append(block)
            cur_tokens += bt
    if cur_chunk_blocks:
        chunks.append("\n\n".join(cur_chunk_blocks))
    return chunks
