"""PII redaction at ingest time.

Strips emails, phone numbers, OTP-shaped tokens, and credit-card-ish numbers.
Replaces Slack `@U…` mentions with their canonical engineer ids if available,
otherwise leaves a stable placeholder so retrieval can still match by entity.

Run BEFORE chunking + embedding so secrets never enter the vector store.
"""
from __future__ import annotations

import re
from typing import Awaitable, Callable

EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")
PHONE_RE = re.compile(r"\b(?:\+?\d{1,3}[\s-])?\(?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}\b")
OTP_RE = re.compile(r"\b\d{6}\b")
CC_RE = re.compile(r"\b(?:\d[ -]*?){13,19}\b")
SLACK_MENTION_RE = re.compile(r"<@(U[A-Z0-9]+)>")
BEARER_RE = re.compile(r"\b(?:sk|pk|xoxb|xoxp|ghp|ghs|ghu|AKIA)[A-Za-z0-9_\-]{8,}\b")


def redact_basic(text: str) -> str:
    text = EMAIL_RE.sub("[email]", text)
    text = PHONE_RE.sub("[phone]", text)
    text = CC_RE.sub("[card]", text)
    text = OTP_RE.sub("[otp]", text)
    text = BEARER_RE.sub("[secret]", text)
    return text


async def redact_with_mentions(
    text: str,
    *,
    resolve_slack: Callable[[str], Awaitable[str | None]] | None = None,
) -> str:
    """`resolve_slack(provider_id) -> entity_id?` lets us swap U… for canonical ids."""
    text = redact_basic(text)
    if resolve_slack is not None:
        async def _replace_async(match: re.Match[str]) -> str:
            slack_id = match.group(1)
            entity = await resolve_slack(slack_id)
            return f"@{entity}" if entity else f"@slack:{slack_id}"

        # re.sub doesn't accept async repl, do it manually
        out_parts: list[str] = []
        last = 0
        for m in SLACK_MENTION_RE.finditer(text):
            out_parts.append(text[last : m.start()])
            out_parts.append(await _replace_async(m))
            last = m.end()
        out_parts.append(text[last:])
        return "".join(out_parts)
    return SLACK_MENTION_RE.sub(lambda m: f"@slack:{m.group(1)}", text)
