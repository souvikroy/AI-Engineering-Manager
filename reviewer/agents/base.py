"""Base reviewer agent: runs a workflow's LLM/hybrid rules through the recursive RAG loop."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from ..core.llm_router import LLMRouter
from ..index.store import BM25Store
from ..rag.recursive import RagJudgment, assess_rule
from ..rules.registry import Rule, all_rules
from ..static.runners import StaticFinding

log = logging.getLogger(__name__)


@dataclass
class AgentFinding:
    rule_id: str
    workflow: int
    severity: str
    file_path: str = ""
    start_line: int = 0
    end_line: int = 0
    snippet: str = ""
    rationale: str = ""
    fix_suggestion: str = ""
    confidence: float = 0.5
    static_corroborated: bool = False
    critic_outcome: str = "not_run"
    evidence_chunks: list[str] = field(default_factory=list)
    rag_hops: int = 0
    retrieval_score: float = 0.0
    branches: list[str] = field(default_factory=list)


def from_static(sf: StaticFinding) -> AgentFinding:
    rule = all_rules().get(sf.rule_id)
    return AgentFinding(
        rule_id=sf.rule_id,
        workflow=rule.workflow if rule else 0,
        severity=rule.severity if rule else "P2",
        file_path=sf.file_path,
        start_line=sf.start_line,
        end_line=sf.end_line,
        snippet=sf.snippet,
        rationale=sf.rationale,
        fix_suggestion=sf.fix_suggestion,
        confidence=sf.confidence,
        static_corroborated=True,
    )


def from_judgment(j: RagJudgment, rule: Rule) -> AgentFinding:
    return AgentFinding(
        rule_id=rule.id,
        workflow=rule.workflow,
        severity=rule.severity,
        file_path=j.file_path,
        start_line=j.start_line,
        end_line=j.end_line,
        snippet=j.snippet,
        rationale=j.rationale,
        fix_suggestion=j.fix_suggestion,
        confidence=j.confidence,
        evidence_chunks=[f"{c.path}:{c.start_line}-{c.end_line}" for c in j.evidence],
        rag_hops=j.hops,
        retrieval_score=j.retrieval_score,
    )


class WorkflowAgent:
    """One agent per workflow. Batches rule checks and writes findings."""

    def __init__(self, *, workflow: int, model: str, router: LLMRouter, store: BM25Store) -> None:
        self.workflow = workflow
        self.model = model
        self.router = router
        self.store = store

    async def run(self, *, intent_summary: str, budget_tokens: int) -> list[AgentFinding]:
        rules = [r for r in all_rules().values() if r.workflow == self.workflow]
        # Skip pure-static rules — engine.run_static handles those.
        rules = [r for r in rules if r.kind != "static"]
        if not rules:
            return []

        per_rule = max(800, budget_tokens // max(1, len(rules)))
        out: list[AgentFinding] = []
        for rule in rules:
            try:
                judgment = await assess_rule(
                    router=self.router,
                    store=self.store,
                    rule=rule,
                    intent_summary=intent_summary,
                    model=self.model,
                    rule_token_budget=per_rule,
                )
            except Exception as e:  # noqa: BLE001
                log.warning("WF%d rule %s failed: %s", self.workflow, rule.id, e)
                continue
            if judgment.violated and judgment.confidence >= 0.5:
                out.append(from_judgment(judgment, rule))
        return out
