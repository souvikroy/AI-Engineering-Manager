"""R2.2: PR > 400 net changed lines without [oversized-justified] label."""

from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path

from ...ingest.git_extract import BranchDiff
from . import StaticFinding, register

CAP = 400
GENERATED_HINTS = ("lock", "generated", ".pb.go", ".pb.py", "openapi")


@register("diff_size")
def run(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    if diff is None:
        return
    handwritten = sum(
        1
        for f in diff.files_changed
        if not any(h in f.lower() for h in GENERATED_HINTS) and not f.endswith(".md")
    )
    # We don't have per-file additions vs generated split; approximate: net_changed scaled by ratio.
    if not diff.files_changed:
        return
    ratio = handwritten / len(diff.files_changed)
    handwritten_lines = int(diff.net_changed * ratio)
    if handwritten_lines > CAP:
        yield StaticFinding(
            rule_id="R2.2",
            file_path="<diff>",
            start_line=0,
            end_line=0,
            snippet=f"{handwritten_lines} hand-written lines (~{diff.net_changed} total) on `{diff.branch}`",
            rationale=f"Branch carries ~{handwritten_lines} hand-written changed lines vs {CAP}-line cap. Split it or label `[oversized-justified]` with a paragraph explaining why splitting is impossible.",
            fix_suggestion="Carve into independently shippable PRs along the responsibility seams.",
        )
