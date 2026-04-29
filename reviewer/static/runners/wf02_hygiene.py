"""Workflow 2 missing static runners.

R2.1  ci_status         — CI green at review time (GitHub API).
R2.5  commented_code    — Commented-out code blocks.
R2.7  generated_files   — Generated artifacts mixed with hand-written code in same diff.
R2.8  lint              — Run available linters (ruff/eslint/mypy).
R2.9  merge_conflict    — Conflict markers left in the tree.
R2.10 skipped_tests     — `.skip`, `xit`, `t.Skip`, etc. without ticket reference.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from collections.abc import Iterable
from pathlib import Path

from ...core.config import get_settings
from ...ingest.git_extract import BranchDiff
from ...ingest.github_pat import RepoRef, _get
from . import StaticFinding, register
from ._helpers import read_lines, scoped_files


# ---- R2.1 ci_status ----
@register("ci_status")
def ci_status(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    """Query GitHub for CI status of the branch HEAD. Skipped silently if no token / no remote."""
    s = get_settings()
    if not s.github_authed or diff is None or not diff.head_sha:
        return
    # We don't know owner/repo here without plumbing — derive from `git remote`.
    try:
        out = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            cwd=str(workdir), capture_output=True, text=True, check=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return
    m = re.search(r"github\.com[:/]([^/]+)/([^/.]+)", out)
    if not m:
        return
    ref = RepoRef(owner=m.group(1), repo=m.group(2))
    try:
        data = _get(f"/repos/{ref.full}/commits/{diff.head_sha}/check-runs")
    except Exception:  # noqa: BLE001
        return
    runs = (data.get("check_runs") if isinstance(data, dict) else None) or []
    failed = [r for r in runs if (r.get("conclusion") or "") in {"failure", "timed_out", "cancelled", "action_required"}]
    if not failed:
        return
    yield StaticFinding(
        rule_id="R2.1",
        file_path="<ci>",
        start_line=0,
        end_line=0,
        snippet=", ".join(f"{r.get('name')}={r.get('conclusion')}" for r in failed[:3]),
        rationale=f"CI is not green on `{diff.branch}` ({len(failed)} failing check-run(s)). Reviewer must close as draft if red ≥ 24h with no fix.",
        fix_suggestion="Fix CI before requesting review. If flaky, file a quarantine ticket and link it.",
        confidence=0.95,
    )


# ---- R2.5 commented_code ----
_COMMENTED_CODE = [
    re.compile(r"^\s*//\s*[A-Za-z_][\w\.]*\s*\([^)]*\)\s*;?\s*$"),     # JS/TS func call commented
    re.compile(r"^\s*//\s*(?:if|for|while|return|let|const|var)\b"),    # JS/TS keyword
    re.compile(r"^\s*#\s*[A-Za-z_][\w\.]*\s*\([^)]*\)\s*$"),             # Python func call commented
    re.compile(r"^\s*#\s*(?:if|for|while|return|def|class|import|from)\b"),
    re.compile(r"^\s*#\s*[A-Za-z_]\w*\s*=\s"),                           # Python assignment commented
]


@register("commented_code")
def commented_code(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".java", ".rs")):
        lines = read_lines(p)
        # Streak detection: 2+ consecutive commented-code lines.
        run_start: int | None = None
        run_len = 0
        for n, line in enumerate(lines, start=1):
            if any(pat.search(line) for pat in _COMMENTED_CODE):
                if run_start is None:
                    run_start = n
                run_len += 1
            else:
                if run_start is not None and run_len >= 2:
                    yield StaticFinding(
                        rule_id="R2.5",
                        file_path=str(p.relative_to(workdir)),
                        start_line=run_start,
                        end_line=run_start + run_len - 1,
                        snippet=lines[run_start - 1].strip()[:200],
                        rationale="Commented-out code block. History is for archeology — delete it.",
                        fix_suggestion="Delete the commented-out lines. If the code may matter later, that's what `git log -S` is for.",
                    )
                run_start = None
                run_len = 0


# ---- R2.7 generated_files ----
_GENERATED_HINTS = ("lock", ".pb.go", ".pb.py", "generated", "openapi-client", "_pb2.py", ".gen.")
_LOCKFILES = {"package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock", "Cargo.lock", "go.sum", "Pipfile.lock"}


@register("generated_files")
def generated_files(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    if diff is None or not diff.files_changed:
        return
    gen = [f for f in diff.files_changed if any(h in f.lower() for h in _GENERATED_HINTS) or Path(f).name in _LOCKFILES]
    handwritten = [f for f in diff.files_changed if f not in gen and not f.endswith(".md")]
    if gen and handwritten:
        yield StaticFinding(
            rule_id="R2.7",
            file_path="<diff>",
            start_line=0,
            end_line=0,
            snippet=f"generated={len(gen)} handwritten={len(handwritten)} on `{diff.branch}`",
            rationale="Generated files (lock/protobuf/openapi) are mixed with hand-written code in the same branch. Reviewers can't read the diff.",
            fix_suggestion="Move generated files into their own commit prefixed `chore(generated):`.",
            confidence=0.85,
        )


# ---- R2.8 lint ----
@register("lint")
def lint(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    """Run available linters. Each tool is opt-in: we only invoke what's installed."""
    py_files = [str(p.relative_to(workdir)) for p in scoped_files(workdir, diff, suffixes=(".py",))]
    if py_files and shutil.which("ruff"):
        yield from _run_ruff(workdir, py_files)


