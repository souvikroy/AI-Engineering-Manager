"""Workflow 15 missing static runners.

R15.3 cyclomatic — Cyclomatic complexity ≤ 10 per function.
R15.9 dead_code  — `if False:`, code after return, commented-out blocks at the file level.
"""

from __future__ import annotations

import ast
import re
from collections.abc import Iterable
from pathlib import Path

from ...ingest.git_extract import BranchDiff
from . import StaticFinding, register
from ._helpers import read_lines, scoped_files

CYCLO_THRESHOLD = 10


# ---- R15.3 cyclomatic (Python only for the MVP) ----
class _ComplexityVisitor(ast.NodeVisitor):
    """Simplified McCabe: +1 per branch / boolean op / except / comprehension if-clause."""

    def __init__(self) -> None:
        self.complexity = 1  # base path

    def visit_If(self, node: ast.If) -> None:  # noqa: N802
        self.complexity += 1
        self.generic_visit(node)

    def visit_For(self, node: ast.For) -> None:  # noqa: N802
        self.complexity += 1
        self.generic_visit(node)

    def visit_AsyncFor(self, node: ast.AsyncFor) -> None:  # noqa: N802
        self.complexity += 1
        self.generic_visit(node)

    def visit_While(self, node: ast.While) -> None:  # noqa: N802
        self.complexity += 1
        self.generic_visit(node)

    def visit_ExceptHandler(self, node: ast.ExceptHandler) -> None:  # noqa: N802
        self.complexity += 1
        self.generic_visit(node)

    def visit_BoolOp(self, node: ast.BoolOp) -> None:  # noqa: N802
        self.complexity += max(0, len(node.values) - 1)
        self.generic_visit(node)

    def visit_Match(self, node: ast.Match) -> None:  # noqa: N802
        self.complexity += len(node.cases)
        self.generic_visit(node)

    def visit_IfExp(self, node: ast.IfExp) -> None:  # noqa: N802
        self.complexity += 1
        self.generic_visit(node)

    def visit_comprehension(self, node: ast.comprehension) -> None:
        self.complexity += len(node.ifs)
        self.generic_visit(node)


@register("cyclomatic")
def cyclomatic(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py",)):
        try:
            tree = ast.parse("\n".join(read_lines(p)))
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            v = _ComplexityVisitor()
            v.visit(node)
            if v.complexity > CYCLO_THRESHOLD:
                yield StaticFinding(
                    rule_id="R15.3",
                    file_path=str(p.relative_to(workdir)),
                    start_line=node.lineno,
                    end_line=getattr(node, "end_lineno", node.lineno),
                    snippet=f"def {node.name}(...) — cyclomatic {v.complexity}",
                    rationale=f"Cyclomatic complexity {v.complexity} exceeds the {CYCLO_THRESHOLD} cap. Branchy code is hard to test.",
                    fix_suggestion="Extract early-return guards, push branches into polymorphism / lookup tables, or split into smaller functions.",
                )


# ---- R15.9 dead_code ----
_DEAD_PATTERNS = [
    re.compile(r"^\s*if\s+False\s*:"),
    re.compile(r"^\s*if\s+0\s*:"),
    re.compile(r"^\s*if\s*\(\s*false\s*\)\s*\{"),
]


@register("dead_code")
def dead_code(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".java", ".rs")):
        lines = read_lines(p)
        for n, line in enumerate(lines, start=1):
            if any(pat.search(line) for pat in _DEAD_PATTERNS):
                yield StaticFinding(
                    rule_id="R15.9",
                    file_path=str(p.relative_to(workdir)),
                    start_line=n,
                    end_line=n,
                    snippet=line.strip()[:160],
                    rationale="`if False`/`if 0`/`if (false)` block is unreachable.",
                    fix_suggestion="Delete the dead branch. If you need a feature flag, use the flag system.",
                )
        # Python: detect simple unreachable code after `return` at the same indent.
        if p.suffix == ".py":
            yield from _python_unreachable(workdir, p, lines)


def _python_unreachable(workdir: Path, p: Path, lines: list[str]) -> Iterable[StaticFinding]:
    try:
        tree = ast.parse("\n".join(lines))
    except SyntaxError:
        return
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        body = node.body
        for i, stmt in enumerate(body[:-1]):
            if isinstance(stmt, (ast.Return, ast.Raise)) and i + 1 < len(body):
                next_stmt = body[i + 1]
                yield StaticFinding(
                    rule_id="R15.9",
                    file_path=str(p.relative_to(workdir)),
                    start_line=next_stmt.lineno,
                    end_line=getattr(next_stmt, "end_lineno", next_stmt.lineno),
                    snippet=lines[next_stmt.lineno - 1].strip()[:200] if next_stmt.lineno - 1 < len(lines) else "",
                    rationale="Unreachable code after `return`/`raise`.",
                    fix_suggestion="Delete the unreachable statement(s).",
                )
                break
