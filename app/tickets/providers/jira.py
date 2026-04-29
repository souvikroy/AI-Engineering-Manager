"""Phase 2 stub — wire to a real Jira host + project mapping later.

Intentionally raises if instantiated. The provider factory falls back to
InternalProvider when Jira is not configured.
"""

from __future__ import annotations

from typing import Optional

from .base import ExternalRef


class JiraProvider:
    name = "jira"

    def __init__(self, *, host: str = "", token: str = "", project_key: str = ""):
        if not (host and token and project_key):
            raise NotImplementedError(
                "Jira provider not configured. Phase 2: wire JIRA_HOST / JIRA_TOKEN / JIRA_PROJECT_KEY."
            )
        self.host = host
        self.token = token
        self.project_key = project_key

    def create(self, ticket) -> Optional[ExternalRef]:  # pragma: no cover - Phase 2
        raise NotImplementedError("JiraProvider.create is Phase 2.")

    def update_status(self, ticket, new_status: str) -> None:  # pragma: no cover - Phase 2
        raise NotImplementedError("JiraProvider.update_status is Phase 2.")
