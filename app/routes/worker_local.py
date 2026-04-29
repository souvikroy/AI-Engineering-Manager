"""In-process worker — runs a review job from inside the FastAPI process.

In production this is split into a separate Render service consuming a QStash queue.
For dev / single-instance deploys, asyncio background tasks are sufficient.
"""

from __future__ import annotations

import asyncio
import logging
import tempfile
from pathlib import Path
from typing import Any, Optional, Union

from sqlalchemy import select

from reviewer.agents.base import AgentFinding, WorkflowAgent, from_static
from reviewer.agents.critic import critique
from reviewer.agents.verifier import final_confidence, self_consistency
from reviewer.core.config import get_settings
from reviewer.core.llm_router import LLMRouter
from reviewer.index.pinecone_store import PineconeStore
from reviewer.index.store import BM25Store
from reviewer.ingest.chunker import chunk_repo
from reviewer.ingest.git_extract import BranchDiff, IngestResult, clone_repo
from reviewer.intent.extractor import Intent, extract_intent
from reviewer.persistence.models import Job, Repo, session_maker
from reviewer.persistence.repository import (
    add_finding,
    add_run,
    audit,
    finish_run,
    update_job,
)
from reviewer.planner.planner import Plan, make_plan
from reviewer.static.engine import run_static

from ..events.bus import emit_event_sync
from ..security.fernet_box import decrypt as fernet_decrypt

log = logging.getLogger(__name__)


def _emit(job_id: str, user_id: str, **kwargs: Any) -> int:
    return emit_event_sync(job_id=job_id, user_id=user_id, **kwargs)


JOB_WALL_CLOCK_SECONDS = 30 * 60  # 30 minutes — anything longer is a stuck worker, not real work.


async def run_review_async(job_id: str, user_id: str, repo_id: str) -> None:
    """Background task entry. Drives the orchestrator and emits live events.

    Hard-bounded by JOB_WALL_CLOCK_SECONDS — if the orchestrator gets stuck
    (e.g. a third-party API in a retry loop), we stop burning budget instead of
    letting a single job dominate the event loop forever.
    """
    try:
        await asyncio.wait_for(
            _run_review(job_id, user_id, repo_id),
            timeout=JOB_WALL_CLOCK_SECONDS,
        )
    except asyncio.TimeoutError:
        log.error("review job %s exceeded %ds wall clock; marking failed", job_id, JOB_WALL_CLOCK_SECONDS)
        update_job(job_id, status="failed")
        _emit(job_id, user_id, stage="error",
              message=f"review timed out after {JOB_WALL_CLOCK_SECONDS}s (watchdog)")
    except Exception as e:  # noqa: BLE001
        log.exception("review failed: %s", e)
        update_job(job_id, status="failed")
        _emit(job_id, user_id, stage="error", message=str(e))


