"""End-to-end orchestrator: ingest -> static -> intent -> plan -> review -> verify -> report.

Synchronous for the MVP; LangGraph + Arq queue come in v1.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import asdict
from pathlib import Path
from typing import Any

from ..agents.base import AgentFinding, WorkflowAgent, from_static
from ..agents.critic import critique
from ..agents.verifier import final_confidence, self_consistency
from ..core.config import Settings, get_settings
from ..core.llm_router import LLMRouter
from ..index.store import BM25Store
from ..ingest.chunker import chunk_repo
from ..ingest.git_extract import BranchDiff, IngestResult, clone_repo
from ..ingest.github_pat import get_readme, parse_repo_url
from ..intent.extractor import Intent, extract_intent
from ..persistence.repository import (
    add_finding,
    add_run,
    audit,
    finish_run,
    update_job,
    upsert_job,
)
from ..planner.planner import Plan, make_plan
from ..report.render import render_json, render_markdown, write_report
from ..rules.registry import all_rules
from ..static.engine import run_static, severity_for

log = logging.getLogger(__name__)


async def review_repo(
    repo_url: str,
    *,
    out_dir: Path,
    branch: str | None = None,
    settings: Settings | None = None,
) -> dict[str, Any]:
    s = settings or get_settings()
    audit("cli", "review_start", repo_url, repo_url.encode())

    log.info("ingest: cloning %s", repo_url)
    ingest = clone_repo(repo_url)
    log.info("ingest: default=%s branches=%d files=%d", ingest.default_branch, len(ingest.branches), len(ingest.file_tree))

    job = upsert_job(repo_url=repo_url, head_sha=ingest.head_sha, target_ref=branch or ingest.default_branch)
    update_job(job.id, status="ingesting")

    # Decide which branches to review. Per-branch diff vs default; no branch arg → review every branch (capped).
    diffs: list[BranchDiff] = []
    if branch and branch != ingest.default_branch:
        diffs = [d for d in ingest.branch_diffs if d.branch == branch]
        if not diffs:
            log.warning("requested branch %s not found in branch_diffs; falling back to all", branch)
    if not diffs:
        diffs = ingest.branch_diffs

    if not diffs:
        # Whole-repo audit fallback when only the default branch exists.
        diffs = [_synthetic_default_diff(ingest)]

    # Index code once (whole tree) — re-used across branches for the MVP.
    log.info("indexing repo (BM25)")
    chunks = chunk_repo(ingest.checkout_dir)
    store = BM25Store()
    store.index(chunks)
    log.info("index stats: %s", store.stats())

    router: LLMRouter | None = None
    if s.llm_enabled:
        router = LLMRouter(s)

    all_findings: list[AgentFinding] = []
    intent_dump: dict[str, Any] = {}
    plan_dump: dict[str, Any] = {}

    try:
        for diff in diffs:
            log.info("=== branch: %s (head=%s) ===", diff.branch, diff.head_sha[:10])
            audit("orchestrator", "branch_start", f"{repo_url}:{diff.branch}", b"")

            # Static pass.
            static_findings = run_static(ingest.checkout_dir, diff)
            for sf in static_findings:
                af = from_static(sf)
                af.branches = [diff.branch]
                all_findings.append(af)
                add_finding(
                    job_id=job.id,
                    rule_id=af.rule_id,
                    workflow=af.workflow,
                    severity=af.severity,
                    file_path=af.file_path,
                    start_line=af.start_line,
                    end_line=af.end_line,
                    snippet=af.snippet,
                    rationale=af.rationale,
                    fix_suggestion=af.fix_suggestion,
                    confidence=af.confidence,
                    evidence={"static": True},
                    static_corroborated=True,
                    branch=diff.branch,
                )

            # Appendix-D: secret found → reject outright, do not run deep review on this branch.
            if any(f.rule_id == "R2.6" for f in static_findings):
                log.warning("R2.6 secret found on %s; skipping deep review", diff.branch)
                continue

            # Intent.
            readme = get_readme(parse_repo_url(repo_url)) if s.github_authed else ""
            intent: Intent = await extract_intent(diff, ingest, router=router, model=s.model_light, readme=readme)
            intent_dump = intent.to_json()
            update_job(job.id, intent=intent_dump)

            # Plan.
            plan: Plan = make_plan(intent, total_token_budget=s.budget_tokens)
            plan_dump = plan.to_dict()
            update_job(job.id, plan=plan_dump, status="reviewing")

            if router is None:
                log.info("OPENROUTER_API_KEY missing — skipping LLM workflows for branch %s", diff.branch)
                continue

            # LLM workflow agents.
            for node in plan.nodes:
                if node.agent == "static":
                    continue
                model = s.model_heavy if node.agent == "llm_heavy" else s.model_light
                run_id = add_run(job.id, node.workflow, agent=node.agent, model=model)
                agent = WorkflowAgent(workflow=node.workflow, model=model, router=router, store=store)
                try:
                    found = await agent.run(intent_summary=intent.summary(), budget_tokens=node.budget_tokens)
                except Exception as e:  # noqa: BLE001
                    log.error("WF%d agent crashed: %s", node.workflow, e)
                    finish_run(run_id, status="failed", error=str(e))
                    continue

                # Verify P0/P1 with self-consistency, then critic.
                verified: list[AgentFinding] = []
                for f in found:
                    f = await self_consistency(f, router=router, store=store, intent_summary=intent.summary(), model=model)
                    if f.severity in {"P0", "P1"}:
                        f = await critique(f, router=router, model=s.model_critic)
                    f.confidence = final_confidence(f)
                    verified.append(f)

                for f in verified:
                    f.branches = [diff.branch]
                    add_finding(
                        job_id=job.id,
                        rule_id=f.rule_id,
                        workflow=f.workflow,
                        severity=f.severity,
                        file_path=f.file_path,
                        start_line=f.start_line,
                        end_line=f.end_line,
                        snippet=f.snippet,
                        rationale=f.rationale,
                        fix_suggestion=f.fix_suggestion,
                        confidence=f.confidence,
                        evidence={"chunks": f.evidence_chunks, "rag_hops": f.rag_hops},
                        static_corroborated=f.static_corroborated,
                        critic_outcome=f.critic_outcome,
                        branch=diff.branch,
                    )
                    all_findings.append(f)
                finish_run(run_id, status="done")
    finally:
        if router is not None:
            await router.aclose()

    cost_usd = router.spent_usd if router is not None else 0.0
    tokens = router.spent_tokens if router is not None else 0

    # Use the last branch's intent/plan for the report header (MVP simplification).
    payload = render_json(
        repo_url=repo_url,
        head_sha=ingest.head_sha,
        branch=branch or ingest.default_branch,
        intent=Intent(**{k: v for k, v in intent_dump.items() if k in Intent.__dataclass_fields__}) if intent_dump else Intent(),
        plan=_plan_from_dump(plan_dump),
        findings=all_findings,
        cost_usd=cost_usd,
        tokens=tokens,
    )
    md = render_markdown(
        repo_url=repo_url,
        head_sha=ingest.head_sha,
        branch=branch or ingest.default_branch,
        intent=Intent(**{k: v for k, v in intent_dump.items() if k in Intent.__dataclass_fields__}) if intent_dump else Intent(),
        plan=_plan_from_dump(plan_dump),
        findings=all_findings,
        cost_usd=cost_usd,
        tokens=tokens,
    )
    md_path, json_path = write_report(out_dir, payload, md)
    update_job(job.id, status="done")
    audit("orchestrator", "review_done", repo_url, b"")

    return {
        "job_id": job.id,
        "report_md": str(md_path),
        "findings_json": str(json_path),
        "exit_code": payload["exit_code"],
        "totals": payload["totals"],
    }


def _synthetic_default_diff(ingest: IngestResult) -> BranchDiff:
    """When the only branch is the default, treat the whole repo as one virtual PR."""
    return BranchDiff(
        branch=ingest.default_branch,
        head_sha=ingest.head_sha,
        base_sha="",
        files_changed=ingest.file_tree,
        additions=0,
        deletions=0,
        net_changed=0,
        unified_diff="",
        commits=[],
    )


def _plan_from_dump(d: dict) -> Plan:
    from ..planner.planner import PlanNode
    if not d:
        return Plan(nodes=[], skipped=[], abort_on=[])
    return Plan(
        nodes=[PlanNode(**n) for n in d.get("nodes", [])],
        skipped=d.get("skip", []),
        abort_on=d.get("abort_on", []),
    )


def run_review(repo_url: str, *, out_dir: Path, branch: str | None = None) -> dict[str, Any]:
    """Sync wrapper for CLI."""
    return asyncio.run(review_repo(repo_url, out_dir=out_dir, branch=branch))
