"""R8.4: SQL string concatenation / f-string interpolation in execute calls.

Static-only signal; the LLM verifier may downgrade if the value comes from a constant.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from pathlib import Path

from ...ingest.git_extract import BranchDiff
from . import StaticFinding, register

# Python: cur.execute(f"SELECT ... {x} ..."), cur.execute("SELECT ..." + var)
PY_FSTRING = re.compile(r"\.execute\s*\(\s*f[\"']", re.I)
PY_CONCAT  = re.compile(r"\.execute\s*\(\s*[\"'][^\"']*[\"']\s*[+%]\s*\w+", re.I)
# Generic SELECT/INSERT with f-string
GENERIC_F  = re.compile(r"f[\"'][^\"']*\b(SELECT|INSERT|UPDATE|DELETE)\b[^\"']*\{[^}]+\}", re.I)
# JS template literals: `SELECT ... ${x} ...`
JS_TEMPL   = re.compile(r"`[^`]*\b(SELECT|INSERT|UPDATE|DELETE)\b[^`]*\$\{[^}]+\}", re.I)

SKIP_PARTS = {"node_modules", ".venv", "venv", "dist", "build", ".git", "__pycache__", "tests", "test", "__tests__"}


@register("sql_concat")
def run(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    files = (
        [workdir / p for p in diff.files_changed]
        if diff and diff.files_changed
        else [p for p in workdir.rglob("*") if p.is_file()]
    )
    for p in files:
        if any(part in SKIP_PARTS for part in p.parts):
            continue
        if p.suffix.lower() not in {".py", ".ts", ".tsx", ".js", ".jsx"}:
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for n, line in enumerate(text.splitlines(), start=1):
            patterns = [PY_FSTRING, PY_CONCAT, GENERIC_F, JS_TEMPL]
            if any(pat.search(line) for pat in patterns):
                yield StaticFinding(
                    rule_id="R8.4",
                    file_path=str(p.relative_to(workdir)),
                    start_line=n,
                    end_line=n,
                    snippet=line.strip()[:240],
                    rationale="Looks like SQL built by string interpolation. Textbook injection vector — parameterize.",
                    fix_suggestion='Use placeholders: `cur.execute("SELECT ... WHERE x = %s", (value,))`. ORM users: stay in the parameterized API.',
                    confidence=0.7,  # static-only; LLM verifier may upgrade or kill.
                )
