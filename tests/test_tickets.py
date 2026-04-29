"""Tests for ticket creation, dedup, reopen, and status transitions.

Uses an isolated in-memory SQLite engine so tests don't touch the dev DB.
"""

from __future__ import annotations

import asyncio
import os
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker


@pytest.fixture
def isolated_db(monkeypatch, tmp_path):
    """Point persistence layer at a fresh sqlite file for the duration of the test."""
    db_path = tmp_path / "test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("REVIEWER_DB_URL", f"sqlite:///{db_path}")

    # Force re-creation of the engine bound to the new URL.
    from reviewer.persistence import models as m
    from reviewer.core import config as c

    c.get_settings.cache_clear() if hasattr(c.get_settings, "cache_clear") else None
    m._engine = None
    m._Session = None
    yield m
    m._engine = None
    m._Session = None


def _seed_repo_and_user(models):
    from reviewer.persistence.models import Repo, User, session_maker

    with session_maker()() as s:
        u = User(email=f"t{uuid.uuid4().hex[:6]}@x.io", password_hash="x", display_name="t", email_verified=True)
        s.add(u)
        s.flush()
        r = Repo(user_id=u.id, url="https://github.com/x/y", pinecone_namespace="ns")
        s.add(r)
        s.commit()
        return u.id, r.id


def _add_finding(*, job_id, user_id, rule_id, severity, file_path, start_line, end_line):
    from reviewer.persistence.models import Finding, session_maker

    with session_maker()() as s:
        f = Finding(
            job_id=job_id,
            user_id=user_id,
            rule_id=rule_id,
            workflow=1,
            severity=severity,
            file_path=file_path,
            start_line=start_line,
            end_line=end_line,
            status="open",
        )
        s.add(f)
        s.commit()
        s.refresh(f)
        return f.id


def _make_job(*, user_id, repo_id):
    from reviewer.persistence.models import Job, session_maker

    with session_maker()() as s:
        j = Job(
            user_id=user_id,
            repo_id=repo_id,
            repo_url="https://github.com/x/y",
            target_ref="",
            head_sha="",
            base_sha="",
            status="done",
            idempotency_key=f"k-{uuid.uuid4().hex[:8]}",
        )
        s.add(j)
        s.commit()
        s.refresh(j)
        return j.id


def test_creator_skips_p3_findings(isolated_db):
    from app.tickets.creator import create_tickets_for_job

    uid, repo_id = _seed_repo_and_user(isolated_db)
    job_id = _make_job(user_id=uid, repo_id=repo_id)
    _add_finding(job_id=job_id, user_id=uid, rule_id="R8.4", severity="P0", file_path="a.py", start_line=10, end_line=10)
    _add_finding(job_id=job_id, user_id=uid, rule_id="R6.1", severity="P1", file_path="b.py", start_line=20, end_line=20)
    _add_finding(job_id=job_id, user_id=uid, rule_id="R15.6", severity="P2", file_path="c.py", start_line=30, end_line=30)
    _add_finding(job_id=job_id, user_id=uid, rule_id="R20.4", severity="P3", file_path="d.md", start_line=1, end_line=1)

    tickets = asyncio.run(create_tickets_for_job(job_id=job_id, user_id=uid, repo_id=repo_id))
    assert len(tickets) == 3
    assert {t.severity for t in tickets} == {"P0", "P1", "P2"}
    assert all(t.status == "open" for t in tickets)


def test_creator_dedups_on_rerun(isolated_db):
    from app.tickets.creator import create_tickets_for_job

    uid, repo_id = _seed_repo_and_user(isolated_db)
    job_id = _make_job(user_id=uid, repo_id=repo_id)
    _add_finding(job_id=job_id, user_id=uid, rule_id="R8.4", severity="P0", file_path="a.py", start_line=10, end_line=12)

    first = asyncio.run(create_tickets_for_job(job_id=job_id, user_id=uid, repo_id=repo_id))
    assert len(first) == 1

    # Simulate a second review run that finds the same issue.
    job2 = _make_job(user_id=uid, repo_id=repo_id)
    _add_finding(job_id=job2, user_id=uid, rule_id="R8.4", severity="P0", file_path="a.py", start_line=11, end_line=13)
    second = asyncio.run(create_tickets_for_job(job_id=job2, user_id=uid, repo_id=repo_id))
    assert len(second) == 1
    assert second[0].key == first[0].key  # same ticket — dedup hit


