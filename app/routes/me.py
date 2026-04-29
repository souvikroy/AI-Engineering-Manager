"""Current-user endpoints."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from reviewer.persistence.models import User

from ..auth.dependencies import current_user

router = APIRouter(prefix="/api/me", tags=["me"])


class MeOut(BaseModel):
    id: str
    email: str
    display_name: Optional[str]
    email_verified: bool


@router.get("", response_model=MeOut)
def me(user: User = Depends(current_user)) -> MeOut:
    return MeOut(id=user.id, email=user.email, display_name=user.display_name, email_verified=user.email_verified)
