"""Finding mutations: accept / dismiss with note."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from reviewer.persistence.models import Finding, session_maker

from ..auth.dependencies import current_user_id

router = APIRouter(prefix="/api/findings", tags=["findings"])


class PatchBody(BaseModel):
    status: str = Field(pattern="^(open|accepted|dismissed)$")
    note: Optional[str] = Field(default=None, max_length=500)


@router.patch("/{finding_id}")
def patch_finding(finding_id: str, body: PatchBody, uid: str = Depends(current_user_id)) -> dict:
    with session_maker()() as s:
        f = s.get(Finding, finding_id)
        if f is None or f.user_id not in (uid, None):
            raise HTTPException(status_code=404, detail="finding not found")
        f.status = body.status
        s.commit()
    return {"id": finding_id, "status": body.status}
