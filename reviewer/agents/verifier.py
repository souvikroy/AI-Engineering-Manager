"""Self-consistency verifier for P0/P1 findings + final confidence scoring."""

from __future__ import annotations

import logging

from ..core.llm_router import LLMRouter
from ..index.store import BM25Store
from ..rag.recursive import assess_rule
from ..rules.registry import Rule, all_rules
from .base import AgentFinding

log = logging.getLogger(__name__)


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def final_confidence(f: AgentFinding) -> float:
    retrieval = _clamp01(f.retrieval_score / 10.0)
    self_report = _clamp01(f.confidence)
    ensemble = _clamp01(getattr(f, "_ensemble_agreement", self_report))
    static_agree = 1.0 if f.static_corroborated else 0.5
    critic = {"survived": 1.0, "downgraded": 0.5, "killed": 0.0, "not_run": 0.5}.get(f.critic_outcome, 0.5)
    return round(_clamp01(0.30 * retrieval + 0.25 * self_report + 0.20 * ensemble + 0.15 * static_agree + 0.10 * critic), 2)


def _downgrade(sev: str) -> str:
    return {"P0": "P1", "P1": "P2", "P2": "P3", "P3": "P3"}.get(sev, sev)


async def self_consistency(
    finding: AgentFinding,
    *,
    router: LLMRouter,
    store: BM25Store,
    intent_summary: str,
    model: str,
    samples: int = 2,
) -> AgentFinding:
    """Re-run the rule check at slightly higher temperature; downgrade on disagreement."""
    if finding.severity not in {"P0", "P1"}:
        return finding
    rule: Rule | None = all_rules().get(finding.rule_id)
    if rule is None or rule.kind == "static":
        return finding

    agreements = 1  # the original agent agreed
    total = 1
    for _ in range(samples):
        try:
            j = await assess_rule(
                router=router,
                store=store,
                rule=rule,
                intent_summary=intent_summary,
                model=model,
                rule_token_budget=1500,
            )
        except Exception as e:  # noqa: BLE001
            log.warning("self-consistency failed for %s: %s", finding.rule_id, e)
            continue
        total += 1
        if j.violated and j.file_path == finding.file_path:
            agreements += 1

    ratio = agreements / max(total, 1)
    finding.__dict__["_ensemble_agreement"] = ratio
    if ratio < 0.66:
        finding.severity = _downgrade(finding.severity)
    return finding
