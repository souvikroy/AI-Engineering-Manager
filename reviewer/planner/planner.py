"""Planner: synthesize a DAG of review tasks with per-node token budgets.

Heuristic for MVP — predictable and inexpensive. The plan respects:
  1. WF 2 hygiene first (Appendix D reject-outright gate).
  2. WF 1 + 3 context next.
  3. Substantive workflows (4/5/6/7/8/9/10/12/13) fan out.
  4. Horizontal sweeps (14/15/16) over the union of touched code.
  5. Tail (17/19/20/21) — deployment, docs, comment self-check, approval verdict.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

from ..intent.extractor import Intent
from ..rules.registry import all_rules

ALWAYS_ON = set(range(1, 22))  # all 21 workflows are always eligible; planner trims by budget.

GATE_FIRST = [2]
CONTEXT_NEXT = [1, 3]
SUBSTANTIVE = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 18]
HORIZONTAL = [14, 15, 16]
TAIL = [17, 19, 20, 21]


@dataclass
class PlanNode:
    id: str
    workflow: int
    rules: list[str]
    agent: str            # "static" | "llm_light" | "llm_heavy"
    depends_on: list[str] = field(default_factory=list)
    budget_tokens: int = 0


@dataclass
class Plan:
    nodes: list[PlanNode]
    skipped: list[dict]
    abort_on: list[str]

    def to_dict(self) -> dict:
        return {
            "nodes": [asdict(n) for n in self.nodes],
            "skip": self.skipped,
            "abort_on": self.abort_on,
        }


def _agent_for(wf: int) -> str:
    # Heavy reasoning workflows.
    if wf in {4, 5, 6, 8, 9, 10, 12, 13}:
        return "llm_heavy"
    return "llm_light"


def _all_static(wf: int) -> bool:
    rules = [r for r in all_rules().values() if r.workflow == wf]
    return bool(rules) and all(r.kind == "static" for r in rules)


def make_plan(intent: Intent, *, total_token_budget: int) -> Plan:
    applicable = set(intent.applicable_workflows) | ALWAYS_ON
    skipped: list[dict] = []
    nodes: list[PlanNode] = []

    static_overhead = 0
    verifier_reserve = int(total_token_budget * 0.15)
    spendable = max(0, total_token_budget - static_overhead - verifier_reserve)

    # Score: rules × file scope (we don't know per-WF file scope yet, so flat for now).
    weights: dict[int, float] = {}
    for wf in (GATE_FIRST + CONTEXT_NEXT + SUBSTANTIVE + HORIZONTAL + TAIL):
        if wf not in applicable:
            skipped.append({"workflow": wf, "reason": "not applicable for this intent"})
            continue
        rule_count = len([r for r in all_rules().values() if r.workflow == wf])
        weights[wf] = rule_count * (3 if wf in {8, 9, 6} else 2 if wf in SUBSTANTIVE else 1)

    total_weight = sum(weights.values()) or 1.0

    def add(wf: int, depends_on: list[str]) -> str:
        nid = f"wf{wf:02d}"
        rule_ids = [r.id for r in all_rules().values() if r.workflow == wf]
        if not rule_ids:
            return ""
        agent = "static" if _all_static(wf) else _agent_for(wf)
        budget = 0 if agent == "static" else int(spendable * (weights.get(wf, 0) / total_weight))
        nodes.append(PlanNode(
            id=nid, workflow=wf, rules=rule_ids,
            agent=agent, depends_on=depends_on, budget_tokens=budget,
        ))
        return nid

    # Ordered with dependencies.
    prev_ids: list[str] = []
    for wf in GATE_FIRST:
        nid = add(wf, [])
        if nid:
            prev_ids = [nid]

    for wf in CONTEXT_NEXT:
        if wf in applicable:
            add(wf, prev_ids)

    for wf in SUBSTANTIVE:
        if wf in applicable:
            add(wf, prev_ids)

    for wf in HORIZONTAL:
        if wf in applicable:
            add(wf, prev_ids)

    for wf in TAIL:
        if wf in applicable:
            # Tail depends on horizontal (so e.g. WF 21 sees the rest).
            tail_deps = [n.id for n in nodes if n.workflow in HORIZONTAL] or prev_ids
            add(wf, tail_deps)

    # WF 11 (frontend) only if intent included it.
    if 11 in applicable:
        add(11, prev_ids)
    if 18 in applicable:
        add(18, prev_ids)

    abort_on = ["wf02_R2.6_secret"]
    return Plan(nodes=nodes, skipped=skipped, abort_on=abort_on)
