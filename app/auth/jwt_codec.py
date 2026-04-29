"""JWT mint + verify. Module name avoids the PyPI `jwt` shadow."""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass
from typing import Any

import jwt as pyjwt

from ..core.settings import get_app_settings


@dataclass
class TokenPair:
    access_token: str
    refresh_token: str
    access_expires_at: int


def _settings():
    return get_app_settings()


def mint_access_token(*, user_id: str, session_id: str, scope: str = "user") -> tuple[str, int]:
    s = _settings()
    now = int(time.time())
    exp = now + s.jwt_access_ttl_seconds
    payload = {"sub": user_id, "sid": session_id, "scope": scope, "iat": now, "exp": exp}
    return pyjwt.encode(payload, s.jwt_secret, algorithm="HS256"), exp


def mint_event_token(*, user_id: str, job_id: str, ttl_seconds: int = 60) -> str:
    """Short-lived token, used in SSE query string (EventSource can't send headers)."""
    s = _settings()
    now = int(time.time())
    payload = {"sub": user_id, "job_id": job_id, "scope": "events", "iat": now, "exp": now + ttl_seconds}
    return pyjwt.encode(payload, s.jwt_secret, algorithm="HS256")


def verify_token(token: str, *, scope: str = "user") -> dict[str, Any]:
    s = _settings()
    try:
        payload = pyjwt.decode(token, s.jwt_secret, algorithms=["HS256"])
    except pyjwt.PyJWTError as e:
        raise PermissionError(f"invalid token: {e}") from e
    if payload.get("scope") != scope:
        raise PermissionError("token scope mismatch")
    return payload


def new_refresh_token() -> tuple[str, str]:
    """Returns (token_plain, token_sha256_hex)."""
    import hashlib
    raw = secrets.token_urlsafe(48)
    return raw, hashlib.sha256(raw.encode()).hexdigest()


def hash_refresh(token: str) -> str:
    import hashlib
    return hashlib.sha256(token.encode()).hexdigest()
