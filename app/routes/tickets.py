"""Tickets — Jira-style trackable items derived from review findings.

Endpoints:
- GET    /api/tickets                       list user tickets (filters: repo_id, status, severity)
- GET    /api/tickets/{ticket_id}           detail with linked finding context (lazy LLM upgrade)
- PATCH  /api/tickets/{ticket_id}           transition status
- POST   /api/tickets/{ticket_id}/regenerate-body   force a fresh LLM body
- GET    /api/repos/{repo_id}/tickets       per-repo convenience list + open count
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from reviewer.persistence.models import Finding, Repo, Ticket, session_maker
from reviewer.persistence.repository import (
    TICKET_STATES,
    get_ticket,
    list_tickets,
    update_ticket_status,
)

from ..auth.dependencies import current_user_id
from ..tickets.providers import get_provider

log = logging.getLogger(__name__)

# In-process set of ticket_ids currently being upgraded by lazy LLM regen.
# Prevents repeated regen if the user refreshes the detail page mid-upgrade.
_LAZY_UPGRADES_IN_FLIGHT: set[str] = set()

router = APIRouter(prefix="/api/tickets", tags=["tickets"])
repo_tickets_router = APIRouter(prefix="/api/repos", tags=["repos"])


class TicketOut(BaseModel):
    id: str
    key: str
    repo_id: str
    job_id: Optional[str] = None
    finding_id: Optional[str] = None
    title: str
    severity: str
    status: str
    rule_id: str
    file_path: str
    start_line: int
    end_line: int
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    closed_at: Optional[str] = None
    external_provider: str = ""
    external_key: str = ""
    external_url: str = ""


class TicketDetailOut(TicketOut):
    rationale: str = ""
    fix_suggestion: str = ""
    snippet: str = ""
    branch: str = ""
    confidence: float = 0.0
    repo_url: str = ""
    body: str = ""
    body_format: str = "markdown"
    body_source: str = ""


class TicketListOut(BaseModel):
    items: list[TicketOut]
    open_count: int


class PatchBody(BaseModel):
    status: str = Field(pattern="^(open|in_progress|done|wont_fix)$")


def _ticket_dict(t: Ticket) -> TicketOut:
    return TicketOut(
        id=t.id, key=t.key, repo_id=t.repo_id, job_id=t.job_id, finding_id=t.finding_id,
        title=t.title, severity=t.severity, status=t.status,
        rule_id=t.rule_id, file_path=t.file_path,
        start_line=t.start_line, end_line=t.end_line,
        created_at=t.created_at.isoformat() if t.created_at else None,
        updated_at=t.updated_at.isoformat() if t.updated_at else None,
        closed_at=t.closed_at.isoformat() if t.closed_at else None,
        external_provider=t.external_provider or "",
        external_key=t.external_key or "",
        external_url=t.external_url or "",
    )


@router.get("", response_model=TicketListOut)
def list_user_tickets(
    uid: str = Depends(current_user_id),
    repo_id: Optional[str] = None,
    status: Optional[str] = None,
    severity: Optional[str] = None,
) -> TicketListOut:
    if status and status not in TICKET_STATES:
        raise HTTPException(status_code=400, detail="invalid status")
    items = list_tickets(uid, repo_id=repo_id, status=status, severity=severity)
    out = [_ticket_dict(t) for t in items]
    open_count = sum(1 for t in items if t.status in ("open", "in_progress"))
    return TicketListOut(items=out, open_count=open_count)


@router.get("/{ticket_id}", response_model=TicketDetailOut)
async def get_ticket_detail(ticket_id: str, uid: str = Depends(current_user_id)) -> TicketDetailOut:
    """Fetch ticket detail.

    If the body is still the deterministic template (i.e. no LLM has touched it yet),
    we fire a fire-and-forget LLM upgrade so the next refresh shows the polished version.
    The current response always returns immediately with whatever body exists today —
    we never block the GET on an LLM call.
    """
    t = get_ticket(ticket_id)
    if t is None or t.user_id not in (uid, None):
        raise HTTPException(status_code=404, detail="ticket not found")
    base = _ticket_dict(t).model_dump()
    extra = {
        "rationale": "", "fix_suggestion": "", "snippet": "", "branch": "",
        "confidence": 0.0, "repo_url": "",
        "body": t.body or "", "body_format": t.body_format or "markdown",
        "body_source": t.body_source or "",
    }
    with session_maker()() as s:
        if t.finding_id:
            f = s.get(Finding, t.finding_id)
            if f is not None:
                extra["rationale"] = f.rationale or ""
                extra["fix_suggestion"] = f.fix_suggestion or ""
                extra["snippet"] = f.snippet or ""
                extra["branch"] = f.branch or ""
                extra["confidence"] = float(f.confidence or 0.0)
        repo = s.get(Repo, t.repo_id)
        if repo is not None:
            extra["repo_url"] = repo.url

    # Lazy LLM upgrade: kick off in the background, don't await.
    if (t.body_source or "") == "template" and t.id not in _LAZY_UPGRADES_IN_FLIGHT:
        _LAZY_UPGRADES_IN_FLIGHT.add(t.id)
        asyncio.create_task(_lazy_upgrade_body(t.id))

    return TicketDetailOut(**base, **extra)


async def _lazy_upgrade_body(ticket_id: str) -> None:
    """Background task: upgrade a ticket's template body to LLM. Fire-and-forget."""
    try:
        from ..tickets.creator import regenerate_body
        await regenerate_body(ticket_id)
    except Exception:
        log.exception("lazy LLM body upgrade failed for ticket %s", ticket_id)
    finally:
        _LAZY_UPGRADES_IN_FLIGHT.discard(ticket_id)


@router.post("/{ticket_id}/regenerate-body", response_model=TicketDetailOut)
async def regenerate_ticket_body(ticket_id: str, uid: str = Depends(current_user_id)) -> TicketDetailOut:
    t = get_ticket(ticket_id)
    if t is None or t.user_id not in (uid, None):
        raise HTTPException(status_code=404, detail="ticket not found")
    from ..tickets.creator import regenerate_body
    updated = await regenerate_body(ticket_id)
    if updated is None:
        raise HTTPException(status_code=404, detail="ticket not found")
    return get_ticket_detail(ticket_id, uid)


@router.patch("/{ticket_id}", response_model=TicketOut)
def patch_ticket(ticket_id: str, body: PatchBody, uid: str = Depends(current_user_id)) -> TicketOut:
    t = get_ticket(ticket_id)
    if t is None or t.user_id not in (uid, None):
        raise HTTPException(status_code=404, detail="ticket not found")
    updated = update_ticket_status(ticket_id, body.status)
    if updated is None:
        raise HTTPException(status_code=404, detail="ticket not found")
    # Phase 2 hook — internal provider is a no-op today.
    try:
        get_provider("internal").update_status(updated, body.status)
    except Exception:
        pass
    return _ticket_dict(updated)


@repo_tickets_router.get("/{repo_id}/tickets", response_model=TicketListOut)
def list_repo_tickets(
    repo_id: str,
    uid: str = Depends(current_user_id),
    status: Optional[str] = None,
    severity: Optional[str] = None,
) -> TicketListOut:
    with session_maker()() as s:
        repo = s.get(Repo, repo_id)
        if repo is None or repo.user_id != uid:
            raise HTTPException(status_code=404, detail="repo not found")
    items = list_tickets(uid, repo_id=repo_id, status=status, severity=severity)
    return TicketListOut(
        items=[_ticket_dict(t) for t in items],
        open_count=sum(1 for t in items if t.status in ("open", "in_progress")),
    )
