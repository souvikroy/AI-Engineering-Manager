"""Redact secrets and PII before content reaches LLMs or logs.

R8.10 / R16.10 applied to ourselves: never let a token or PII leak into provider IO logs.
"""

from __future__ import annotations

import re

# Order matters: longest/most-specific patterns first.
PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("GITHUB_TOKEN", re.compile(r"\bghp_[A-Za-z0-9]{30,}\b")),
    ("GITHUB_TOKEN", re.compile(r"\bgho_[A-Za-z0-9]{30,}\b")),
    ("GITHUB_TOKEN", re.compile(r"\bghs_[A-Za-z0-9]{30,}\b")),
    ("GITHUB_TOKEN", re.compile(r"\bghu_[A-Za-z0-9]{30,}\b")),
    ("OPENAI_KEY",   re.compile(r"\bsk-[A-Za-z0-9_\-]{20,}\b")),
    ("OPENROUTER_KEY", re.compile(r"\bsk-or-[A-Za-z0-9\-]{20,}\b")),
    ("AWS_ACCESS_KEY", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("AWS_SECRET_KEY", re.compile(r"(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])")),
    ("JWT", re.compile(r"\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\b")),
    ("PRIVATE_KEY", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----")),
    ("EMAIL", re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b")),
    ("IPV4", re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")),
]


def redact(text: str, *, mark: bool = True) -> str:
    """Replace each match with `[REDACTED:<KIND>]` (or just `[REDACTED]` if mark=False)."""
    if not text:
        return text
    out = text
    for kind, pat in PATTERNS:
        replacement = f"[REDACTED:{kind}]" if mark else "[REDACTED]"
        out = pat.sub(replacement, out)
    return out


def redact_dict(obj):
    """Recursively redact strings inside dicts/lists. Returns new structure."""
    if isinstance(obj, str):
        return redact(obj)
    if isinstance(obj, dict):
        return {k: redact_dict(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return type(obj)(redact_dict(x) for x in obj)
    return obj
