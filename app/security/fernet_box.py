"""Fernet wrapper for at-rest PAT encryption with rotation support."""

from __future__ import annotations

from cryptography.fernet import Fernet, MultiFernet

from ..core.settings import get_app_settings


def _box() -> MultiFernet:
    s = get_app_settings()
    if not s.fernet_key:
        raise RuntimeError("FERNET_KEY is not configured")
    keys = [Fernet(s.fernet_key.encode())]
    if s.fernet_key_secondary:
        keys.append(Fernet(s.fernet_key_secondary.encode()))
    return MultiFernet(keys)


def encrypt(plaintext: str) -> bytes:
    return _box().encrypt(plaintext.encode("utf-8"))


def decrypt(ciphertext: bytes) -> str:
    return _box().decrypt(ciphertext).decode("utf-8")


def rotate(ciphertext: bytes) -> bytes:
    """Re-encrypt with the primary key. Used when rotating FERNET_KEY → SECONDARY."""
    return _box().rotate(ciphertext)
