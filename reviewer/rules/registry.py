"""Rule registry: parses CODE_REVIEW_RULESET.md once at import time and merges with rules_meta.yaml.

Rule text stays sourced from the markdown so the registry can never drift from the spec.
Classification (static/llm/hybrid) and default severity (P0..P3) come from the YAML overlay.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import yaml

RULE_LINE_RE = re.compile(r"^- \*\*(R\d+\.\d+)\*\* (.+)$")
WORKFLOW_HEADING_RE = re.compile(r"^## Workflow (\d+) — (.+)$")

REPO_ROOT = Path(__file__).resolve().parents[2]
RULESET_PATH = REPO_ROOT / "CODE_REVIEW_RULESET.md"
META_PATH = Path(__file__).with_name("rules_meta.yaml")


@dataclass(frozen=True)
class Rule:
    id: str                    # e.g. "R8.4"
    workflow: int              # 1..21
    workflow_title: str
    text: str                  # full rule text from the markdown
    kind: str                  # "static" | "llm" | "hybrid"
    severity: str              # "P0" | "P1" | "P2" | "P3"
    enforcement: str           # "MUST" | "MUST NOT" | "SHOULD" | "MAY"
    static_runner: str | None  # name of the static analyzer module, if any


def _detect_enforcement(text: str) -> str:
    upper = text.upper()
    if "MUST NOT" in upper:
        return "MUST NOT"
    if "MUST" in upper:
        return "MUST"
    if "SHOULD" in upper:
        return "SHOULD"
    return "MAY"


@lru_cache(maxsize=1)
def _parse_ruleset() -> dict[str, tuple[int, str, str]]:
    """Return {rule_id: (workflow_num, workflow_title, text)} parsed from the markdown."""
    if not RULESET_PATH.exists():
        return {}

    text = RULESET_PATH.read_text(encoding="utf-8")
    out: dict[str, tuple[int, str, str]] = {}
    current_wf = 0
    current_title = ""

    for line in text.splitlines():
        wf = WORKFLOW_HEADING_RE.match(line)
        if wf:
            current_wf = int(wf.group(1))
            current_title = wf.group(2).strip()
            continue

        m = RULE_LINE_RE.match(line)
        if m and current_wf:
            rid = m.group(1)
            body = m.group(2).strip()
            out[rid] = (current_wf, current_title, body)

    return out


@lru_cache(maxsize=1)
def _load_meta() -> dict[str, dict]:
    if not META_PATH.exists():
        return {}
    return yaml.safe_load(META_PATH.read_text(encoding="utf-8")) or {}


@lru_cache(maxsize=1)
def all_rules() -> dict[str, Rule]:
    rules: dict[str, Rule] = {}
    parsed = _parse_ruleset()
    meta = _load_meta()
    default_kind = meta.get("_defaults", {}).get("kind", "llm")
    default_severity = meta.get("_defaults", {}).get("severity", "P2")

    for rid, (wf, title, body) in parsed.items():
        m = meta.get(rid, {})
        rules[rid] = Rule(
            id=rid,
            workflow=wf,
            workflow_title=title,
            text=body,
            kind=m.get("kind", default_kind),
            severity=m.get("severity", default_severity),
            enforcement=_detect_enforcement(body),
            static_runner=m.get("runner"),
        )
    return rules


def rules_for_workflow(wf: int) -> list[Rule]:
    return [r for r in all_rules().values() if r.workflow == wf]


def rules_by_kind(kind: str) -> list[Rule]:
    return [r for r in all_rules().values() if r.kind == kind]
