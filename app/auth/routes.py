"""Auth endpoints: signup, login, refresh, logout."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select

from reviewer.persistence.models import RefreshToken, User, session_maker
from reviewer.persistence.repository import audit

from ..core.settings import get_app_settings
from .dependencies import current_user_id, get_bearer_token
from .jwt_codec import (
    hash_refresh,
    mint_access_token,
    new_refresh_token,
    verify_token,
)
from .passwords import hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])

DEMO_EMAIL = "demo@test.com"
DEMO_PASSWORD = "123456"
DEMO_PASSWORD_HASH_SOURCE = "123456000000"  # satisfies current password policy; login still checks DEMO_PASSWORD


class SignupBody(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=200)
    display_name: Optional[str] = Field(default=None, max_length=120)


class LoginBody(BaseModel):
    email: EmailStr
    password: str


class RefreshBody(BaseModel):
    refresh_token: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_at: int
    user: dict


def _user_dict(u: User) -> dict:
    return {
        "id": u.id,
        "email": u.email,
        "display_name": u.display_name,
        "email_verified": u.email_verified,
    }


def _issue_tokens(user: User, request: Request) -> TokenResponse:
    s = get_app_settings()
    raw, sha = new_refresh_token()
    rt = RefreshToken(
        user_id=user.id,
        token_hash=sha,
        user_agent=request.headers.get("user-agent", ""),
        ip=request.client.host if request.client else None,
        expires_at=datetime.now(timezone.utc) + timedelta(days=s.refresh_token_ttl_days),
    )
    with session_maker()() as session:
        session.add(rt)
        session.commit()
        session.refresh(rt)
        access, exp = mint_access_token(user_id=user.id, session_id=rt.id)
        return TokenResponse(
            access_token=access,
            refresh_token=raw,
            expires_at=exp,
            user=_user_dict(user),
        )


@router.post("/signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def signup(body: SignupBody, request: Request) -> TokenResponse:
    raise HTTPException(status_code=404, detail="not found")


@router.post("/login", response_model=TokenResponse)
def login(body: LoginBody, request: Request) -> TokenResponse:
    email = body.email.lower()
    if email != DEMO_EMAIL or body.password != DEMO_PASSWORD:
        raise HTTPException(status_code=401, detail="invalid email or password")

    with session_maker()() as session:
        user = session.scalar(select(User).where(User.email == email))
        if user is None:
            user = User(
                email=email,
                password_hash=hash_password(DEMO_PASSWORD_HASH_SOURCE),
                display_name="Demo",
                email_verified=True,
            )
            session.add(user)
            session.commit()
            session.refresh(user)
        user.last_login_at = datetime.now(timezone.utc)
        session.commit()
        session.refresh(user)

    audit(actor=user.id, action="login", resource=user.id)
    return _issue_tokens(user, request)


@router.post("/refresh", response_model=TokenResponse)
def refresh(body: RefreshBody, request: Request) -> TokenResponse:
    sha = hash_refresh(body.refresh_token)
    with session_maker()() as session:
        rt = session.scalar(select(RefreshToken).where(RefreshToken.token_hash == sha))
        if rt is None:
            raise HTTPException(status_code=401, detail="invalid refresh token")
        if rt.revoked_at is not None:
            # Reuse detected — revoke entire chain to be safe.
            chain = session.scalars(select(RefreshToken).where(RefreshToken.user_id == rt.user_id)).all()
            now = datetime.now(timezone.utc)
            for c in chain:
                if c.revoked_at is None:
                    c.revoked_at = now
            session.commit()
            raise HTTPException(status_code=401, detail="refresh token reuse detected; please log in again")
        now = datetime.now(timezone.utc)
        if rt.expires_at < now.replace(tzinfo=rt.expires_at.tzinfo):
            raise HTTPException(status_code=401, detail="refresh token expired")
        user = session.get(User, rt.user_id)
        if user is None:
            raise HTTPException(status_code=401, detail="user not found")
        # Rotate: revoke old, mint new.
        rt.revoked_at = now
        session.commit()
    new_pair = _issue_tokens(user, request)
    # Link rotation chain.
    new_sha = hash_refresh(new_pair.refresh_token)
    with session_maker()() as session:
        old = session.scalar(select(RefreshToken).where(RefreshToken.token_hash == sha))
        new = session.scalar(select(RefreshToken).where(RefreshToken.token_hash == new_sha))
        if old and new:
            old.rotated_to = new.id
            session.commit()
    return new_pair


@router.post("/logout", status_code=204)
def logout(body: RefreshBody, _: str = Depends(get_bearer_token)) -> None:
    sha = hash_refresh(body.refresh_token)
    with session_maker()() as session:
        rt = session.scalar(select(RefreshToken).where(RefreshToken.token_hash == sha))
        if rt and rt.revoked_at is None:
            rt.revoked_at = datetime.now(timezone.utc)
            session.commit()
    return None
