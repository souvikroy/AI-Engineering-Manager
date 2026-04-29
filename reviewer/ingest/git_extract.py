"""Clone a repo and extract: branches, per-branch diff vs default, file tree, commit log."""

from __future__ import annotations

import logging
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from ..core.config import get_settings
from .github_pat import RepoRef, clone_url_for, parse_repo_url

log = logging.getLogger(__name__)


@dataclass
class CommitInfo:
    sha: str
    author_name: str
    author_email: str
    date: str
    subject: str
    body: str = ""


@dataclass
class BranchDiff:
    branch: str
    head_sha: str
    base_sha: str
    files_changed: list[str]
    additions: int
    deletions: int
    net_changed: int
    unified_diff: str
    commits: list[CommitInfo] = field(default_factory=list)


@dataclass
class IngestResult:
    repo: RepoRef
    work_dir: Path           # where the bare mirror lives
    checkout_dir: Path       # where the working tree is checked out (default branch)
    default_branch: str
    head_sha: str
    branches: list[str]
    file_tree: list[str]
    branch_diffs: list[BranchDiff]


def _run(cmd: list[str], cwd: Path | None = None, *, check: bool = True, capture: bool = True) -> subprocess.CompletedProcess:
    log.debug("$ %s", " ".join(cmd))
    return subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        check=check,
        capture_output=capture,
        text=True,
    )


def _git(args: list[str], cwd: Path) -> str:
    return _run(["git", *args], cwd=cwd).stdout.rstrip("\n")


def clone_repo(url: str, *, max_branches_diffed: int = 20) -> IngestResult:
    """Mirror clone, then check out the default branch into a worktree.

    `max_branches_diffed` caps how many non-default branches we compute diffs for —
    purely a token-budget guard.
    """
    ref = parse_repo_url(url)
    s = get_settings()
    s.work_dir.mkdir(parents=True, exist_ok=True)
    base = (s.work_dir / f"{ref.owner}__{ref.repo}").resolve()
    bare = base / "bare.git"
    work = base / "work"

    if bare.exists():
        shutil.rmtree(bare)
    if work.exists():
        shutil.rmtree(work)

    bare.parent.mkdir(parents=True, exist_ok=True)
    _run([
        "git", "clone", "--mirror", "--filter=blob:limit=1m",
        clone_url_for(ref), str(bare),
    ])

    # Determine default branch.
    head_ref = _git(["symbolic-ref", "HEAD"], cwd=bare).strip()  # refs/heads/<name>
    default_branch = head_ref.rsplit("/", 1)[-1] if head_ref.startswith("refs/heads/") else "main"

    # Set up a worktree pointing at default branch.
    _run(["git", "worktree", "add", str(work), default_branch], cwd=bare)

    head_sha = _git(["rev-parse", default_branch], cwd=bare)
    branches_raw = _git(["branch", "--list", "--format=%(refname:short)"], cwd=bare).splitlines()
    branches = [b.strip() for b in branches_raw if b.strip()]

    # File tree at default branch.
    files_raw = _git(["ls-tree", "-r", "--name-only", default_branch], cwd=bare).splitlines()
    file_tree = [f for f in files_raw if f]

    # Per-branch synthesized PR diffs.
    branch_diffs: list[BranchDiff] = []
    for b in branches:
        if b == default_branch:
            continue
        if len(branch_diffs) >= max_branches_diffed:
            log.info("branch diff cap reached (%d); skipping the rest", max_branches_diffed)
            break
        try:
            branch_diffs.append(_compute_branch_diff(bare, default_branch, b))
        except subprocess.CalledProcessError as e:  # noqa: PERF203
            log.warning("branch diff failed for %s: %s", b, e.stderr.strip())

    return IngestResult(
        repo=ref,
        work_dir=bare,
        checkout_dir=work,
        default_branch=default_branch,
        head_sha=head_sha,
        branches=branches,
        file_tree=file_tree,
        branch_diffs=branch_diffs,
    )


def _compute_branch_diff(bare: Path, default_branch: str, branch: str) -> BranchDiff:
    """Three-dot diff: changes on `branch` since it diverged from `default_branch`."""
    range_spec = f"{default_branch}...{branch}"
    head_sha = _git(["rev-parse", branch], cwd=bare)
    merge_base = _git(["merge-base", default_branch, branch], cwd=bare)

    numstat = _git(["diff", "--numstat", range_spec], cwd=bare)
    files: list[str] = []
    additions = deletions = 0
    for line in numstat.splitlines():
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        a_str, d_str, path = parts[0], parts[1], parts[2]
        if a_str.isdigit():
            additions += int(a_str)
        if d_str.isdigit():
            deletions += int(d_str)
        files.append(path)

    # Cap diff size to keep token costs bounded.
    diff_text = _git(["diff", "--unified=3", range_spec], cwd=bare)
    if len(diff_text) > 200_000:
        diff_text = diff_text[:200_000] + "\n... [diff truncated at 200KB] ..."

    log_raw = _git([
        "log", "--no-merges", "--pretty=format:%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b%x1e",
        f"{default_branch}..{branch}",
    ], cwd=bare)
    commits: list[CommitInfo] = []
    for entry in log_raw.split("\x1e"):
        entry = entry.strip()
        if not entry:
            continue
        parts = entry.split("\x1f")
        if len(parts) < 5:
            continue
        sha, an, ae, dt, subj = parts[:5]
        body = parts[5] if len(parts) >= 6 else ""
        commits.append(CommitInfo(sha=sha, author_name=an, author_email=ae, date=dt, subject=subj, body=body))

    return BranchDiff(
        branch=branch,
        head_sha=head_sha,
        base_sha=merge_base,
        files_changed=files,
        additions=additions,
        deletions=deletions,
        net_changed=additions + deletions,
        unified_diff=diff_text,
        commits=commits,
    )
