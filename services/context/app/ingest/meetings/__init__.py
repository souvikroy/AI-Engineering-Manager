"""Meeting-transcript provider registry.

Each provider is a `MeetingProviderAdapter` subclass — see `base.py`. Add new
providers here and they're immediately reachable via `/ingest/meetings/{provider}`.
"""
from __future__ import annotations

from .base import MeetingProviderAdapter, _ingest_transcript
from .fireflies import Fireflies

PROVIDERS: dict[str, MeetingProviderAdapter] = {
    "fireflies": Fireflies(),
    # Phase-1 stubs — adapters land alongside this file:
    # "readai":   ReadAI(),
    # "otter":    Otter(),
    # "grain":    Grain(),
    # "tldv":     Tldv(),
}

__all__ = ["PROVIDERS", "MeetingProviderAdapter", "_ingest_transcript"]
