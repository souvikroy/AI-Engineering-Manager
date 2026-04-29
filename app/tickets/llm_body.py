"""LLM-driven Jira ticket body generation.

We hand the model the **deterministic template** as a strict structural skeleton,
plus the raw finding facts. The model fills sections with engineering-grade prose
(richer Description, Steps to Reproduce, Acceptance Criteria) while preserving
the section headers and Markdown structure exactly.

Routes through the existing `LLMRouter` → OpenRouter → Qwen models configured
in `.env`. Falls back to the deterministic template on any failure.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

from reviewer.core.config import get_settings
from reviewer.core.llm_router import LLMRouter

from .template import render_template_body

log = logging.getLogger(__name__)


SYSTEM_PROMPT = """You are a senior engineering manager writing a high-quality Jira ticket.
You will be given:
1. A SKELETON: a Markdown Jira ticket template pre-filled with raw facts.
2. The original finding fields (rule, severity, file, lines, rationale, fix, code snippet).

Your job:
- Return a Markdown ticket with the **same section headers and order** as the SKELETON.
- Improve the prose: clearer Description, concrete Steps to Reproduce, sharper Acceptance Criteria (Given/When/Then where natural), real Risks & Edge Cases.
- Keep all factual fields (file path, lines, rule id, severity, branch) IDENTICAL to the SKELETON. Do NOT invent files, line numbers, services, or owners.
- Keep the code snippet block intact (verbatim).
- Length: produce a thorough ticket but do not pad — every line should add value to an engineer who has to fix it.
- Output: ONLY the Markdown ticket body. No preamble, no explanation, no triple-backtick wrapper around the whole thing.
"""


def _build_user_prompt(*, skeleton: str, rule_id: str, severity: str, file_path: str,
                       start_line: int, end_line: int, branch: str, rationale: str,
                       fix_suggestion: str, snippet: str, confidence: float, key: str) -> str:
    return f"""SKELETON (preserve all section headers; rewrite prose; keep facts):

{skeleton}

---
ORIGINAL FINDING FACTS:
- ticket_key: {key}
- rule_id: {rule_id}
- severity: {severity}
- file_path: {file_path}
- lines: {start_line}-{end_line}
- branch: {branch or "(default)"}
- confidence: {confidence:.2f}
- rationale: {rationale or "(none)"}
- fix_suggestion: {fix_suggestion or "(none)"}
- code_snippet: |
{snippet or "(none)"}

Return the improved Markdown ticket now."""


async def generate_body(
    *,
    router: LLMRouter,
    key: str,
    repo_url: str,
    rule_id: str,
    severity: str,
    file_path: str,
    start_line: int,
    end_line: int,
    branch: str,
    rationale: str,
    fix_suggestion: str,
    snippet: str,
    confidence: float,
    workflow: Optional[int] = None,
    timeout_seconds: float = 25.0,
) -> tuple[str, str]:
    """Return (body, source) where source is "llm" on success or "template" on fallback."""
    skeleton = render_template_body(
        key=key, repo_url=repo_url, rule_id=rule_id, severity=severity,
        file_path=file_path, start_line=start_line, end_line=end_line,
        branch=branch, rationale=rationale, fix_suggestion=fix_suggestion,
        snippet=snippet, confidence=confidence, workflow=workflow,
    )

    s = get_settings()
    if not s.llm_enabled:
        return skeleton, "template"

    try:
        result = await asyncio.wait_for(
            router.complete(
                model=s.model_heavy,
                system=SYSTEM_PROMPT,
                user=_build_user_prompt(
                    skeleton=skeleton, key=key, rule_id=rule_id, severity=severity,
                    file_path=file_path, start_line=start_line, end_line=end_line,
                    branch=branch, rationale=rationale, fix_suggestion=fix_suggestion,
                    snippet=snippet, confidence=confidence,
                ),
                temperature=0.2,
                max_tokens=2200,
            ),
            timeout=timeout_seconds,
        )
    except asyncio.TimeoutError:
        log.warning("ticket-body LLM timed out for %s; falling back to template", key)
        return skeleton, "template"
    except Exception:  # noqa: BLE001
        log.exception("ticket-body LLM failed for %s; falling back to template", key)
        return skeleton, "template"

    body = (result.text or "").strip()
    if not body or "## " not in body:
        # Model returned empty or unstructured output — keep the deterministic skeleton.
        log.warning("ticket-body LLM returned empty/unstructured output for %s; using template", key)
        return skeleton, "template"
    return body, "llm"
