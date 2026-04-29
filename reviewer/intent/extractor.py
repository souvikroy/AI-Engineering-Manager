"""Intent extractor — produces {goal, change_type, blast_radius, constraints, applicable_workflows, confidence}.

Composes evidence from branch name, commit subjects/bodies, README, file-path roots.
Heuristic-only path runs without an LLM (LLM enriches when available).
"""

from __future__ import annotations

import json
import re
from collections import Counter
from dataclasses import asdict, dataclass, field

from ..core.llm_router import LLMRouter
from ..ingest.git_extract import BranchDiff, IngestResult

CHANGE_TYPES = ["feat", "fix", "refactor", "perf", "sec", "chore", "migration", "infra", "exp", "docs", "test"]
BLAST_RADII = ["single-file", "module", "service", "cross-service", "public-api", "data"]


@dataclass
class IntentEvidence:
    source: str
    snippet: str


@dataclass
class IntentConstraint:
    kind: str
    detail: str


@dataclass
class Intent:
    goal: str = ""
    change_type: str = "feat"
    blast_radius: str = "module"
    constraints: list[IntentConstraint] = field(default_factory=list)
    evidence: list[IntentEvidence] = field(default_factory=list)
    applicable_workflows: list[int] = field(default_factory=list)
    confidence: float = 0.0
    uncertainty_reasons: list[str] = field(default_factory=list)

    def summary(self) -> str:
        kinds = ", ".join(c.kind for c in self.constraints) or "none"
        return f"{self.change_type}: {self.goal} [blast={self.blast_radius}; constraints={kinds}; conf={self.confidence:.2f}]"

    def to_json(self) -> dict:
        d = asdict(self)
        return d


def _heuristic_extract(diff: BranchDiff, ingest: IngestResult, readme: str = "") -> Intent:
    intent = Intent()
    branch = diff.branch
    subjects = [c.subject for c in diff.commits]
    bodies = [c.body for c in diff.commits]
    haystack = " ".join([branch] + subjects + bodies).lower()

    # change_type
    type_votes: Counter[str] = Counter()
    for ct in CHANGE_TYPES:
        if re.search(rf"\b{ct}\b", haystack):
            type_votes[ct] += 1
        if branch.lower().startswith(f"{ct}/") or branch.lower().startswith(f"{ct}-"):
            type_votes[ct] += 3
    for s in subjects:
        m = re.match(r"^(feat|fix|refactor|perf|sec|chore|migration|revert|docs|test|infra|exp)[\(\:]", s.lower())
        if m:
            type_votes[m.group(1)] += 2
    intent.change_type = type_votes.most_common(1)[0][0] if type_votes else "feat"

    # goal
    if subjects:
        intent.goal = subjects[0][:240]
    else:
        intent.goal = f"Changes on branch {branch}"

    # blast_radius
    paths = diff.files_changed
    n = len(paths)
    has_migration = any(re.search(r"migration|alembic|schema|\.sql$", p, re.I) for p in paths)
    has_api      = any(re.search(r"openapi|protobuf|\.proto$|graphql|api/", p, re.I) for p in paths)
    if has_migration:
        intent.blast_radius = "data"
    elif has_api:
        intent.blast_radius = "public-api"
    elif n > 30:
        intent.blast_radius = "cross-service"
    elif n > 5:
        intent.blast_radius = "service"
    elif n > 1:
        intent.blast_radius = "module"
    else:
        intent.blast_radius = "single-file"

    # constraints (very lightweight — LLM step expands these)
    if has_migration:
        intent.constraints.append(IntentConstraint("backward_compat", "Schema/data migration must remain backward compatible across one deploy."))
    if has_api:
        intent.constraints.append(IntentConstraint("backward_compat", "Public API surface change — versioning required for breaking changes."))
    if intent.change_type == "sec":
        intent.constraints.append(IntentConstraint("security_boundary", "Security-tagged change — auth/authz path must be reviewed."))
    if intent.change_type == "perf":
        intent.constraints.append(IntentConstraint("perf_budget", "Performance change must include a benchmark in the PR (R12.9)."))

    # evidence
    intent.evidence.append(IntentEvidence("branch_name", branch))
    if subjects:
        intent.evidence.append(IntentEvidence("commit_msg", subjects[0]))
    if has_migration:
        intent.evidence.append(IntentEvidence("file_path", next(p for p in paths if re.search(r"migration|\.sql$", p, re.I))))
    if readme:
        intent.evidence.append(IntentEvidence("readme", readme[:200].replace("\n", " ")))

    # applicable_workflows: all 21 workflows are eligible by default. The planner trims
    # by token budget; per-rule recursive RAG returns "no evidence" cheaply for irrelevant
    # rules. Conditional pruning was a coverage bug — entire workflows silently skipped.
    intent.applicable_workflows = list(range(1, 22))

    # confidence (heuristic stub)
    sources = {e.source for e in intent.evidence}
    diversity = len(sources) / 5.0
    consistency = 1.0 if intent.change_type and intent.change_type in (subjects[0].lower() if subjects else "") else 0.6
    self_report = 0.7  # default; LLM step overwrites
    classifier = 0.7 if type_votes else 0.4
    intent.confidence = round(min(1.0, 0.40 * diversity + 0.30 * consistency + 0.20 * self_report + 0.10 * classifier), 2)
    if intent.confidence < 0.5:
        intent.uncertainty_reasons.append("Sparse evidence; commit messages may not reflect actual change.")
    return intent


