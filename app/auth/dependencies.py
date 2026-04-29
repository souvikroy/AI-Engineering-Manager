"""FastAPI dependencies for current-user resolution."""

from __future__ import annotations

from typing import Optional

from fastapi import Depends, Header, HTTPException, status

from reviewer.persistence.models import User, session_maker

from .jwt_codec import verify_token


def get_bearer_token(authorization: Optional[str] = Header(default=None)) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing bearer token")
    return authorization.split(" ", 1)[1]


def current_user_id(token: str = Depends(get_bearer_token)) -> str:
    try:
        payload = verify_token(token, scope="user")
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e)) from e
    return str(payload["sub"])


def current_user(uid: str = Depends(current_user_id)) -> User:
    with session_maker()() as s:
        u = s.get(User, uid)
        if u is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="user not found")
        return u
