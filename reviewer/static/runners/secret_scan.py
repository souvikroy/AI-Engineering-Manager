"""R2.6 / R8.9: secrets, tokens, private keys present in the repo.

Lightweight, opinionated rules. For production use, layer `gitleaks` or `trufflehog` on top.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from pathlib import Path

from ...ingest.git_extract import BranchDiff
from . import StaticFinding, register

PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("github-pat",     re.compile(r"\bghp_[A-Za-z0-9]{30,}\b")),
    ("github-oauth",   re.compile(r"\bgho_[A-Za-z0-9]{30,}\b")),
    ("github-server",  re.compile(r"\bghs_[A-Za-z0-9]{30,}\b")),
    ("openai-key",     re.compile(r"\bsk-[A-Za-z0-9_\-]{20,}\b")),
    ("openrouter-key", re.compile(r"\bsk-or-[A-Za-z0-9\-]{20,}\b")),
    ("aws-access-key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("private-key",    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("jwt",            re.compile(r"\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\b")),
    ("slack-token",    re.compile(r"\bxox[baprs]-[A-Za-z0-9\-]{10,}\b")),
    ("google-api-key", re.compile(r"\bAIza[0-9A-Za-z\-_]{35}\b")),
]

SKIP_PARTS = {"node_modules", ".venv", "venv", "dist", "build", ".git", "__pycache__"}


@register("secret_scan")
def run(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    files = [workdir / p for p in (diff.files_changed if diff else [])]
    if not diff:
        files = [p for p in workdir.rglob("*") if p.is_file()]
    for p in files:
        if any(part in SKIP_PARTS for part in p.parts):
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for n, line in enumerate(text.splitlines(), start=1):
            for kind, pat in PATTERNS:
                if pat.search(line):
                    yield StaticFinding(
                        rule_id="R2.6",
                        file_path=str(p.relative_to(workdir)),
                        start_line=n,
                        end_line=n,
                        snippet=f"<{kind} matched; content redacted>",
                        rationale=f"Secret of kind {kind!r} appears committed. This is reject-outright — rotate the credential immediately.",
                        fix_suggestion="Rotate the credential. Move to a secret manager. Purge from history with `git filter-repo`.",
                        confidence=0.99,
                    )
                    break
