"""Typed data-access layer wrapping the SQLAlchemy models."""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import and_, or_, select

from .models import AuditLog, CostLedger, Finding, Job, Repo, Run, Ticket, session_maker


def idempotency_key(repo_url: str, head_sha: str) -> str:
    return hashlib.sha256(f"{repo_url}@{head_sha}".encode()).hexdigest()[:32]


def upsert_job(repo_url: str, head_sha: str, target_ref: str, base_sha: str = "") -> Job:
    key = idempotency_key(repo_url, head_sha or target_ref)
    with session_maker()() as s:
        existing = s.scalar(select(Job).where(Job.idempotency_key == key))
        if existing:
            return existing
        job = Job(
            repo_url=repo_url,
            target_ref=target_ref,
            head_sha=head_sha,
            base_sha=base_sha,
            idempotency_key=key,
            status="queued",
        )
        s.add(job)
        s.commit()
        s.refresh(job)
        return job


def update_job(job_id: str, **fields: Any) -> None:
    with session_maker()() as s:
        job = s.get(Job, job_id)
        if job is None:
            return
        for k, v in fields.items():
            setattr(job, k, v)
        if fields.get("status") in {"done", "failed"} and job.finished_at is None:
            job.finished_at = datetime.now(timezone.utc)
        s.commit()


def get_job(job_id: str) -> Job | None:
    with session_maker()() as s:
        return s.get(Job, job_id)


def add_finding(**fields: Any) -> str:
    with session_maker()() as s:
        f = Finding(**fields)
        s.add(f)
        s.commit()
        s.refresh(f)
        return f.id


def list_findings(job_id: str) -> list[Finding]:
    with session_maker()() as s:
        return list(s.scalars(select(Finding).where(Finding.job_id == job_id)))


def add_run(job_id: str, workflow: int, agent: str, model: str = "") -> str:
    with session_maker()() as s:
        r = Run(job_id=job_id, workflow=workflow, agent=agent, model=model)
        s.add(r)
        s.commit()
        s.refresh(r)
        return r.id


def finish_run(run_id: str, *, status: str = "done", tokens_in: int = 0, tokens_out: int = 0,
               usd: float = 0.0, error: str | None = None) -> None:
    with session_maker()() as s:
        r = s.get(Run, run_id)
        if r is None:
            return
        r.status = status
        r.tokens_in = tokens_in
        r.tokens_out = tokens_out
        r.usd = usd
        r.error = error
        r.ended_at = datetime.now(timezone.utc)
        s.commit()


def add_cost(*, job_id: str | None, run_id: str | None, model: str,
             prompt_tokens: int, completion_tokens: int, usd: float) -> None:
    with session_maker()() as s:
        s.add(CostLedger(
            job_id=job_id, run_id=run_id, model=model,
            prompt_tokens=prompt_tokens, completion_tokens=completion_tokens, usd=usd,
        ))
        s.commit()


def audit(actor: str, action: str, resource: str, payload: bytes = b"") -> None:
    digest = hashlib.sha256(payload).hexdigest() if payload else ""
    with session_maker()() as s:
        s.add(AuditLog(actor=actor, action=action, resource=resource, payload_hash=digest))
        s.commit()


# ---- Tickets ---------------------------------------------------------------

_OPEN_STATES = ("open", "in_progress")
_CLOSED_STATES = ("done", "wont_fix")
TICKET_STATES = _OPEN_STATES + _CLOSED_STATES


def _next_ticket_key(session, repo_id: str) -> str:
    """Atomically increment the per-repo ticket counter and return REV-{N}.

    Caller must hold an open transaction; we lock the Repo row on Postgres.
    SQLite serializes via its file-level lock, so the SELECT/UPDATE pair is safe.
    """
    repo = session.get(Repo, repo_id)
    if repo is None:
        # Caller passed a stale id — fall back to a high-water timestamp suffix.
        return f"REV-{int(datetime.now(timezone.utc).timestamp())}"
    seq = int(repo.next_ticket_seq or 1)
    repo.next_ticket_seq = seq + 1
    session.flush()
    return f"REV-{seq}"


