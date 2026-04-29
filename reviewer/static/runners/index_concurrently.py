"""R9.5: CREATE INDEX without CONCURRENTLY in PostgreSQL migrations."""

from __future__ import annotations

import re
from collections.abc import Iterable
from pathlib import Path

from ...ingest.git_extract import BranchDiff
from . import StaticFinding, register

CREATE_INDEX = re.compile(r"\bCREATE\s+(?:UNIQUE\s+)?INDEX\b", re.I)
CONCURRENTLY = re.compile(r"\bCONCURRENTLY\b", re.I)


@register("index_concurrently")
def run(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    candidates: list[Path] = []
    files = diff.files_changed if diff else None
    if files:
        candidates = [workdir / p for p in files if p.lower().endswith(".sql")]
    else:
        candidates = [p for p in workdir.rglob("*.sql") if p.is_file()]
    for p in candidates:
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for n, line in enumerate(text.splitlines(), start=1):
            if CREATE_INDEX.search(line) and not CONCURRENTLY.search(line):
                yield StaticFinding(
                    rule_id="R9.5",
                    file_path=str(p.relative_to(workdir)),
                    start_line=n,
                    end_line=n,
                    snippet=line.strip()[:240],
                    rationale="`CREATE INDEX` without `CONCURRENTLY` takes a long lock on a busy table.",
                    fix_suggestion="Use `CREATE INDEX CONCURRENTLY` (PostgreSQL) or `gh-ost`/`pt-online-schema-change` for MySQL.",
                )