def _run_ruff(workdir: Path, files: list[str]) -> Iterable[StaticFinding]:
    try:
        proc = subprocess.run(
            ["ruff", "check", "--no-cache", "--output-format=concise", *files],
            cwd=str(workdir), capture_output=True, text=True, timeout=120,
        )
    except (OSError, subprocess.TimeoutExpired):
        return
    for line in proc.stdout.splitlines():
        m = re.match(r"^(.+?):(\d+):(\d+):\s+(\w+)\s+(.+)$", line)
        if not m:
            continue
        path, ln, _col, code, msg = m.groups()
        yield StaticFinding(
            rule_id="R2.8",
            file_path=path,
            start_line=int(ln),
            end_line=int(ln),
            snippet=f"{code}: {msg}"[:200],
            rationale=f"`ruff` reports `{code}`: {msg}. Lint must pass before review.",
            fix_suggestion="Fix the lint issue. If suppression is justified, add a comment explaining why.",
            confidence=0.9,
        )


# ---- R2.9 merge_conflict ----
_CONFLICT_MARKER = re.compile(r"^(<{7}|={7}|>{7})(?:\s|$)")


@register("merge_conflict")
def merge_conflict(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff):
        for n, line in enumerate(read_lines(p), start=1):
            if _CONFLICT_MARKER.match(line):
                yield StaticFinding(
                    rule_id="R2.9",
                    file_path=str(p.relative_to(workdir)),
                    start_line=n,
                    end_line=n,
                    snippet=line[:120],
                    rationale="Merge conflict marker left in tree. Branch must rebase cleanly before review.",
                    fix_suggestion="Resolve the conflict and remove `<<<<<<<`/`=======`/`>>>>>>>` markers.",
                    confidence=0.99,
                )
                break  # one finding per file


# ---- R2.10 skipped_tests ----
_SKIP_PATTERNS = [
    re.compile(r"\b(?:it|describe|test)\.skip\s*\("),                  # JS/TS Jest/Mocha
    re.compile(r"\bxit\s*\("),                                          # Mocha xit
    re.compile(r"\bxdescribe\s*\("),                                    # Mocha xdescribe
    re.compile(r"@(?:pytest\.mark\.)?skip(?:if)?\b"),                  # pytest
    re.compile(r"@unittest\.skip"),                                     # unittest
    re.compile(r"\bt\.Skip\s*\("),                                      # Go test
    re.compile(r"#\[ignore\]"),                                         # Rust
]
_TICKET_NEAR = re.compile(r"\b([A-Z][A-Z0-9]{1,9}-\d+|#\d+|GH-\d+)\b")


@register("skipped_tests")
def skipped_tests(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    test_glob = ("test", "spec", "_test", ".test.", ".spec.")
    for p in scoped_files(workdir, diff, suffixes=(".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".rs")):
        rel = str(p.relative_to(workdir))
        if not any(t in rel.lower() for t in test_glob):
            continue
        lines = read_lines(p)
        for n, line in enumerate(lines, start=1):
            if not any(pat.search(line) for pat in _SKIP_PATTERNS):
                continue
            window = "\n".join(lines[max(0, n - 4) : n + 1])
            if _TICKET_NEAR.search(window):
                continue
            yield StaticFinding(
                rule_id="R2.10",
                file_path=rel,
                start_line=n,
                end_line=n,
                snippet=line.strip()[:200],
                rationale="Skipped test without a linked ticket. Tests must not be silently skipped — flaky-test PRs are forbidden.",
                fix_suggestion="Add `// JIRA-1234: skipped because <reason>` near the skip, or remove the skip and fix the test.",
            )
