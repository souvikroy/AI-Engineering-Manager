"""OpenRouter client: model routing, token meter, retries, IO logging, redaction.

Every LLM call in the system goes through `LLMRouter.complete(...)`.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from typing import Any

import httpx
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_random_exponential,
)

from .config import Settings, get_settings
from .redactor import redact, redact_dict

log = logging.getLogger(__name__)

# OpenRouter pricing (USD per 1M tokens) — keep coarse, refresh quarterly.
# Falls back to a conservative default if the model is unknown.
PRICE_TABLE: dict[str, tuple[float, float]] = {
    # in_per_1m, out_per_1m
    "qwen/qwen3-coder":                       (0.20, 0.80),
    "qwen/qwen-2.5-coder-32b-instruct":       (0.07, 0.28),
    "qwen/qwen3-32b":                         (0.10, 0.30),
    "qwen/qwen3-embedding-8b":                (0.05, 0.05),
}
DEFAULT_PRICE = (0.30, 1.00)


@dataclass
class LLMResult:
    text: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    usd: float
    raw: dict[str, Any]


class BudgetExceeded(RuntimeError):
    pass


class LLMRouter:
    def __init__(self, settings: Settings | None = None) -> None:
        self.s = settings or get_settings()
        self._spent_usd: float = 0.0
        self._spent_tokens: int = 0
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.s.openrouter_base_url,
                headers={
                    "Authorization": f"Bearer {self.s.openrouter_api_key}",
                    "HTTP-Referer": "https://github.com/souvikroy/ai-code-review",
                    "X-Title": "reviewer",
                },
                timeout=httpx.Timeout(120.0, connect=15.0),
            )
        return self._client

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    @property
    def spent_usd(self) -> float:
        return self._spent_usd

    @property
    def spent_tokens(self) -> int:
        return self._spent_tokens

    def _check_budget(self) -> None:
        if self._spent_usd >= self.s.budget_usd:
            raise BudgetExceeded(f"USD budget exhausted: spent ${self._spent_usd:.4f}")
        if self._spent_tokens >= self.s.budget_tokens:
            raise BudgetExceeded(f"token budget exhausted: spent {self._spent_tokens}")

    @retry(
        retry=retry_if_exception_type((httpx.HTTPStatusError, httpx.TransportError)),
        wait=wait_random_exponential(multiplier=0.5, max=30),
        stop=stop_after_attempt(5),
        reraise=True,
    )
    async def _post(self, payload: dict[str, Any]) -> dict[str, Any]:
        client = await self._get_client()
        r = await client.post("/chat/completions", json=payload)
        if r.status_code == 429 or r.status_code >= 500:
            r.raise_for_status()
        if r.status_code >= 400:
            log.error("OpenRouter %s: %s", r.status_code, r.text[:500])
            r.raise_for_status()
        return r.json()

    async def complete(
        self,
        *,
        model: str,
        system: str,
        user: str,
        json_mode: bool = False,
        temperature: float = 0.0,
        max_tokens: int = 1024,
    ) -> LLMResult:
        if not self.s.llm_enabled:
            raise RuntimeError("OPENROUTER_API_KEY is not set; LLM call refused.")
        self._check_budget()

        # Redact before the wire.
        sys_clean = redact(system)
        usr_clean = redact(user)

        payload: dict[str, Any] = {
            "model": model,
            "messages": [
                {"role": "system", "content": sys_clean},
                {"role": "user", "content": usr_clean},
            ],
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}

        t0 = time.perf_counter()
        data = await self._post(payload)
        elapsed = time.perf_counter() - t0

        usage = data.get("usage", {}) or {}
        pin = int(usage.get("prompt_tokens") or 0)
        pout = int(usage.get("completion_tokens") or 0)
        in_price, out_price = PRICE_TABLE.get(model, DEFAULT_PRICE)
        usd = (pin * in_price + pout * out_price) / 1_000_000.0

        self._spent_usd += usd
        self._spent_tokens += pin + pout

        text = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        log.info(
            "llm model=%s in=%d out=%d usd=%.5f elapsed=%.2fs",
            model, pin, pout, usd, elapsed,
        )
        return LLMResult(
            text=text,
            model=model,
            prompt_tokens=pin,
            completion_tokens=pout,
            usd=usd,
            raw=redact_dict(data),
        )

    async def complete_json(self, *, model: str, system: str, user: str,
                            schema_hint: str = "", **kw) -> dict:
        """Complete and parse JSON. Falls back to extracting first JSON object on bad output."""
        sys = system + ("\n\nReturn ONLY valid JSON. " + schema_hint if schema_hint else "")
        res = await self.complete(model=model, system=sys, user=user, json_mode=True, **kw)
        try:
            return json.loads(res.text)
        except json.JSONDecodeError:
            # Recovery: find the first {...} block.
            start = res.text.find("{")
            end = res.text.rfind("}")
            if start != -1 and end != -1 and end > start:
                return json.loads(res.text[start : end + 1])
            raise
