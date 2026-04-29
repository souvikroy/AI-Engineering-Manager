"""Upstash Redis REST client. Async, minimal — only what we need.

Endpoints used:
- INCR / EXPIRE for rate limits.
- XADD / XREAD for the event bus.
- SET/GET for idempotency.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

import httpx

from ..core.settings import get_app_settings

log = logging.getLogger(__name__)


class UpstashError(RuntimeError):
    pass


class UpstashClient:
    def __init__(self) -> None:
        s = get_app_settings()
        self._base = s.upstash_url.rstrip("/")
        self._token = s.upstash_token
        self._client: Optional[httpx.AsyncClient] = None

    @property
    def configured(self) -> bool:
        return bool(self._base and self._token)

    async def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self._base,
                headers={"Authorization": f"Bearer {self._token}"},
                timeout=httpx.Timeout(30.0, connect=10.0),
            )
        return self._client

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def cmd(self, *args: Any) -> Any:
        """Invoke a single Redis command via Upstash REST.

        Pass each argument as a separate positional value: cmd("SET", "k", "v", "EX", 60).
        """
        if not self.configured:
            raise UpstashError("Upstash not configured")
        c = await self._http()
        # Upstash REST supports POST / with a JSON array of args.
        body = [str(a) if not isinstance(a, (bytes,)) else a.decode() for a in args]
        r = await c.post("/", json=body)
        if r.status_code >= 400:
            raise UpstashError(f"upstash {r.status_code}: {r.text[:200]}")
        data = r.json()
        if "error" in data:
            raise UpstashError(data["error"])
        return data.get("result")

    # ---- Convenience ----

    async def incr(self, key: str) -> int:
        return int(await self.cmd("INCR", key))

    async def expire(self, key: str, seconds: int) -> int:
        return int(await self.cmd("EXPIRE", key, seconds))

    async def set_ex(self, key: str, value: str, seconds: int) -> Any:
        return await self.cmd("SET", key, value, "EX", seconds)

    async def get(self, key: str) -> Optional[str]:
        return await self.cmd("GET", key)

    async def xadd(self, stream: str, fields: dict[str, Any], *, maxlen: int = 1000) -> str:
        args: list[Any] = ["XADD", stream, "MAXLEN", "~", str(maxlen), "*"]
        for k, v in fields.items():
            args.append(k)
            args.append(json.dumps(v) if not isinstance(v, str) else v)
        return await self.cmd(*args)

    async def xread_block(self, stream: str, last_id: str = "$", *, block_ms: int = 25000, count: int = 50) -> list[Any]:
        try:
            return await self.cmd("XREAD", "BLOCK", str(block_ms), "COUNT", str(count), "STREAMS", stream, last_id)
        except UpstashError as e:
            log.warning("xread error: %s", e)
            return []

    async def xrange(self, stream: str, start: str = "-", end: str = "+", *, count: int = 200) -> list[Any]:
        return await self.cmd("XRANGE", stream, start, end, "COUNT", str(count)) or []


_singleton: Optional[UpstashClient] = None


def upstash() -> UpstashClient:
    global _singleton
    if _singleton is None:
        _singleton = UpstashClient()
    return _singleton
