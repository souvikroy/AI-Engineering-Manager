"""Entity-ref extraction. Cheap regex pass first; an optional Haiku pass refines.

Returns canonical entity ref strings like ``"engineer:eng_priya"``,
``"ticket:PROD-1421"``, ``"sprint:S-42"``, ``"service:auth"``.
"""
from __future__ import annotations

import re
from collections.abc import Iterable

# Jira/Linear-style ticket keys: PROD-123, AUTH-9
TICKET_RE = re.compile(r"\b([A-Z][A-Z0-9]+-\d+)\b")
# GitHub PR refs: foo/bar#42 or just #42 in a PR-context doc
PR_REF_RE = re.compile(r"(?:^|\s)#(\d{1,6})\b")
# Already-canonicalized refs from upstream redact: engineer:..., service:...
CANONICAL_RE = re.compile(r"\b(engineer|team|service|sprint|ticket):[A-Za-z0-9_\-]+\b")


def extract_refs_regex(text: str, *, known_services: Iterable[str] = ()) -> list[str]:
    refs: set[str] = set()
    for m in TICKET_RE.finditer(text):
        refs.add(f"ticket:{m.group(1)}")
    for m in CANONICAL_RE.finditer(text):
        refs.add(m.group(0))
    for svc in known_services:
        if re.search(rf"\b{re.escape(svc)}\b", text, flags=re.IGNORECASE):
            refs.add(f"service:{svc}")
    return sorted(refs)


# Optional Haiku-backed extraction — used when the regex pass returns nothing
# and the source warrants the spend (Confluence design docs, long Jira descriptions).
async def extract_refs_haiku(text: str, *, known_entities: list[str]) -> list[str]:
    """Return entity refs from `known_entities` that the text genuinely mentions.

    Implemented as a stub for v1; wire when L1 summary cost permits.
    """
    # TODO(phase-3): call anthropic Haiku with prompt-cached known_entities list.
    return []