LLM_SYSTEM = """You read a synthesized PR (branch name + commit messages + file paths) and extract intent.
Return strict JSON with keys: goal, change_type, blast_radius, constraints (list of {kind, detail}), applicable_workflows (list of int 1..21), confidence (0..1), uncertainty_reasons (list).
change_type in: feat|fix|refactor|perf|sec|chore|migration|infra|exp|docs|test
blast_radius in: single-file|module|service|cross-service|public-api|data
Be terse and specific. The voice is an ex-Facebook engineering manager."""


async def enrich_with_llm(intent: Intent, diff: BranchDiff, router: LLMRouter, model: str) -> Intent:
    payload = {
        "branch": diff.branch,
        "commits": [{"subject": c.subject, "body": c.body[:500]} for c in diff.commits[:10]],
        "files_changed_sample": diff.files_changed[:30],
        "heuristic": intent.to_json(),
    }
    try:
        data = await router.complete_json(
            model=model,
            system=LLM_SYSTEM,
            user="Extract intent for this synthesized PR:\n\n" + json.dumps(payload, indent=2),
            temperature=0.0,
            max_tokens=700,
        )
    except Exception:
        return intent

    if data.get("goal"):
        intent.goal = str(data["goal"])[:240]
    if data.get("change_type") in CHANGE_TYPES:
        intent.change_type = data["change_type"]
    if data.get("blast_radius") in BLAST_RADII:
        intent.blast_radius = data["blast_radius"]
    if isinstance(data.get("constraints"), list):
        intent.constraints = [
            IntentConstraint(kind=str(c.get("kind", "other")), detail=str(c.get("detail", "")))
            for c in data["constraints"]
            if isinstance(c, dict)
        ] or intent.constraints
    if isinstance(data.get("applicable_workflows"), list):
        wfs = sorted({int(w) for w in data["applicable_workflows"] if isinstance(w, int) and 1 <= w <= 21})
        if wfs:
            intent.applicable_workflows = sorted(set(wfs) | set(intent.applicable_workflows))
    if isinstance(data.get("uncertainty_reasons"), list):
        intent.uncertainty_reasons = [str(x) for x in data["uncertainty_reasons"]][:5]

    # Recompute confidence with LLM self-report.
    self_report = float(data.get("confidence") or 0.7)
    diversity = len({e.source for e in intent.evidence}) / 5.0
    classifier = 0.8
    consistency = 0.8
    intent.confidence = round(min(1.0, 0.40 * diversity + 0.30 * consistency + 0.20 * self_report + 0.10 * classifier), 2)
    return intent


async def extract_intent(
    diff: BranchDiff,
    ingest: IngestResult,
    *,
    router: LLMRouter | None,
    model: str,
    readme: str = "",
) -> Intent:
    base = _heuristic_extract(diff, ingest, readme=readme)
    if router is None:
        return base
    return await enrich_with_llm(base, diff, router, model)
