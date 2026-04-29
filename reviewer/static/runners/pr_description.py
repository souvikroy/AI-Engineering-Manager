"""R1.1: synthesized PR description must contain Problem/Solution/Risk/Rollback/Testing.

Since we synthesize the description from commit messages, this rule almost always fires —
but with severity downgraded one tier (P0→P1, etc.) per the plan. We still emit it so the
report tells the reader what context was missing.
"""

from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path

from ...ingest.git_extract import BranchDiff
from . import StaticFinding, register

REQUIRED = ["Problem", "Solution", "Out of Scope", "Risk", "Rollback", "Testing", "Linked ticket"]


@register("pr_description")
def run(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    if diff is None or not diff.commits:
        return
    # Concatenate all commit bodies as the "synthesized PR body".
    body = "\n".join(f"{c.subject}\n{c.body}" for c in diff.commits)
    missing = [s for s in REQUIRED if s.lower() not in body.lower()]
    if not missing:
        return
    yield StaticFinding(
        rule_id="R1.1",
        file_path="<pr-description>",
        start_line=0,
        end_line=0,
        snippet=f"branch={diff.branch} commits={len(diff.commits)}",
        rationale=(
            "PR description was synthesized from commit messages and is missing required sections: "
            + ", ".join(missing)
            + ". Severity downgraded because no real PR exists yet."
        ),
        fix_suggestion="Open the PR with the standard template (Problem/Solution/Out of Scope/Risk/Rollback/Testing/Linked ticket).",
        confidence=0.95,
    )