def _find_existing_ticket(
    session, *, repo_id: str, rule_id: str, file_path: str, start_line: int, end_line: int
) -> Optional[Ticket]:
    """Dedup query: same repo + rule + file with overlapping line range.

    Open/in_progress tickets sort first so we relink there before re-opening a closed one.
    """
    overlap = and_(Ticket.start_line <= end_line, Ticket.end_line >= start_line)
    stmt = (
        select(Ticket)
        .where(
            Ticket.repo_id == repo_id,
            Ticket.rule_id == rule_id,
            Ticket.file_path == file_path,
            overlap,
        )
        .order_by(
            # open/in_progress before done/wont_fix
            Ticket.status.in_(_CLOSED_STATES),
            Ticket.created_at.desc(),
        )
        .limit(1)
    )
    return session.scalar(stmt)


def _title_for(finding: Finding) -> str:
    base = f"{finding.rule_id}: {finding.file_path}"
    if finding.start_line:
        base += f":{finding.start_line}"
    return base[:200]


def upsert_ticket_for_finding(session, *, repo_id: str, user_id: Optional[str], finding: Finding) -> Ticket:
    """Dedup-aware ticket upsert. Caller commits the session.

    Behavior:
    - existing open/in_progress ticket: relink finding_id, refresh updated_at, return.
    - existing done/wont_fix ticket: re-open (status=open, closed_at=None), relink.
    - none: create new with next REV-{N} key.
    """
    existing = _find_existing_ticket(
        session,
        repo_id=repo_id,
        rule_id=finding.rule_id,
        file_path=finding.file_path,
        start_line=finding.start_line,
        end_line=finding.end_line,
    )
    if existing is not None:
        existing.finding_id = finding.id
        existing.job_id = finding.job_id
        existing.severity = finding.severity
        existing.title = _title_for(finding)
        existing.start_line = finding.start_line
        existing.end_line = finding.end_line
        if existing.status in _CLOSED_STATES:
            existing.status = "open"
            existing.closed_at = None
        session.flush()
        return existing

    key = _next_ticket_key(session, repo_id)
    t = Ticket(
        key=key,
        repo_id=repo_id,
        user_id=user_id,
        finding_id=finding.id,
        job_id=finding.job_id,
        title=_title_for(finding),
        severity=finding.severity,
        status="open",
        rule_id=finding.rule_id,
        file_path=finding.file_path,
        start_line=finding.start_line,
        end_line=finding.end_line,
    )
    session.add(t)
    session.flush()
    return t


def list_tickets(
    user_id: str,
    *,
    repo_id: Optional[str] = None,
    status: Optional[str] = None,
    severity: Optional[str] = None,
) -> list[Ticket]:
    with session_maker()() as s:
        stmt = select(Ticket).where(or_(Ticket.user_id == user_id, Ticket.user_id.is_(None)))
        if repo_id:
            stmt = stmt.where(Ticket.repo_id == repo_id)
        if status:
            stmt = stmt.where(Ticket.status == status)
        if severity:
            stmt = stmt.where(Ticket.severity == severity)
        # Open first, then by severity (P0 < P1 < P2 alphabetical works), then newest first.
        stmt = stmt.order_by(
            Ticket.status.in_(_CLOSED_STATES),
            Ticket.severity,
            Ticket.created_at.desc(),
        )
        return list(s.scalars(stmt))


def get_ticket(ticket_id: str) -> Optional[Ticket]:
    with session_maker()() as s:
        return s.get(Ticket, ticket_id)


def update_ticket_status(ticket_id: str, status: str) -> Optional[Ticket]:
    if status not in TICKET_STATES:
        raise ValueError(f"invalid ticket status: {status}")
    with session_maker()() as s:
        t = s.get(Ticket, ticket_id)
        if t is None:
            return None
        t.status = status
        if status in _CLOSED_STATES and t.closed_at is None:
            t.closed_at = datetime.now(timezone.utc)
        if status in _OPEN_STATES:
            t.closed_at = None
        s.commit()
        s.refresh(t)
        return t
