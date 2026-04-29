"""Per-user token-bucket rate limiter via Upstash. Soft-fails open if Upstash is down."""

from __future__ import annotations

import logging
import time

from fastapi import HTTPException

from .upstash import upstash

log = logging.getLogger(__name__)


async def check(*, key: str, capacity: int, window_seconds: int) -> None:
    """`capacity` requests allowed per `window_seconds`. Raises 429 on overflow."""
    u = upstash()
    if not u.configured:
        return
    bucket = f"rl:{key}:{int(time.time()) // window_seconds}"
    try:
        n = await u.incr(bucket)
        if n == 1:
            await u.expire(bucket, window_seconds)
    except Exception as e:  # noqa: BLE001
        log.warning("rate-limit check failed open: %s", e)
        return
    if n > capacity:
        raise HTTPException(status_code=429, detail=f"rate limit: {capacity}/{window_seconds}s")