def test_closed_ticket_reopens_when_finding_persists(isolated_db):
    from app.tickets.creator import create_tickets_for_job
    from reviewer.persistence.repository import update_ticket_status

    uid, repo_id = _seed_repo_and_user(isolated_db)
    job_id = _make_job(user_id=uid, repo_id=repo_id)
    _add_finding(job_id=job_id, user_id=uid, rule_id="R8.4", severity="P0", file_path="a.py", start_line=10, end_line=10)

    [t] = asyncio.run(create_tickets_for_job(job_id=job_id, user_id=uid, repo_id=repo_id))
    update_ticket_status(t.id, "done")

    # Re-run with same issue — should re-open the same ticket (same key).
    job2 = _make_job(user_id=uid, repo_id=repo_id)
    _add_finding(job_id=job2, user_id=uid, rule_id="R8.4", severity="P0", file_path="a.py", start_line=10, end_line=10)
    [reopened] = asyncio.run(create_tickets_for_job(job_id=job2, user_id=uid, repo_id=repo_id))
    assert reopened.id == t.id
    assert reopened.key == t.key
    assert reopened.status == "open"
    assert reopened.closed_at is None


def test_non_overlapping_lines_create_distinct_tickets(isolated_db):
    from app.tickets.creator import create_tickets_for_job

    uid, repo_id = _seed_repo_and_user(isolated_db)
    job_id = _make_job(user_id=uid, repo_id=repo_id)
    _add_finding(job_id=job_id, user_id=uid, rule_id="R8.4", severity="P0", file_path="a.py", start_line=10, end_line=15)
    _add_finding(job_id=job_id, user_id=uid, rule_id="R8.4", severity="P0", file_path="a.py", start_line=50, end_line=55)

    tickets = asyncio.run(create_tickets_for_job(job_id=job_id, user_id=uid, repo_id=repo_id))
    assert len(tickets) == 2
    assert tickets[0].key != tickets[1].key


def test_no_findings_creates_no_tickets(isolated_db):
    from app.tickets.creator import create_tickets_for_job

    uid, repo_id = _seed_repo_and_user(isolated_db)
    job_id = _make_job(user_id=uid, repo_id=repo_id)
    tickets = asyncio.run(create_tickets_for_job(job_id=job_id, user_id=uid, repo_id=repo_id))
    assert tickets == []


def test_status_transition_sets_closed_at(isolated_db):
    from app.tickets.creator import create_tickets_for_job
    from reviewer.persistence.repository import update_ticket_status

    uid, repo_id = _seed_repo_and_user(isolated_db)
    job_id = _make_job(user_id=uid, repo_id=repo_id)
    _add_finding(job_id=job_id, user_id=uid, rule_id="R8.4", severity="P0", file_path="a.py", start_line=10, end_line=10)
    [t] = asyncio.run(create_tickets_for_job(job_id=job_id, user_id=uid, repo_id=repo_id))

    closed = update_ticket_status(t.id, "done")
    assert closed.closed_at is not None
    reopened = update_ticket_status(t.id, "open")
    assert reopened.closed_at is None


def test_keys_increment_per_repo(isolated_db):
    import asyncio
    from app.tickets.creator import create_tickets_for_job

    uid, repo_id = _seed_repo_and_user(isolated_db)
    job_id = _make_job(user_id=uid, repo_id=repo_id)
    _add_finding(job_id=job_id, user_id=uid, rule_id="R8.4", severity="P0", file_path="a.py", start_line=1, end_line=1)
    _add_finding(job_id=job_id, user_id=uid, rule_id="R6.1", severity="P1", file_path="b.py", start_line=1, end_line=1)
    _add_finding(job_id=job_id, user_id=uid, rule_id="R15.6", severity="P2", file_path="c.py", start_line=1, end_line=1)

    tickets = asyncio.run(create_tickets_for_job(job_id=job_id, user_id=uid, repo_id=repo_id))
    keys = sorted(t.key for t in tickets)
    assert keys == ["REV-1", "REV-2", "REV-3"]


