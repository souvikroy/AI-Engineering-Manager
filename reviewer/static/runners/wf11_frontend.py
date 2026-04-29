"""Workflow 11 missing static runners.

R11.10 component_size — A single component file MUST NOT exceed ~250 lines.
"""

from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path

from ...ingest.git_extract import BranchDiff
from . import StaticFinding, register
from ._helpers import read_lines, scoped_files

THRESHOLD = 250


@register("component_size")
def component_size(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".tsx", ".jsx", ".vue", ".svelte")):
        n_lines = len(read_lines(p))
        if n_lines > THRESHOLD:
            yield StaticFinding(
                rule_id="R11.10",
                file_path=str(p.relative_to(workdir)),
                start_line=1,
                end_line=n_lines,
                snippet=f"{n_lines} lines",
                rationale=f"Component file is {n_lines} lines (cap {THRESHOLD}). Single components shouldn't exceed this and shouldn't carry more than one network-bound effect.",
                fix_suggestion="Split into presentational + container, extract subcomponents, lift hooks into a custom hook module.",
            )
