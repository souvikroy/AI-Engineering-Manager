"""Internal provider — internal tickets are the source of truth; nothing to push."""

from __future__ import annotations

from typing import Optional

from .base import ExternalRef


class InternalProvider:
    name = "internal"

    def create(self, ticket) -> Optional[ExternalRef]:
        return None

    def update_status(self, ticket, new_status: str) -> None:
        return None
