"""Workflow 1 missing static runners: linked_ticket (R1.3)."""

from __future__ import annotations

import re
from collections.abc import Iterable
from pathlib import Path

from ...ingest.git_extract import BranchDiff
from . import StaticFinding, register

TICKET_RE = re.compile(r"\b([A-Z][A-Z0-9]{1,9}-\d+|#\d+|GH-\d+|gh-\d+)\b")


@register("linked_ticket")
def linked_ticket(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    """R1.3: PR must link a ticket.

    Synthesized from commits + branch name. Hot-fixes may skip with `hotfix/` prefix.
    """
    if diff is None:
        return
    if diff.branch.lower().startswith("hotfix/"):
        return
    haystack = diff.branch + "\n" + "\n".join(c.subject + "\n" + c.body for c in diff.commits)
    if TICKET_RE.search(haystack):
        return
    yield StaticFinding(
        rule_id="R1.3",
        file_path="<branch>",
        start_line=0,
        end_line=0,
        snippet=diff.branch,
        rationale="No ticket reference (Jira/Linear/GitHub issue) found in branch name or commit messages. Hot-fixes may skip linkage only with a `hotfix/` branch prefix.",
        fix_suggestion="Reference the ticket: include `JIRA-1234` or `#42` in a commit subject, or rebase to add it.",
        confidence=0.9,
    )
