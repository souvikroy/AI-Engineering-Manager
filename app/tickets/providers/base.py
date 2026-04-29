"""TicketProvider Protocol — internal-only today, swappable to Jira in Phase 2."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Protocol


@dataclass(frozen=True)
class ExternalRef:
    provider: str
    key: str
    url: str


class TicketProvider(Protocol):
    name: str

    def create(self, ticket) -> Optional[ExternalRef]:
        """Push a new ticket to the external system. Return ref, or None for internal-only."""

    def update_status(self, ticket, new_status: str) -> None:
        """Sync a status transition to the external system."""
