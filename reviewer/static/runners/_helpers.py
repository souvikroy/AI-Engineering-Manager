"""Shared helpers for static runners."""

from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path

from ...ingest.git_extract import BranchDiff

SKIP_PARTS = {"node_modules", ".venv", "venv", "dist", "build", ".git", "__pycache__"}


def scoped_files(
    workdir: Path,
    diff: BranchDiff | None,
    *,
    suffixes: tuple[str, ...] | None = None,
    name_match: tuple[str, ...] | None = None,
) -> Iterable[Path]:
    """Yield files relevant to this branch diff (or whole tree if diff is None).

    `suffixes`: filter by extension (e.g. (".py",)).
    `name_match`: filter by basename containing any of these substrings.
    """
    if diff and diff.files_changed:
        candidates = [workdir / p for p in diff.files_changed if (workdir / p).is_file()]
    else:
        candidates = [p for p in workdir.rglob("*") if p.is_file()]

    for p in candidates:
        if any(part in SKIP_PARTS for part in p.parts):
            continue
        if suffixes and p.suffix.lower() not in suffixes:
            continue
        if name_match and not any(s in p.name for s in name_match):
            continue
        yield p


def read_lines(path: Path) -> list[str]:
    try:
        return path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return []
