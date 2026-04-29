"""Workflow 18 missing static runners.

R18.2  license_audit    — Dependency licenses must be on the approved list.
R18.4  dep_audit        — Dep vulnerability scan (npm audit / pip-audit).
R18.5  lockfile_present — Manifests must have a committed lockfile.
R18.6  pin_range        — Patch-allowing pins (`^x.y.z` for npm, `~=x.y` for Python).
R18.8  duplicate_deps   — No duplicate-purpose deps (two HTTP clients, two date libraries).
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import tomllib
from collections.abc import Iterable
from pathlib import Path

from ...ingest.git_extract import BranchDiff
from . import StaticFinding, register

APPROVED_LICENSES = {
    "MIT", "Apache-2.0", "Apache 2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC",
    "Apache License 2.0", "MIT License", "BSD", "0BSD", "Unlicense", "CC0-1.0",
}
COPYLEFT = {"GPL-2.0", "GPL-3.0", "AGPL-3.0", "LGPL-2.1", "LGPL-3.0", "MPL-2.0"}

# Manifest pairs: (manifest_filename, lockfile_filename | None)
MANIFEST_LOCK_PAIRS: list[tuple[str, str | None]] = [
    ("package.json", "package-lock.json"),    # alt: yarn.lock / pnpm-lock.yaml — handled below
    ("pyproject.toml", "poetry.lock"),         # alt: uv.lock / pdm.lock
    ("Pipfile", "Pipfile.lock"),
    ("requirements.txt", None),                # convention varies
    ("Cargo.toml", "Cargo.lock"),
    ("go.mod", "go.sum"),
    ("Gemfile", "Gemfile.lock"),
    ("composer.json", "composer.lock"),
]


def _find_manifests(workdir: Path) -> list[Path]:
    out: list[Path] = []
    for manifest, _lock in MANIFEST_LOCK_PAIRS:
        for p in workdir.rglob(manifest):
            if "node_modules" in p.parts or ".venv" in p.parts:
                continue
            out.append(p)
    return out


# ---- R18.5 lockfile_present ----
@register("lockfile_present")
def lockfile_present(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for manifest_path in _find_manifests(workdir):
        manifest_name = manifest_path.name
        siblings = {p.name for p in manifest_path.parent.iterdir() if p.is_file()}
        # JS ecosystem: package-lock.json | yarn.lock | pnpm-lock.yaml all count.
        if manifest_name == "package.json":
            if siblings & {"package-lock.json", "yarn.lock", "pnpm-lock.yaml"}:
                continue
        elif manifest_name == "pyproject.toml":
            if siblings & {"poetry.lock", "uv.lock", "pdm.lock"}:
                continue
            # If only [project] / setuptools without a lock manager, allow.
            try:
                data = tomllib.loads(manifest_path.read_text(encoding="utf-8", errors="ignore"))
            except (tomllib.TOMLDecodeError, OSError):
                continue
            if "tool" not in data or not (set(data.get("tool", {})) & {"poetry", "pdm", "uv"}):
                continue
        else:
            expected = next((lock for m, lock in MANIFEST_LOCK_PAIRS if m == manifest_name and lock), None)
            if expected and expected in siblings:
                continue
            if not expected:
                continue
        yield StaticFinding(
            rule_id="R18.5",
            file_path=str(manifest_path.relative_to(workdir)),
            start_line=1,
            end_line=1,
            snippet=manifest_name,
            rationale="Manifest has no committed lockfile. Builds aren't reproducible.",
            fix_suggestion=f"Generate and commit the lockfile (`npm install`, `poetry lock`, etc.) next to {manifest_name}.",
        )


# ---- R18.2 license_audit ----
@register("license_audit")
def license_audit(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for manifest_path in _find_manifests(workdir):
        rel = str(manifest_path.relative_to(workdir))
        try:
            text = manifest_path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        if manifest_path.name == "package.json":
            try:
                data = json.loads(text)
            except json.JSONDecodeError:
                continue
            lic = data.get("license", "")
            if isinstance(lic, dict):
                lic = lic.get("type", "")
            if lic and lic not in APPROVED_LICENSES:
                msg = "copyleft" if lic in COPYLEFT else "non-approved"
                yield StaticFinding(
                    rule_id="R18.2",
                    file_path=rel,
                    start_line=1,
                    end_line=1,
                    snippet=f"license={lic}",
                    rationale=f"Project license `{lic}` is {msg}. Must be on the approved list (MIT/Apache-2.0/BSD).",
                    fix_suggestion="Confirm with legal. Copyleft licenses require legal review.",
                )
        elif manifest_path.name == "pyproject.toml":
            m = re.search(r"^\s*license\s*=\s*[\"']([^\"']+)[\"']", text, re.M)
            if m and m.group(1) not in APPROVED_LICENSES:
                lic = m.group(1)
                msg = "copyleft" if lic in COPYLEFT else "non-approved"
                yield StaticFinding(
                    rule_id="R18.2",
                    file_path=rel,
                    start_line=1,
                    end_line=1,
                    snippet=f"license={lic}",
                    rationale=f"Project license `{lic}` is {msg}.",
                    fix_suggestion="Confirm with legal.",
                )


# ---- R18.4 dep_audit ----
@register("dep_audit")
def dep_audit(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    """Run available audit tools. Soft-fail if neither is installed."""
    pkg_json = workdir / "package.json"
    if pkg_json.exists() and shutil.which("npm"):
        yield from _run_npm_audit(workdir)
    if (workdir / "pyproject.toml").exists() or (workdir / "requirements.txt").exists():
        if shutil.which("pip-audit"):
            yield from _run_pip_audit(workdir)


def _run_npm_audit(workdir: Path) -> Iterable[StaticFinding]:
    try:
        proc = subprocess.run(
            ["npm", "audit", "--json"],
            cwd=str(workdir), capture_output=True, text=True, timeout=120,
        )
    except (OSError, subprocess.TimeoutExpired):
        return
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return
    vulns = data.get("vulnerabilities", {}) or {}
    for name, v in vulns.items():
        sev = (v.get("severity") or "").lower()
        if sev not in {"high", "critical"}:
            continue
        yield StaticFinding(
            rule_id="R18.4",
            file_path="package.json",
            start_line=0,
            end_line=0,
            snippet=f"{name} — {sev}",
            rationale=f"`npm audit` reports a {sev} vulnerability in `{name}`. High/Critical CVEs are blocking.",
            fix_suggestion="Run `npm audit fix`, upgrade the dep, or vendor a patch and document it.",
        )


def _run_pip_audit(workdir: Path) -> Iterable[StaticFinding]:
    try:
        proc = subprocess.run(
            ["pip-audit", "-f", "json"],
            cwd=str(workdir), capture_output=True, text=True, timeout=180,
        )
    except (OSError, subprocess.TimeoutExpired):
        return
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return
    for entry in data.get("dependencies", []):
        for vuln in entry.get("vulns", []) or []:
            yield StaticFinding(
                rule_id="R18.4",
                file_path="pyproject.toml" if (workdir / "pyproject.toml").exists() else "requirements.txt",
                start_line=0,
                end_line=0,
                snippet=f"{entry.get('name')}={entry.get('version')} {vuln.get('id')}",
                rationale=f"`pip-audit` flags {vuln.get('id')} on `{entry.get('name')}`. High/Critical CVEs are blocking.",
                fix_suggestion=f"Upgrade `{entry.get('name')}` past the affected range.",
            )


# ---- R18.6 pin_range ----
_NPM_BAD_PIN = re.compile(r":\s*\"\*\"")             # "*"
_NPM_LATEST  = re.compile(r":\s*\"latest\"")          # "latest"
_PY_LOOSE    = re.compile(r"^\s*([A-Za-z_][\w.\-]+)\s*$", re.M)  # bare name in requirements.txt


@register("pin_range")
def pin_range(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    pkg = workdir / "package.json"
    if pkg.exists():
        text = pkg.read_text(encoding="utf-8", errors="ignore")
        for n, line in enumerate(text.splitlines(), start=1):
            if _NPM_BAD_PIN.search(line) or _NPM_LATEST.search(line):
                yield StaticFinding(
                    rule_id="R18.6",
                    file_path="package.json",
                    start_line=n,
                    end_line=n,
                    snippet=line.strip()[:160],
                    rationale="Dependency pinned to `*` or `latest` — non-reproducible builds.",
                    fix_suggestion="Use a caret range like `^1.2.3` (allows patch updates only).",
                )

    req = workdir / "requirements.txt"
    if req.exists():
        text = req.read_text(encoding="utf-8", errors="ignore")
        for n, line in enumerate(text.splitlines(), start=1):
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            if _PY_LOOSE.match(stripped):
                yield StaticFinding(
                    rule_id="R18.6",
                    file_path="requirements.txt",
                    start_line=n,
                    end_line=n,
                    snippet=stripped[:160],
                    rationale="Unpinned Python dependency — builds are non-reproducible.",
                    fix_suggestion=f"Pin with a range: `{stripped}~=x.y` (allows patch updates).",
                )


# ---- R18.8 duplicate_deps ----
DUPLICATE_GROUPS: list[set[str]] = [
    {"axios", "got", "node-fetch", "request"},     # multiple HTTP clients
    {"moment", "dayjs", "date-fns", "luxon"},      # multiple date libs
    {"lodash", "ramda", "underscore"},              # multiple FP/utility libs
    {"chalk", "colors", "kleur"},                  # multiple terminal-color libs
    {"requests", "httpx", "aiohttp", "urllib3"},   # python http clients
    {"pendulum", "arrow", "delorean"},              # python date libs
]


@register("duplicate_deps")
def duplicate_deps(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    pkg = workdir / "package.json"
    if pkg.exists():
        try:
            data = json.loads(pkg.read_text(encoding="utf-8", errors="ignore"))
        except json.JSONDecodeError:
            data = {}
        deps = set((data.get("dependencies", {}) or {}).keys()) | set((data.get("devDependencies", {}) or {}).keys())
        for group in DUPLICATE_GROUPS:
            overlap = deps & group
            if len(overlap) >= 2:
                yield StaticFinding(
                    rule_id="R18.8",
                    file_path="package.json",
                    start_line=0,
                    end_line=0,
                    snippet=", ".join(sorted(overlap)),
                    rationale=f"Multiple dependencies solving the same problem: {', '.join(sorted(overlap))}. Pick one.",
                    fix_suggestion="Standardize on a single library and migrate the rest. Removing one dep is rarely as costly as carrying two forever.",
                )

    pyproj = workdir / "pyproject.toml"
    if pyproj.exists():
        try:
            data = tomllib.loads(pyproj.read_text(encoding="utf-8", errors="ignore"))
        except (tomllib.TOMLDecodeError, OSError):
            data = {}
        deps_block = data.get("project", {}).get("dependencies", []) or []
        names = {re.split(r"[<>=!~ \[]", d, 1)[0].strip().lower() for d in deps_block if isinstance(d, str)}
        for group in DUPLICATE_GROUPS:
            overlap = names & group
            if len(overlap) >= 2:
                yield StaticFinding(
                    rule_id="R18.8",
                    file_path="pyproject.toml",
                    start_line=0,
                    end_line=0,
                    snippet=", ".join(sorted(overlap)),
                    rationale=f"Duplicate-purpose Python deps: {', '.join(sorted(overlap))}.",
                    fix_suggestion="Standardize on one and migrate the rest.",
                )
