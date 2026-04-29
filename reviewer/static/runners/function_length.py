"""R15.2: function length cap.

Default 50 lines (warn), 100 (block). Python via AST; everything else via brace heuristic.
"""

from __future__ import annotations

import ast
import re
from collections.abc import Iterable
from pathlib import Path

from ...ingest.git_extract import BranchDiff
from . import StaticFinding, register

THRESHOLD = 50
HARD_CAP = 100

SKIP_PARTS = {"node_modules", ".venv", "venv", "dist", "build", ".git", "__pycache__"}


@register("function_length")
def run(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    files = (
        [workdir / p for p in diff.files_changed]
        if diff and diff.files_changed
        else [p for p in workdir.rglob("*") if p.is_file()]
    )
    for p in files:
        if any(part in SKIP_PARTS for part in p.parts):
            continue
        if p.suffix.lower() == ".py":
            yield from _scan_python(workdir, p)
        elif p.suffix.lower() in {".ts", ".tsx", ".js", ".jsx", ".go", ".java", ".rs"}:
            yield from _scan_braces(workdir, p)


def _scan_python(workdir: Path, p: Path) -> Iterable[StaticFinding]:
    try:
        src = p.read_text(encoding="utf-8", errors="ignore")
        tree = ast.parse(src)
    except (OSError, SyntaxError):
        return
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            start = node.lineno
            end = getattr(node, "end_lineno", start)
            length = max(0, end - start)
            if length > THRESHOLD:
                yield StaticFinding(
                    rule_id="R15.2",
                    file_path=str(p.relative_to(workdir)),
                    start_line=start,
                    end_line=end,
                    snippet=f"def {node.name}(...) — {length} lines",
                    rationale=f"Function `{node.name}` is {length} lines (cap is {THRESHOLD}, hard cap {HARD_CAP}).",
                    fix_suggestion="Decompose: extract helpers along the obvious responsibility seams.",
                )


_BRACE_FUNC = re.compile(r"\b(?:function\s+\w+|\w+\s*=\s*function|\w+\s*=\s*\([^)]*\)\s*=>|func\s+\w+|fn\s+\w+|public\s+\w[\w<>]*\s+\w+|private\s+\w[\w<>]*\s+\w+)\s*[\({]")


def _scan_braces(workdir: Path, p: Path) -> Iterable[StaticFinding]:
    try:
        text = p.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return
    lines = text.splitlines()
    in_func = False
    depth = 0
    start = 0
    for n, line in enumerate(lines, start=1):
        if not in_func and _BRACE_FUNC.search(line):
            in_func = True
            depth = line.count("{") - line.count("}")
            start = n
            if depth <= 0 and "{" in line:
                # one-liner; skip
                in_func = False
            continue
        if in_func:
            depth += line.count("{") - line.count("}")
            if depth <= 0:
                length = n - start
                if length > THRESHOLD:
                    yield StaticFinding(
                        rule_id="R15.2",
                        file_path=str(p.relative_to(workdir)),
                        start_line=start,
                        end_line=n,
                        snippet=lines[start - 1].strip()[:200],
                        rationale=f"Function spans {length} lines (cap {THRESHOLD}, hard cap {HARD_CAP}).",
                        fix_suggestion="Decompose: extract helpers.",
                    )
                in_func = False
