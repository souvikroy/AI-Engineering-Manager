"""Auto-create tickets for actionable findings when a review job completes.

Filter: P0/P1/P2 only (skip P3 nits). Dedup by (repo, rule_id, file_path, overlapping line range).

Body generation strategy (revised after a 235-ticket review saturated OpenRouter and
starved the API for ~10 minutes):
- Creator writes the **deterministic template body** synchronously for every new ticket.
  That's instant, free, and good enough to ship.
- The **LLM upgrade is lazy**: the TicketDetail page kicks off one regenerate per ticket
  the first time a user opens it (capped at the human click rate, never N at once).
- The Regenerate button on the detail page is the user's escape hatch to refresh on demand.

Existing tickets (dedup hits on re-review) keep their body unchanged so prior LLM
output / user edits aren't clobbered.
"""

from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy import select

from reviewer.core.llm_router import LLMRouter
from reviewer.persistence.models import Finding, Repo, Ticket, session_maker
from reviewer.persistence.repository import upsert_ticket_for_finding

from .llm_body import generate_body
from .template import render_template_body

log = logging.getLogger(__name__)

ELIGIBLE_SEVERITIES = {"P0", "P1", "P2"}


async def create_tickets_for_job(
    *, job_id: str, user_id: Optional[str], repo_id: Optional[str]
) -> list[Ticket]:
    """Idempotent: safe to call multiple times for the same job.

    Returns Tickets in detached state — caller should treat as read-only.
    Body for newly-created tickets is the deterministic template; LLM upgrade
    happens lazily on first detail view (see app/routes/tickets.py).
    """
    if not repo_id:
        return []

    out: list[Ticket] = []

    with session_maker()() as s:
        repo = s.get(Repo, repo_id)
        repo_url = repo.url if repo else ""
        findings = list(
            s.scalars(select(Finding).where(Finding.job_id == job_id, Finding.status == "open"))
        )
        for f in findings:
            if f.severity not in ELIGIBLE_SEVERITIES:
                continue
            try:
                t = upsert_ticket_for_finding(s, repo_id=repo_id, user_id=user_id, finding=f)
                # Brand-new ticket (no body yet) → write the deterministic template.
                # Existing dedup hits keep their body untouched.
                if not (t.body or "").strip():
                    t.body = render_template_body(
                        key=t.key, repo_url=repo_url, rule_id=f.rule_id, severity=f.severity,
                        file_path=f.file_path, start_line=f.start_line, end_line=f.end_line,
                        branch=f.branch, rationale=f.rationale or "",
                        fix_suggestion=f.fix_suggestion or "", snippet=f.snippet or "",
                        confidence=float(f.confidence or 0.0), workflow=int(f.workflow or 0),
                    )
                    t.body_format = "markdown"
                    t.body_source = "template"
                out.append(t)
            except Exception:
                log.exception("ticket upsert failed for finding %s", f.id)
        s.commit()
        out = [s.get(Ticket, t.id) for t in out if t.id]

    return out


async def regenerate_body(ticket_id: str) -> Optional[Ticket]:
    """Regenerate one ticket body via the LLM (used by the API)."""
    with session_maker()() as s:
        t = s.get(Ticket, ticket_id)
        if t is None:
            return None
        f = s.get(Finding, t.finding_id) if t.finding_id else None
        repo = s.get(Repo, t.repo_id)
        spec = {
            "key": t.key,
            "repo_url": repo.url if repo else "",
            "rule_id": t.rule_id,
            "severity": t.severity,
            "file_path": t.file_path,
            "start_line": t.start_line,
            "end_line": t.end_line,
            "branch": (f.branch if f else "") or "",
            "rationale": (f.rationale if f else "") or "",
            "fix_suggestion": (f.fix_suggestion if f else "") or "",
            "snippet": (f.snippet if f else "") or "",
            "confidence": float((f.confidence if f else 0.0) or 0.0),
            "workflow": int((f.workflow if f else 0) or 0),
        }

    router = LLMRouter()
    try:
        body, source = await generate_body(router=router, **spec)
    finally:
        await router.aclose()

    with session_maker()() as s:
        t = s.get(Ticket, ticket_id)
        if t is None:
            return None
        t.body = body
        t.body_source = source
        t.body_format = "markdown"
        s.commit()
        s.refresh(t)
        return t
