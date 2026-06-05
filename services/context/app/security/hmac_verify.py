"""Generic HMAC-SHA256 webhook verification, used across meeting providers.

Constant-time comparison via `hmac.compare_digest`. The pure functions in this
module have no web-framework imports, so they're unit-testable without FastAPI.

Provider variations the helper covers:
- `verify_hmac_sha256(secret, body, header)` — header is plain hex digest.
- `verify_hmac_sha256(..., prefix="sha256=")` — header is `sha256=<hex>`.
- `verify_bearer(secret, header)` — header is `Bearer <secret>` (Read.ai style).
"""
from __future__ import annotations

import hashlib
import hmac


def hmac_sha256_hex(secret: str, body: bytes) -> str:
    """Compute the lowercase hex digest of HMAC-SHA256(secret, body)."""
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


def verify_hmac_sha256(
    secret: str,
    body: bytes,
    header_value: str | None,
    *,
    prefix: str = "",
) -> bool:
    """Constant-time-compare a webhook signature header against HMAC-SHA256(body).

    `prefix` lets callers pass `"sha256="` (Otter/Grain) or `""` (Fireflies plain hex).
    """
    if not secret or not header_value:
        return False
    expected = prefix + hmac_sha256_hex(secret, body)
    return hmac.compare_digest(expected, header_value.strip())


def verify_bearer(secret: str, header_value: str | None) -> bool:
    """Match `Authorization: Bearer <secret>` (used by Read.ai webhooks)."""
    if not secret or not header_value:
        return False
    expected = f"Bearer {secret}"
    return hmac.compare_digest(expected, header_value.strip())
