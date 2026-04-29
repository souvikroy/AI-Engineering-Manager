"""Jobs: enqueue review, list, get, findings, event-token."""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from typing import Optional

from reviewer.persistence.models import Finding, Job, Repo, session_maker
from reviewer.persistence.repository import audit, idempotency_key

from ..auth.dependencies import current_user_id
from ..auth.jwt_codec import mint_event_token
from ..security.rate_limit import check as rate_check

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/jobs", tags=["jobs"])
review_router = APIRouter(prefix="/api/repos", tags=["repos"])  # POST /api/repos/:id/reviews


class ReviewTriggerOut(BaseModel):
    job_id: str


class JobOut(BaseModel):
    id: str
    repo_id: Optional[str]
    repo_url: str
    target_ref: str
    head_sha: str
    status: str
    created_at: Optional[str]
    finished_at: Optional[str]
    intent: Optional[dict]
    plan: Optional[dict]


class FindingOut(BaseModel):
    id: str
    rule_id: str
    workflow: int
    severity: str
    file_path: str
    start_line: int
    end_line: int
    snippet: str
    rationale: str
    fix_suggestion: str
    confidence: float
    branch: str
    status: str
    static_corroborated: bool
    critic_outcome: str


def _job_dict(j: Job) -> JobOut:
    return JobOut(
        id=j.id, repo_id=j.repo_id, repo_url=j.repo_url,
        target_ref=j.target_ref, head_sha=j.head_sha, status=j.status,
        created_at=j.created_at.isoformat() if j.created_at else None,
        finished_at=j.finished_at.isoformat() if j.finished_at else None,
        intent=j.intent, plan=j.plan,
    )


@review_router.post("/{repo_id}/reviews", response_model=ReviewTriggerOut, status_code=202)
async def trigger_review(repo_id: str, background: BackgroundTasks,
                         uid: str = Depends(current_user_id)) -> ReviewTriggerOut:
    await rate_check(key=f"review_start:{uid}", capacity=10, window_seconds=3600)
    with session_maker()() as s:
        repo = s.get(Repo, repo_id)
        if repo is None or repo.user_id != uid or repo.archived_at is not None:
            raise HTTPException(status_code=404, detail="repo not found")
        # Re-use idempotency key shape: (url, branch). MVP: branch=default.
        key = idempotency_key(repo.url, "review")
        existing = s.scalar(select(Job).where(Job.idempotency_key.like(f"{key[:24]}%"), Job.user_id == uid, Job.status.in_(["queued", "running"])))
        if existing:
            return ReviewTriggerOut(job_id=existing.id)
        job = Job(
            user_id=uid,
            repo_id=repo.id,
            repo_url=repo.url,
            target_ref="",
            head_sha="",
            base_sha="",
            status="queued",
            idempotency_key=f"{key}-{repo.id}-{int(asyncio.get_event_loop().time()*1000)}",
        )
        s.add(job)
        s.commit()
        s.refresh(job)
        job_id = job.id
    audit(actor=uid, action="review_start", resource=job_id)

    # Fire the worker. In v1 we run in-process via BackgroundTasks; production switches to
    # an HTTP call to the worker tier (or QStash) — same code path, different invocation.
    from .worker_local import run_review_async
    background.add_task(run_review_async, job_id, uid, repo_id)
    return ReviewTriggerOut(job_id=job_id)


@router.get("", response_model=list[JobOut])
def list_jobs(uid: str = Depends(current_user_id), limit: int = 20) -> list[JobOut]:
    with session_maker()() as s:
        rows = list(s.scalars(
            select(Job).where(Job.user_id == uid).order_by(Job.created_at.desc()).limit(min(max(limit, 1), 100))
        ))
    return [_job_dict(j) for j in rows]


@router.get("/{job_id}", response_model=JobOut)
def get_job(job_id: str, uid: str = Depends(current_user_id)) -> JobOut:
    with session_maker()() as s:
        j = s.get(Job, job_id)
        if j is None or j.user_id != uid:
            raise HTTPException(status_code=404, detail="job not found")
        return _job_dict(j)


@router.post("/{job_id}/event-token")
def event_token(job_id: str, uid: str = Depends(current_user_id)) -> dict:
    with session_maker()() as s:
        j = s.get(Job, job_id)
        if j is None or j.user_id != uid:
            raise HTTPException(status_code=404, detail="job not found")
    return {"token": mint_event_token(user_id=uid, job_id=job_id, ttl_seconds=60)}


@router.get("/{job_id}/findings", response_model=list[FindingOut])
def list_findings(job_id: str, uid: str = Depends(current_user_id),
                  severity: Optional[str] = None, branch: Optional[str] = None) -> list[FindingOut]:
    with session_maker()() as s:
        j = s.get(Job, job_id)
        if j is None or j.user_id != uid:
            raise HTTPException(status_code=404, detail="job not found")
        q = select(Finding).where(Finding.job_id == job_id)
        if severity:
            q = q.where(Finding.severity == severity)
        if branch:
            q = q.where(Finding.branch == branch)
        rows = list(s.scalars(q.order_by(Finding.severity, Finding.rule_id, Finding.start_line)))
    return [
        FindingOut(
            id=f.id, rule_id=f.rule_id, workflow=f.workflow, severity=f.severity,
            file_path=f.file_path, start_line=f.start_line, end_line=f.end_line,
            snippet=f.snippet, rationale=f.rationale, fix_suggestion=f.fix_suggestion,
            confidence=float(f.confidence), branch=f.branch, status=f.status,
            static_corroborated=f.static_corroborated, critic_outcome=f.critic_outcome,
        )
        for f in rows
    ]
