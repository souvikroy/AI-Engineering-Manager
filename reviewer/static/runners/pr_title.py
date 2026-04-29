"""R1.2: PR title MUST follow `<type>(<scope>): <imperative summary>`, length ≤ 72."""

from __future__ import annotations

import re
from collections.abc import Iterable
from pathlib import Path

from ...ingest.git_extract import BranchDiff
from . import StaticFinding, register

# When we have no PR, we treat the latest commit subject of the branch as the "title".
TITLE_RE = re.compile(r"^(feat|fix|refactor|perf|sec|chore|migration|revert|docs|test|infra|exp)(\([^)]+\))?: .{1,72}$")


@register("pr_title")
def run(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    if diff is None or not diff.commits:
        return
    title = diff.commits[0].subject  # newest commit on branch
    if TITLE_RE.match(title):
        return
    yield StaticFinding(
        rule_id="R1.2",
        file_path="<commit-subject>",
        start_line=0,
        end_line=0,
        snippet=title[:200],
        rationale="Synthesized PR title (latest commit subject) does not match `<type>(<scope>): <imperative summary>` ≤72 chars.",
        fix_suggestion="Reshape commit subject — e.g. `feat(api): add Stripe webhook receiver`.",
        confidence=0.85,
    )
