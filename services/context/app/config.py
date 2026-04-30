"""Service configuration loaded from environment."""
from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-driven settings for the context service.

    Loaded from process env or `.env` file; never log this object directly.
    """

    model_config = SettingsConfigDict(env_file=".env", env_prefix="", extra="ignore")

    # Core
    database_url: str = Field(
        default="postgresql+asyncpg://aiem:aiem@postgres:5432/aiem",
        description="Postgres connection (asyncpg driver). Schema 'rag' is owned by this service.",
    )
    rag_schema: str = Field(default="rag")
    workspace_id: str | None = Field(default=None, description="Phase-1 single-tenant workspace.")

    # Embeddings
    voyage_api_key: str | None = None
    embedding_model: str = "voyage-3"
    embedding_dim: int = 1024
    embedding_version: str = "v1"

    # Anthropic (used for L1/L2/L3 summarization + entity extraction)
    anthropic_api_key: str | None = None
    anthropic_model_fast: str = "claude-haiku-4-5"
    anthropic_model_reasoning: str = "claude-opus-4-5"

    # Source credentials (only present once an integration is wired)
    slack_bot_token: str | None = None
    slack_signing_secret: str | None = None
    jira_base_url: str | None = None
    jira_pat: str | None = None
    jira_email: str | None = None
    sentry_auth_token: str | None = None
    sentry_org: str | None = None
    confluence_base_url: str | None = None
    confluence_pat: str | None = None
    notion_token: str | None = None
    google_service_account_json: str | None = None
    linear_api_key: str | None = None
    github_pat: str | None = None

    # Observability
    sentry_dsn_self: str | None = Field(
        default=None, description="Sentry DSN for monitoring this service itself."
    )
    log_level: str = "INFO"

    # Budgets
    retrieval_token_budget: int = 8000
    chat_context_budget: int = 32000
    rerank_top_k: int = 10
    hybrid_candidate_k: int = 50


@lru_cache
def get_settings() -> Settings:
    """Cached settings accessor — read once per process."""
    return Settings()
