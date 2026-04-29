"""Repo CRUD: list, create (encrypt PAT), get, archive."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from reviewer.ingest.github_pat import parse_repo_url
from reviewer.persistence.models import Job, Repo, session_maker
from reviewer.persistence.repository import audit

from ..auth.dependencies import current_user_id
from ..security import fernet_box
from ..security.rate_limit import check as rate_check

router = APIRouter(prefix="/api/repos", tags=["repos"])


class AddRepoBody(BaseModel):
    url: str = Field(min_length=10, max_length=512)
    pat: Optional[str] = Field(default=None, max_length=200)


class RepoOut(BaseModel):
    id: str
    url: str
    default_branch: Optional[str]
    pat_hint: Optional[str]
    pinecone_namespace: str
    has_pat: bool
    created_at: datetime
    last_review: Optional[dict] = None


def _to_out(r: Repo, last_job: Optional[Job] = None) -> RepoOut:
    return RepoOut(
        id=r.id, url=r.url, default_branch=r.default_branch,
        pat_hint=r.pat_hint, pinecone_namespace=r.pinecone_namespace,
        has_pat=bool(r.pat_ciphertext),
        created_at=r.created_at,
        last_review=(
            {"id": last_job.id, "status": last_job.status, "created_at": last_job.created_at.isoformat() if last_job.created_at else None}
            if last_job else None
        ),
    )


@router.get("", response_model=list[RepoOut])
def list_repos(uid: str = Depends(current_user_id)) -> list[RepoOut]:
    with session_maker()() as s:
        repos = list(s.scalars(select(Repo).where(Repo.user_id == uid, Repo.archived_at.is_(None)).order_by(Repo.created_at.desc())))
        # Latest job per repo (small N, simple loop OK).
        out: list[RepoOut] = []
        for r in repos:
            last = s.scalars(
                select(Job).where(Job.repo_id == r.id, Job.user_id == uid).order_by(Job.created_at.desc()).limit(1)
            ).first()
            out.append(_to_out(r, last))
    return out


@router.post("", response_model=RepoOut, status_code=201)
async def add_repo(body: AddRepoBody, uid: str = Depends(current_user_id)) -> RepoOut:
    await rate_check(key=f"repo_add:{uid}", capacity=10, window_seconds=300)
    try:
        parse_repo_url(body.url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    with session_maker()() as s:
        existing = s.scalar(select(Repo).where(Repo.user_id == uid, Repo.url == body.url, Repo.archived_at.is_(None)))
        if existing:
            return _to_out(existing)
        ct = fernet_box.encrypt(body.pat) if body.pat else None
        hint = body.pat[-4:] if body.pat else None
        r = Repo(
            user_id=uid,
            url=body.url,
            pat_ciphertext=ct,
            pat_hint=hint,
            pinecone_namespace="",  # filled after we have an id
        )
        s.add(r)
        s.commit()
        s.refresh(r)
        r.pinecone_namespace = f"repo:{r.id}"
        s.commit()
        s.refresh(r)
    audit(actor=uid, action="repo_add", resource=r.id)
    return _to_out(r)


@router.get("/{repo_id}", response_model=RepoOut)
def get_repo(repo_id: str, uid: str = Depends(current_user_id)) -> RepoOut:
    with session_maker()() as s:
        r = s.get(Repo, repo_id)
        if r is None or r.user_id != uid or r.archived_at is not None:
            raise HTTPException(status_code=404, detail="repo not found")
        last = s.scalars(
            select(Job).where(Job.repo_id == r.id, Job.user_id == uid).order_by(Job.created_at.desc()).limit(1)
        ).first()
        return _to_out(r, last)


@router.delete("/{repo_id}", status_code=204)
async def archive_repo(repo_id: str, uid: str = Depends(current_user_id)) -> None:
    with session_maker()() as s:
        r = s.get(Repo, repo_id)
        if r is None or r.user_id != uid:
            raise HTTPException(status_code=404, detail="repo not found")
        r.archived_at = datetime.now(timezone.utc)
        s.commit()
    # Best-effort: drop the per-repo Pinecone index so we don't leak orphaned vectors.
    # We don't fail the archive if Pinecone is unreachable — DB state is the source of truth.
    try:
        from reviewer.index.pinecone_store import PineconeStore
        await PineconeStore.delete_repo_index(repo_id)
    except Exception:  # noqa: BLE001
        pass
    audit(actor=uid, action="repo_archive", resource=repo_id)
