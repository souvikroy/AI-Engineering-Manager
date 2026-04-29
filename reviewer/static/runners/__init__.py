"""Static analyzers. Each returns an iterable of `StaticFinding` records.

Runners are pure: given a working tree path + a BranchDiff, they emit findings.
No LLM calls. No network. Deterministic.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Callable

from ...ingest.git_extract import BranchDiff


@dataclass
class StaticFinding:
    rule_id: str
    file_path: str
    start_line: int
    end_line: int
    snippet: str
    rationale: str
    fix_suggestion: str = ""
    confidence: float = 0.95


# Each runner: (workdir, diff) -> iterable[StaticFinding]
RunnerFn = Callable[..., Iterable[StaticFinding]]

_REGISTRY: dict[str, RunnerFn] = {}


def register(name: str):
    def deco(fn: RunnerFn) -> RunnerFn:
        _REGISTRY[name] = fn
        return fn
    return deco


def get_runner(name: str) -> RunnerFn | None:
    return _REGISTRY.get(name)


def all_runners() -> dict[str, RunnerFn]:
    return dict(_REGISTRY)


# Import side-effect: each module registers itself.
from . import (  # noqa: E402,F401
    diff_size,
    file_length,
    function_length,
    index_concurrently,
    pr_description,
    pr_title,
    secret_scan,
    sql_concat,
    todo_scan,
    hybrid_workflows,
    wf01_context,
    wf02_hygiene,
    wf09_data,
    wf10_api,
    wf11_frontend,
    wf15_maintainability,
    wf18_dependencies,
)
