"""Workflow 9 missing static runners.

R9.9 migration_down — Migration files must include both `up` and `down`.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from pathlib import Path

from ...ingest.git_extract import BranchDiff
from . import StaticFinding, register
from ._helpers import read_lines, scoped_files

# Heuristic: a file is a migration if its path contains `migration` or `alembic`
# or it lives in `db/migrations`, `prisma/migrations`, etc.
_MIGRATION_PATH = re.compile(r"(?:^|/)(?:migration|alembic|migrations|prisma)(?:/|s/)", re.I)

# Frameworks signal up/down differently:
#   Alembic:           def upgrade(...) / def downgrade(...)
#   Django:            operations / forwards (rare for raw)
#   node-pg-migrate:   exports.up / exports.down
#   Knex:              exports.up / exports.down
#   raw SQL:           -- +migrate Up / -- +migrate Down (golang-migrate)
_UP_PATTERNS = [
    re.compile(r"\bdef\s+upgrade\s*\("),
    re.compile(r"\bexports?\.up\s*="),
    re.compile(r"--\s*\+\s*migrate\s+Up", re.I),
    re.compile(r"^--\s*UP\s*$", re.I | re.M),
]
_DOWN_PATTERNS = [
    re.compile(r"\bdef\s+downgrade\s*\("),
    re.compile(r"\bexports?\.down\s*="),
    re.compile(r"--\s*\+\s*migrate\s+Down", re.I),
    re.compile(r"^--\s*DOWN\s*$", re.I | re.M),
]


@register("migration_down")
def migration_down(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py", ".sql", ".js", ".ts")):
        rel = str(p.relative_to(workdir))
        if not _MIGRATION_PATH.search(rel):
            continue
        text = "\n".join(read_lines(p))
        has_up = any(pat.search(text) for pat in _UP_PATTERNS)
        has_down = any(pat.search(text) for pat in _DOWN_PATTERNS)
        if has_up and not has_down:
            yield StaticFinding(
                rule_id="R9.9",
                file_path=rel,
                start_line=1,
                end_line=len(text.splitlines()),
                snippet=f"migration with up but no down: {rel}",
                rationale="Migration declares an `up` step but no `down`. Irreversible migrations require a documented manual recovery.",
                fix_suggestion="Add a `down`/`downgrade` block. If irreversible, write the manual rollback steps in a doc and reference it here.",
            )