async def _run_review(job_id: str, user_id: str, repo_id: str) -> None:
    s = get_settings()
    update_job(job_id, status="running")
    _emit(job_id, user_id, stage="queued", message="picked up by worker")

    # Decrypt PAT (worker-only memory window).
    with session_maker()() as session:
        repo = session.get(Repo, repo_id)
        if repo is None or repo.user_id != user_id:
            raise RuntimeError("repo not accessible")
        repo_url = repo.url
        pat = fernet_decrypt(repo.pat_ciphertext) if repo.pat_ciphertext else None
        namespace = repo.pinecone_namespace
    audit(actor=user_id, action="pat_use", resource=repo_id)

    _emit(job_id, user_id, stage="ingest", message=f"cloning {repo_url}")
    # Honor the user's PAT for clone by setting GITHUB_TOKEN in this thread's env.
    import os
    prev_token = os.environ.get("GITHUB_TOKEN")
    if pat:
        os.environ["GITHUB_TOKEN"] = pat
    try:
        ingest = await asyncio.to_thread(clone_repo, repo_url)
    finally:
        if prev_token is None:
            os.environ.pop("GITHUB_TOKEN", None)
        else:
            os.environ["GITHUB_TOKEN"] = prev_token
        # zero out PAT from memory ASAP
        if pat:
            del pat
    update_job(job_id, head_sha=ingest.head_sha, target_ref=ingest.default_branch)
    _emit(job_id, user_id, stage="ingest", message=f"branches={len(ingest.branches)} files={len(ingest.file_tree)}",
          data={"branches": ingest.branches, "default": ingest.default_branch, "files": len(ingest.file_tree)})

    # Indexing.
    _emit(job_id, user_id, stage="index", message="chunking and indexing")
    chunks = await asyncio.to_thread(chunk_repo, ingest.checkout_dir)
    if s.vector_backend == "pinecone" and s.pinecone_api_key:
        # Per-repo index: ensures dim/quota/blast-radius isolation between repos.
        store: Union[BM25Store, PineconeStore] = PineconeStore(repo_id=repo_id)
    else:
        store = BM25Store()
    await asyncio.to_thread(store.index, chunks)
    _emit(job_id, user_id, stage="index", message="ready", data={"stats": store.stats()})

    # Synthesize diffs.
    diffs: list[BranchDiff] = ingest.branch_diffs or [_synthetic_default_diff(ingest)]

    router: Optional[LLMRouter] = LLMRouter(s) if s.llm_enabled else None
    all_findings: list[AgentFinding] = []
    intent_dump: dict[str, Any] = {}
    plan_dump: dict[str, Any] = {}

    try:
        for diff in diffs:
            _emit(job_id, user_id, stage="branch_start", message=f"branch {diff.branch}",
                  data={"branch": diff.branch, "head_sha": diff.head_sha})

            # Static.
            _emit(job_id, user_id, stage="static", message=f"running static rules on {diff.branch}")
            static_findings = await asyncio.to_thread(run_static, ingest.checkout_dir, diff)
            for sf in static_findings:
                af = from_static(sf)
                af.branches = [diff.branch]
                add_finding(
                    job_id=job_id, user_id=user_id, rule_id=af.rule_id, workflow=af.workflow,
                    severity=af.severity, file_path=af.file_path, start_line=af.start_line,
                    end_line=af.end_line, snippet=af.snippet, rationale=af.rationale,
                    fix_suggestion=af.fix_suggestion, confidence=af.confidence,
                    evidence={"static": True}, static_corroborated=True, branch=diff.branch,
                )
                _emit(job_id, user_id, stage="finding", workflow=af.workflow,
                      data={"rule_id": af.rule_id, "severity": af.severity, "file_path": af.file_path,
                            "start_line": af.start_line, "branch": diff.branch})
                all_findings.append(af)

            # Reject-outright on R2.6 secret.
            if any(f.rule_id == "R2.6" for f in static_findings):
                _emit(job_id, user_id, stage="warning",
                      message=f"R2.6 secret on {diff.branch}; skipping deep review")
                continue

            # Intent.
            _emit(job_id, user_id, stage="intent")
            intent: Intent = await extract_intent(diff, ingest, router=router, model=s.model_light)
            intent_dump = intent.to_json()
            update_job(job_id, intent=intent_dump)
            _emit(job_id, user_id, stage="intent", message=intent.summary(), data=intent_dump)

            # Plan.
            _emit(job_id, user_id, stage="plan")
            plan: Plan = make_plan(intent, total_token_budget=s.budget_tokens)
            plan_dump = plan.to_dict()
            update_job(job_id, plan=plan_dump)
            _emit(job_id, user_id, stage="plan", message=f"{len(plan.nodes)} workflow node(s)")

            if router is None:
                _emit(job_id, user_id, stage="warning",
                      message="OPENROUTER_API_KEY missing; skipping LLM workflows")
                continue

            for node in plan.nodes:
                if node.agent == "static":
                    continue
                model = s.model_heavy if node.agent == "llm_heavy" else s.model_light
                _emit(job_id, user_id, stage="wf", workflow=node.workflow,
                      message=f"workflow {node.workflow}", data={"agent": node.agent, "model": model})
                run_id = add_run(job_id, node.workflow, agent=node.agent, model=model)
                agent = WorkflowAgent(workflow=node.workflow, model=model, router=router, store=store)
                try:
                    found = await agent.run(intent_summary=intent.summary(), budget_tokens=node.budget_tokens)
                except Exception as e:  # noqa: BLE001
                    log.warning("WF%d crashed: %s", node.workflow, e)
                    finish_run(run_id, status="failed", error=str(e))
                    _emit(job_id, user_id, stage="error", workflow=node.workflow, message=str(e))
                    continue

                # Verifier.
                verified: list[AgentFinding] = []
                for f in found:
                    f = await self_consistency(f, router=router, store=store,
                                               intent_summary=intent.summary(), model=model)
                    if f.severity in {"P0", "P1"}:
                        f = await critique(f, router=router, model=s.model_critic)
                    f.confidence = final_confidence(f)
                    verified.append(f)

                for f in verified:
                    f.branches = [diff.branch]
                    add_finding(
                        job_id=job_id, user_id=user_id, rule_id=f.rule_id, workflow=f.workflow,
                        severity=f.severity, file_path=f.file_path, start_line=f.start_line,
                        end_line=f.end_line, snippet=f.snippet, rationale=f.rationale,
                        fix_suggestion=f.fix_suggestion, confidence=f.confidence,
                        evidence={"chunks": f.evidence_chunks, "rag_hops": f.rag_hops},
                        static_corroborated=f.static_corroborated, critic_outcome=f.critic_outcome,
                        branch=diff.branch,
                    )
                    _emit(job_id, user_id, stage="finding", workflow=f.workflow,
                          data={"rule_id": f.rule_id, "severity": f.severity,
                                "file_path": f.file_path, "start_line": f.start_line,
                                "branch": diff.branch, "confidence": f.confidence})
                    all_findings.append(f)

                finish_run(run_id, status="done")
                _emit(job_id, user_id, stage="wf_done", workflow=node.workflow,
                      data={"findings": len(verified)})

    finally:
        if router is not None:
            await router.aclose()

    update_job(job_id, status="done")
    sev_count = {sev: sum(1 for f in all_findings if f.severity == sev) for sev in ("P0", "P1", "P2", "P3")}
    _emit(job_id, user_id, stage="done", message="review complete",
          data={"by_severity": sev_count, "total": len(all_findings)})

    # Auto-create Jira-style tickets for actionable findings (P0/P1/P2). Failure here
    # must not fail the review — the review itself succeeded.
    try:
        from ..tickets.creator import create_tickets_for_job
        tickets = await create_tickets_for_job(job_id=job_id, user_id=user_id, repo_id=repo_id)
        _emit(job_id, user_id, stage="tickets_created", data={"count": len(tickets)})
    except Exception as e:  # noqa: BLE001
        log.exception("ticket creation failed for job %s: %s", job_id, e)


def _synthetic_default_diff(ingest: IngestResult) -> BranchDiff:
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
