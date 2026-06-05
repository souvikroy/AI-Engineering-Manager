"""FastAPI dependency that wraps Slack signature verification.

Kept separate from `slack_sig.py` so the pure verifier can be unit-tested
without a FastAPI install (saves CI minutes and keeps test deps tight).
"""
from __future__ import annotations

import logging

from fastapi import Header, HTTPException, Request

from ..config import get_settings
from .slack_sig import _verify_signature

log = logging.getLogger(__name__)


async def verify_slack_request(
    request: Request,
    x_slack_request_timestamp: str | None = Header(default=None),
    x_slack_signature: str | None = Header(default=None),
) -> bytes:
    """FastAPI dependency. Returns the raw body so handlers can re-parse it."""
    settings = get_settings()
    body = await request.body()

    secret = settings.slack_signing_secret
    if not secret:
        log.warning("slack.sig.missing_secret — allowing request (dev only)")
        return body

    if not x_slack_request_timestamp or not x_slack_signature:
        raise HTTPException(401, "missing slack signature headers")

    if not _verify_signature(
        secret=secret,
        timestamp=x_slack_request_timestamp,
        body=body,
        signature=x_slack_signature,
    ):
        raise HTTPException(401, "invalid slack signature")
    return body
