"""R15.11: file length ≤ 500 lines for most languages."""

from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path

from ...ingest.git_extract import BranchDiff
from . import StaticFinding, register

THRESHOLD = 500
SKIP_PARTS = {"node_modules", ".venv", "venv", "dist", "build", ".git", "__pycache__"}
SOURCE_EXTS = {".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".java", ".rs", ".rb", ".cpp", ".c", ".h"}


@register("file_length")
def run(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    files = (
        [workdir / p for p in diff.files_changed]
        if diff and diff.files_changed
        else [p for p in workdir.rglob("*") if p.is_file()]
    )
    for p in files:
        if any(part in SKIP_PARTS for part in p.parts):
            continue
        if p.suffix.lower() not in SOURCE_EXTS:
            continue
        try:
            n_lines = sum(1 for _ in p.open("r", encoding="utf-8", errors="ignore"))
        except OSError:
            continue
        if n_lines > THRESHOLD:
            yield StaticFinding(
                rule_id="R15.11",
                file_path=str(p.relative_to(workdir)),
                start_line=1,
                end_line=n_lines,
                snippet=f"{n_lines} lines",
                rationale=f"File is {n_lines} lines (cap {THRESHOLD}). Split by responsibility.",
                fix_suggestion="Find a natural seam (one type, one concern, one layer) and move pieces into siblings.",
            )
