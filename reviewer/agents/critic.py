"""Adversarial critic — defends the code; downgrades unrebutted findings.

A finding survives if the critic cannot mount a plausible defense from the supplied evidence.
"""

from __future__ import annotations

import logging

from ..core.llm_router import LLMRouter
from .base import AgentFinding

log = logging.getLogger(__name__)

CRITIC_SYSTEM = """You are an adversarial code reviewer. Your job is to DEFEND the code against a flagged finding.

You receive a finding (rule, file:line, snippet, rationale) and the surrounding evidence. You will:
- Find the strongest plausible reason the finding is wrong, overstated, or already mitigated.
- If you cannot find one, say so.

Return strict JSON:
{"defense": "<one short sentence; '' if none>", "kill": true|false, "downgrade": true|false, "confidence": 0..1}

`kill=true` means the finding is wrong or completely covered elsewhere.
`downgrade=true` means the finding has merit but isn't blocking.
Both true is invalid; pick the strongest signal.
"""


async def critique(
    finding: AgentFinding,
    *,
    router: LLMRouter,
    model: str,
) -> AgentFinding:
    user = (
        f"FINDING:\n"
        f"rule_id={finding.rule_id} severity={finding.severity}\n"
        f"file={finding.file_path}:{finding.start_line}-{finding.end_line}\n"
        f"snippet:\n{finding.snippet}\n\n"
        f"rationale: {finding.rationale}\n\n"
        f"EVIDENCE CHUNKS: {', '.join(finding.evidence_chunks) or '(none)'}\n"
        f"Defend the code or concede."
    )
    try:
        data = await router.complete_json(model=model, system=CRITIC_SYSTEM, user=user, temperature=0.1, max_tokens=300)
    except Exception as e:  # noqa: BLE001
        log.warning("critic crashed for %s: %s", finding.rule_id, e)
        finding.critic_outcome = "not_run"
        return finding

    if data.get("kill"):
        finding.critic_outcome = "killed"
        finding.confidence = max(0.0, finding.confidence - 0.4)
    elif data.get("downgrade"):
        finding.critic_outcome = "downgraded"
        finding.confidence = max(0.0, finding.confidence - 0.2)
        finding.severity = _downgrade(finding.severity)
    else:
        finding.critic_outcome = "survived"
    return finding


def _downgrade(sev: str) -> str:
    return {"P0": "P1", "P1": "P2", "P2": "P3", "P3": "P3"}.get(sev, sev)
