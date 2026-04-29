"""Re-export the existing reviewer settings for the API layer.

Centralizes access so app.* code doesn't reach into reviewer.* directly for config.
"""

from __future__ import annotations

from functools import lru_cache

from reviewer.core.config import Settings, get_settings


@lru_cache(maxsize=1)
def get_app_settings() -> Settings:
    return get_settings()
