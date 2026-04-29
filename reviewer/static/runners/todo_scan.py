"""R2.4: TODO/FIXME/XXX/HACK/console.log/println!/debugger left without ticket reference."""

from __future__ import annotations

import re
from collections.abc import Iterable
from pathlib import Path

from ...ingest.git_extract import BranchDiff
from . import StaticFinding, register

PATTERNS = [
    re.compile(r"\b(TODO|FIXME|XXX|HACK)\b(?!\s*[\(:][A-Z]+-\d+[\):])", re.I),
    re.compile(r"\bconsole\.(log|debug)\s*\("),
    re.compile(r"\bdebugger\s*;"),
    re.compile(r"\bprintln!\s*\("),
    re.compile(r"\bfmt\.Println\s*\("),
]

# Don't scan node_modules etc.
SKIP_PARTS = {"node_modules", ".venv", "venv", "dist", "build", ".git", "__pycache__"}


@register("todo_scan")
def run(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    targets = _scope(workdir, diff)
    for path in targets:
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for n, line in enumerate(text.splitlines(), start=1):
            for pat in PATTERNS:
                if pat.search(line):
                    yield StaticFinding(
                        rule_id="R2.4",
                        file_path=str(path.relative_to(workdir)),
                        start_line=n,
                        end_line=n,
                        snippet=line.strip()[:200],
                        rationale="Stray TODO/FIXME/HACK/console.log/debugger left in shipped code without a ticket reference.",
                        fix_suggestion="Either remove or attach a ticket: `// TODO(JIRA-1234): ...`",
                    )
                    break


def _scope(workdir: Path, diff: BranchDiff | None) -> list[Path]:
    if diff and diff.files_changed:
        return [workdir / p for p in diff.files_changed if (workdir / p).is_file()]
    out: list[Path] = []
    for p in workdir.rglob("*"):
        if not p.is_file():
            continue
        if any(part in SKIP_PARTS for part in p.parts):
            continue
        if p.suffix.lower() in {".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".rs", ".java"}:
            out.append(p)
    return out
