"""SQLAlchemy 2.0 models. Postgres (Neon) primary; SQLite still works for the CLI."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    create_engine,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, declared_attr, mapped_column, relationship, sessionmaker

from ..core.config import get_settings


def _uuid() -> str:
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    @declared_attr.directive
    def __tablename__(cls) -> str:  # noqa: N805
        return cls.__name__.lower()


class User(Base):
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(Text)
    display_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("user.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), index=True)  # sha256 hex
    user_agent: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    ip: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    rotated_to: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)


class Repo(Base):
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("user.id", ondelete="CASCADE"), index=True)
    url: Mapped[str] = mapped_column(String(512))
    default_branch: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    pat_ciphertext: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)
    pat_hint: Mapped[Optional[str]] = mapped_column(String(8), nullable=True)
    pinecone_namespace: Mapped[str] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    archived_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    next_ticket_seq: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    __table_args__ = (UniqueConstraint("user_id", "url", name="uq_repo_user_url"),)


class Job(Base):
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("user.id", ondelete="SET NULL"), nullable=True, index=True)
    repo_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("repo.id", ondelete="SET NULL"), nullable=True, index=True)
    repo_url: Mapped[str] = mapped_column(String(512))
    target_ref: Mapped[str] = mapped_column(String(255), default="")
    head_sha: Mapped[str] = mapped_column(String(40), default="")
    base_sha: Mapped[str] = mapped_column(String(40), default="")
    status: Mapped[str] = mapped_column(String(32), default="queued", index=True)
    intent: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    plan: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    budget_tokens: Mapped[int] = mapped_column(Integer, default=0)
    budget_usd: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(128), unique=True)

    findings: Mapped[list["Finding"]] = relationship(back_populates="job", cascade="all,delete")
    runs: Mapped[list["Run"]] = relationship(back_populates="job", cascade="all,delete")


class JobEvent(Base):
    __tablename__ = "job_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[str] = mapped_column(String(36), ForeignKey("job.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    stage: Mapped[str] = mapped_column(String(64), index=True)  # ingest|static|intent|plan|wf|verify|done|error|finding
    workflow: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    data: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)


class Run(Base):
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    job_id: Mapped[str] = mapped_column(ForeignKey("job.id"))
    user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    workflow: Mapped[int] = mapped_column(Integer)
    agent: Mapped[str] = mapped_column(String(64))
    model: Mapped[str] = mapped_column(String(128), default="")
    tokens_in: Mapped[int] = mapped_column(Integer, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0)
    usd: Mapped[float] = mapped_column(Numeric(10, 6), default=0.0)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="running")
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    job: Mapped[Job] = relationship(back_populates="runs")


class Finding(Base):
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    job_id: Mapped[str] = mapped_column(ForeignKey("job.id"))
    user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    rule_id: Mapped[str] = mapped_column(String(16))
    workflow: Mapped[int] = mapped_column(Integer)
    severity: Mapped[str] = mapped_column(String(4))
    file_path: Mapped[str] = mapped_column(String(512), default="")
    start_line: Mapped[int] = mapped_column(Integer, default=0)
    end_line: Mapped[int] = mapped_column(Integer, default=0)
    snippet: Mapped[str] = mapped_column(Text, default="")
    rationale: Mapped[str] = mapped_column(Text, default="")
    fix_suggestion: Mapped[str] = mapped_column(Text, default="")
    confidence: Mapped[float] = mapped_column(Float, default=0.5)
    evidence: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    static_corroborated: Mapped[bool] = mapped_column(Boolean, default=False)
    critic_outcome: Mapped[str] = mapped_column(String(16), default="not_run")
    status: Mapped[str] = mapped_column(String(16), default="open")
    branch: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    job: Mapped[Job] = relationship(back_populates="findings")


class CostLedger(Base):
    __tablename__ = "cost_ledger"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    job_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    run_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    provider: Mapped[str] = mapped_column(String(32), default="openrouter")
    model: Mapped[str] = mapped_column(String(128))
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    usd: Mapped[float] = mapped_column(Numeric(12, 8), default=0.0)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    actor: Mapped[str] = mapped_column(String(128))
    action: Mapped[str] = mapped_column(String(128))
    resource: Mapped[str] = mapped_column(String(255))
    payload_hash: Mapped[str] = mapped_column(String(64), default="")
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Ticket(Base):
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    key: Mapped[str] = mapped_column(String(32))  # e.g. "REV-7", unique within repo
    repo_id: Mapped[str] = mapped_column(String(36), ForeignKey("repo.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("user.id", ondelete="SET NULL"), nullable=True, index=True)
    finding_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("finding.id", ondelete="SET NULL"), nullable=True)
    job_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("job.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(String(200), default="")
    severity: Mapped[str] = mapped_column(String(4))  # P0/P1/P2
    status: Mapped[str] = mapped_column(String(16), default="open", index=True)  # open|in_progress|done|wont_fix
    rule_id: Mapped[str] = mapped_column(String(16), default="")
    file_path: Mapped[str] = mapped_column(String(512), default="")
    start_line: Mapped[int] = mapped_column(Integer, default=0)
    end_line: Mapped[int] = mapped_column(Integer, default=0)
    # Rich Jira-style markdown body (LLM-generated; falls back to a deterministic template).
    body: Mapped[str] = mapped_column(Text, default="", server_default="")
    body_format: Mapped[str] = mapped_column(String(16), default="markdown", server_default="markdown")
    body_source: Mapped[str] = mapped_column(String(16), default="", server_default="")  # "llm" | "template" | ""
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    closed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # Phase 2 — external Jira sync hooks (unused in Phase 1)
    external_provider: Mapped[str] = mapped_column(String(32), default="")
    external_key: Mapped[str] = mapped_column(String(64), default="")
    external_url: Mapped[str] = mapped_column(String(512), default="")
    __table_args__ = (
        UniqueConstraint("repo_id", "key", name="uq_ticket_repo_key"),
        Index("ix_ticket_dedup", "repo_id", "rule_id", "file_path"),
    )


_engine = None
_Session = None


def get_engine():
    global _engine
    if _engine is None:
        s = get_settings()
        kwargs: dict = {"future": True}
        if s.db_url.startswith("postgresql"):
            kwargs["connect_args"] = {"connect_timeout": 5}
        _engine = create_engine(s.db_url, **kwargs)
        Base.metadata.create_all(_engine)
        _bootstrap_columns(_engine)
    return _engine


def _bootstrap_columns(engine) -> None:
    """Idempotent column adds for tables that pre-existed before a column was introduced.

    SQLAlchemy's create_all() only creates missing tables; it never adds columns to
    existing ones. For each new column we add post-launch, list it here.
    """
    from sqlalchemy import text

    additions = [
        ("repo", "next_ticket_seq", "INTEGER DEFAULT 1"),
        ("ticket", "body", "TEXT DEFAULT ''"),
        ("ticket", "body_format", "VARCHAR(16) DEFAULT 'markdown'"),
        ("ticket", "body_source", "VARCHAR(16) DEFAULT ''"),
    ]
    with engine.begin() as conn:
        for table, column, ddl in additions:
            try:
                conn.execute(text(f'ALTER TABLE {table} ADD COLUMN {column} {ddl}'))
            except Exception:
                # Column already exists or table not yet created — fine either way.
                pass


def session_maker():
    global _Session
    if _Session is None:
        _Session = sessionmaker(bind=get_engine(), expire_on_commit=False, future=True)
    return _Session
