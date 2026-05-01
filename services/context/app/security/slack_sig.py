"""Slack request-signature verification.

Implements the Slack v0 signing scheme:

    sig_basestring = b"v0:" + timestamp.encode() + b":" + raw_body
    expected       = "v0=" + hmac_sha256(SLACK_SIGNING_SECRET, sig_basestring)

We require the timestamp to be within ±5 minutes of "now" to defeat replay.
Constant-time comparison via `hmac.compare_digest`.

This module deliberately has NO web-framework imports at module load — the
pure `_verify_signature()` function is unit-tested without FastAPI installed.
The FastAPI dependency `verify_slack_request` is in `slack_dep.py`.
"""
from __future__ import annotations

import hashlib
import hmac
import time

REPLAY_WINDOW_SEC = 60 * 5


def _verify_signature(*, secret: str, timestamp: str, body: bytes, signature: str) -> bool:
    try:
        ts_int = int(timestamp)
    except (TypeError, ValueError):
        return False
    if abs(time.time() - ts_int) > REPLAY_WINDOW_SEC:
        return False
    base = b"v0:" + timestamp.encode("utf-8") + b":" + body
    digest = hmac.new(secret.encode("utf-8"), base, hashlib.sha256).hexdigest()
    expected = "v0=" + digest
    return hmac.compare_digest(expected, signature)
