"""Run the configured set of static analyzers and return findings tagged with rule metadata."""

from __future__ import annotations

import logging
from dataclasses import asdict
from pathlib import Path

from ..ingest.git_extract import BranchDiff
from ..rules.registry import all_rules
from .runners import StaticFinding, all_runners

log = logging.getLogger(__name__)


def runners_to_invoke() -> dict[str, list[str]]:
    """{runner_name: [rule_id, ...]} — multiple rules can share a runner (e.g. secret_scan -> R2.6, R8.9)."""
    out: dict[str, list[str]] = {}
    for r in all_rules().values():
        if r.static_runner:
            out.setdefault(r.static_runner, []).append(r.id)
    return out


def run_static(workdir: Path, diff: BranchDiff | None = None) -> list[StaticFinding]:
    invoke = runners_to_invoke()
    available = all_runners()
    findings: list[StaticFinding] = []
    for name in invoke:
        fn = available.get(name)
        if fn is None:
            log.debug("no static runner registered for %s", name)
            continue
        try:
            for f in fn(workdir, diff):
                findings.append(f)
        except Exception as e:  # noqa: BLE001
            log.warning("static runner %s crashed: %s", name, e)
    return findings


def severity_for(rule_id: str) -> str:
    r = all_rules().get(rule_id)
    return r.severity if r else "P2"


def to_dict(f: StaticFinding) -> dict:
    d = asdict(f)
    d["severity"] = severity_for(f.rule_id)
    return d
