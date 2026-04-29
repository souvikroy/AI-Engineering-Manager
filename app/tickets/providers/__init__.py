"""Provider factory — defaults to internal; Jira opt-in via env in Phase 2."""

from __future__ import annotations

from .base import ExternalRef, TicketProvider  # noqa: F401  (re-export)
from .internal import InternalProvider


def get_provider(name: str = "internal") -> TicketProvider:
    if name == "internal":
        return InternalProvider()
    if name == "jira":
        # Phase 2: read env vars, instantiate JiraProvider. Until then, fall back.
        return InternalProvider()
    raise ValueError(f"unknown ticket provider: {name}")