def test_template_body_renders_all_sections():
    from app.tickets.template import render_template_body

    body = render_template_body(
        key="REV-7",
        repo_url="https://github.com/x/y",
        rule_id="R8.4",
        severity="P0",
        file_path="src/api.py",
        start_line=10,
        end_line=15,
        branch="main",
        rationale="SQL injection risk in raw query construction.",
        fix_suggestion="Use parameterized queries.",
        snippet='cursor.execute(f"SELECT * FROM u WHERE id={uid}")',
        confidence=0.9,
        workflow=8,
    )
    # All required Jira sections from the user's template must be present.
    for section in [
        "## 🔖 Title",
        "## 🧩 Ticket Type",
        "## 🚨 Priority",
        "## 📍 Component / Service",
        "## 👤 Owner",
        "## 📝 Description",
        "## 🎯 Goal / Outcome",
        "## 🔍 Problem Details",
        "## 🔁 Steps to Reproduce",
        "## ✅ Expected Behavior",
        "## ❌ Actual Behavior",
        "## 🧠 Technical Context",
        "## 📊 Logs / Evidence",
        "## 🧪 Acceptance Criteria",
        "## 🔒 Scope",
        "## ⚠️ Risks & Edge Cases",
        "## 🔗 Dependencies",
        "## 🚀 Rollout Plan",
        "## 🧹 Definition of Done",
        "## 📎 Additional Notes",
    ]:
        assert section in body, f"missing section: {section}"
    # Fact preservation
    assert "src/api.py" in body
    assert "R8.4" in body
    assert "P0 (Critical)" in body
    assert "REV-7" in body
    assert "SELECT * FROM u" in body
    assert "Use parameterized queries." in body


def test_llm_body_falls_back_to_template_when_disabled(isolated_db, monkeypatch):
    """If OPENROUTER_API_KEY is empty, generate_body must return the deterministic template."""
    import asyncio
    monkeypatch.setenv("OPENROUTER_API_KEY", "")
    # Force settings cache reload
    from reviewer.core import config as c
    if hasattr(c.get_settings, "cache_clear"):
        c.get_settings.cache_clear()

    from app.tickets.llm_body import generate_body
    from reviewer.core.llm_router import LLMRouter

    async def run():
        router = LLMRouter()
        try:
            body, source = await generate_body(
                router=router,
                key="REV-1",
                repo_url="https://github.com/x/y",
                rule_id="R8.4",
                severity="P0",
                file_path="a.py",
                start_line=1,
                end_line=1,
                branch="main",
                rationale="r",
                fix_suggestion="f",
                snippet="s",
                confidence=0.5,
            )
            return body, source
        finally:
            await router.aclose()

    body, source = asyncio.run(run())
    assert source == "template"
    assert "## 🔖 Title" in body  # template was used
    assert "REV-1" in body


def test_creator_writes_body_for_new_tickets(isolated_db, monkeypatch):
    """End-to-end: create_tickets_for_job populates a non-empty body via the template fallback."""
    import asyncio
    monkeypatch.setenv("OPENROUTER_API_KEY", "")
    from reviewer.core import config as c
    if hasattr(c.get_settings, "cache_clear"):
        c.get_settings.cache_clear()

    from app.tickets.creator import create_tickets_for_job

    uid, repo_id = _seed_repo_and_user(isolated_db)
    job_id = _make_job(user_id=uid, repo_id=repo_id)
    _add_finding(job_id=job_id, user_id=uid, rule_id="R8.4", severity="P0",
                 file_path="src/api.py", start_line=10, end_line=15)

    tickets = asyncio.run(create_tickets_for_job(job_id=job_id, user_id=uid, repo_id=repo_id))
    assert len(tickets) == 1
    t = tickets[0]
    assert t.body and "## 🔖 Title" in t.body
    assert t.body_source == "template"
    assert t.body_format == "markdown"


def test_dedup_preserves_existing_body(isolated_db, monkeypatch):
    """A second review run on the same finding must NOT clobber an edited body."""
    import asyncio
    monkeypatch.setenv("OPENROUTER_API_KEY", "")
    from reviewer.core import config as c
    if hasattr(c.get_settings, "cache_clear"):
        c.get_settings.cache_clear()

    from app.tickets.creator import create_tickets_for_job
    from reviewer.persistence.models import Ticket, session_maker

    uid, repo_id = _seed_repo_and_user(isolated_db)
    job_id = _make_job(user_id=uid, repo_id=repo_id)
    _add_finding(job_id=job_id, user_id=uid, rule_id="R8.4", severity="P0",
                 file_path="a.py", start_line=10, end_line=10)
    [t] = asyncio.run(create_tickets_for_job(job_id=job_id, user_id=uid, repo_id=repo_id))
    tid = t.id

    # User edits the body
    with session_maker()() as s:
        ticket = s.get(Ticket, tid)
        ticket.body = "## 🔖 Title\n\nUSER EDITED"
        s.commit()

    # Re-run review on the same finding
    job2 = _make_job(user_id=uid, repo_id=repo_id)
    _add_finding(job_id=job2, user_id=uid, rule_id="R8.4", severity="P0",
                 file_path="a.py", start_line=10, end_line=10)
    asyncio.run(create_tickets_for_job(job_id=job2, user_id=uid, repo_id=repo_id))

    with session_maker()() as s:
        ticket = s.get(Ticket, tid)
        assert "USER EDITED" in ticket.body, "dedup hit must not overwrite an existing body"
