"""Bcrypt password hashing."""

from __future__ import annotations

import bcrypt

ROUNDS = 12


def hash_password(plain: str) -> str:
    if len(plain) < 12:
        raise ValueError("password must be at least 12 characters")
    salt = bcrypt.gensalt(rounds=ROUNDS)
    return bcrypt.hashpw(plain.encode("utf-8"), salt).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False
