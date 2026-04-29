"""Pydantic-settings config. Loads .env and environment variables."""

from __future__ import annotations

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # GitHub
    github_token: str = Field(default="", alias="GITHUB_TOKEN")

    # OpenRouter
    openrouter_api_key: str = Field(default="", alias="OPENROUTER_API_KEY")
    openrouter_base_url: str = Field(default="https://openrouter.ai/api/v1", alias="OPENROUTER_BASE_URL")

    # Models
    model_planner: str = Field(default="qwen/qwen3-coder", alias="REVIEWER_MODEL_PLANNER")
    model_heavy: str = Field(default="qwen/qwen3-coder", alias="REVIEWER_MODEL_HEAVY")
    model_light: str = Field(default="qwen/qwen-2.5-coder-32b-instruct", alias="REVIEWER_MODEL_LIGHT")
    model_critic: str = Field(default="qwen/qwen3-32b", alias="REVIEWER_MODEL_CRITIC")
    model_embed: str = Field(default="qwen/qwen3-embedding-8b", alias="REVIEWER_MODEL_EMBED")

    # Storage
    database_url: str = Field(default="", alias="DATABASE_URL")
    db_url_legacy: str = Field(default="sqlite:///./reviewer.db", alias="REVIEWER_DB_URL")
    vector_backend: str = Field(default="memory", alias="REVIEWER_VECTOR_BACKEND")
    qdrant_url: str = Field(default="http://localhost:6333", alias="QDRANT_URL")

    # Upstash Redis
    upstash_url: str = Field(default="", alias="UPSTASH_REDIS_REST_URL")
    upstash_token: str = Field(default="", alias="UPSTASH_REDIS_REST_TOKEN")

    # QStash (optional)
    qstash_token: str = Field(default="", alias="QSTASH_TOKEN")
    qstash_current_signing_key: str = Field(default="", alias="QSTASH_CURRENT_SIGNING_KEY")
    qstash_next_signing_key: str = Field(default="", alias="QSTASH_NEXT_SIGNING_KEY")
    worker_public_url: str = Field(default="http://localhost:8000", alias="WORKER_PUBLIC_URL")
    internal_hmac_secret: str = Field(default="", alias="INTERNAL_HMAC_SECRET")

    # Pinecone
    pinecone_api_key: str = Field(default="", alias="PINECONE_API_KEY")
    pinecone_index: str = Field(default="reviewer-prod", alias="PINECONE_INDEX")

    # Auth
    jwt_secret: str = Field(default="", alias="JWT_SECRET")
    jwt_access_ttl_seconds: int = Field(default=900, alias="JWT_ACCESS_TTL_SECONDS")
    refresh_token_ttl_days: int = Field(default=30, alias="REFRESH_TOKEN_TTL_DAYS")
    fernet_key: str = Field(default="", alias="FERNET_KEY")
    fernet_key_secondary: str = Field(default="", alias="FERNET_KEY_SECONDARY")

    # CORS / role
    # Dev-friendly default: allow Vite's port hopping.
    # Production should set ALLOWED_ORIGINS explicitly.
    allowed_origins: str = Field(
        default="http://localhost:5173,http://127.0.0.1:5173",
        alias="ALLOWED_ORIGINS",
    )
    cors_allow_origin_regex: str = Field(
        default=r"^http://(localhost|127\.0\.0\.1):\d+$",
        alias="CORS_ALLOW_ORIGIN_REGEX",
    )
    role: str = Field(default="web", alias="ROLE")

    @property
    def db_url(self) -> str:
        """Prefer DATABASE_URL (Postgres). Fall back to legacy REVIEWER_DB_URL (SQLite)."""
        if self.database_url and not self.database_url.startswith("$"):
            return self.database_url
        return self.db_url_legacy

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    # Budgets
    budget_usd: float = Field(default=10.0, alias="REVIEWER_BUDGET_USD")
    budget_tokens: int = Field(default=2_000_000, alias="REVIEWER_BUDGET_TOKENS")

    # Working dir
    work_dir: Path = Field(default=Path("./.reviewer"), alias="REVIEWER_WORK_DIR")

    @property
    def llm_enabled(self) -> bool:
        return bool(self.openrouter_api_key)

    @property
    def github_authed(self) -> bool:
        return bool(self.github_token)


def get_settings() -> Settings:
    return Settings()
