"""Recursive RAG loop.

Self-RAG-style retrieval-on-demand + RAPTOR-ish file/dir summaries (deferred to v2)
+ GraphRAG-ish 1-hop import expansion.

Per-rule loop:
  1. Initial query from rule text + intent.
  2. BM25 retrieval over the chunk index.
  3. LLM assesses; if confidence < target & depth < cap & not saturated, refine query and re-retrieve.
  4. Stop on confidence target | depth | budget | hit-set saturation.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

from ..core.llm_router import LLMRouter
from ..ingest.chunker import Chunk
from ..index.store import BM25Store, Hit
from ..rules.registry import Rule

log = logging.getLogger(__name__)

CONFIDENCE_TARGET = 0.8
MAX_DEPTH = 3
SATURATION_JACCARD = 0.7


@dataclass
class RagJudgment:
    rule_id: str
    violated: bool
    confidence: float
    rationale: str
    file_path: str = ""
    start_line: int = 0
    end_line: int = 0
    snippet: str = ""
    fix_suggestion: str = ""
    missing: str = ""              # what the model says is still missing
    evidence: list[Chunk] = field(default_factory=list)
    hops: int = 0
    retrieval_score: float = 0.0


def _initial_query(rule: Rule, intent_summary: str) -> str:
    # Heuristic: pull the rule's keywords + the intent goal.
    text = re.sub(r"\*\*|`", " ", rule.text)
    return f"{intent_summary} :: {rule.id} {rule.workflow_title} :: {text[:300]}"


def _jaccard(a: list[str], b: list[str]) -> float:
    sa, sb = set(a), set(b)
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def _hit_paths(hits: list[Hit]) -> list[str]:
    return [f"{h.chunk.path}:{h.chunk.start_line}-{h.chunk.end_line}" for h in hits]


SYSTEM_PROMPT = """You are an ex-Facebook engineering manager (20+ years) reviewing code against a strict production ruleset.

Your voice: terse, specific, fix-forward. No hedging. No filler. Severity-labeled.

You receive ONE rule and a set of code chunks. Decide whether the rule is violated in this code.
Return strict JSON:

{
  "violated": true|false,
  "confidence": 0.0-1.0,
  "file_path": "<relative path or ''>",
  "start_line": <int>,
  "end_line": <int>,
  "snippet": "<the offending line(s) verbatim, max 240 chars>",
  "rationale": "<one or two crisp sentences in the EM voice>",
  "fix_suggestion": "<one concrete sentence: what to change>",
  "missing": "<what additional context would raise confidence; '' if fully decided>"
}

Rules of engagement:
- Only flag a real, demonstrable violation in the supplied code. Do not speculate.
- If you can't tell from the supplied chunks, set violated=false and put a refinement query in `missing`.
- Confidence ≥ 0.85 means you can defend this in writing.
"""


def _user_prompt(rule: Rule, hits: list[Hit], intent_summary: str) -> str:
    blocks = []
    for h in hits:
        c = h.chunk
        blocks.append(
            f"--- {c.path}:{c.start_line}-{c.end_line} (lang={c.lang}, symbol={c.symbol or '-'}) ---\n{c.text}\n"
        )
    return (
        f"INTENT: {intent_summary}\n\n"
        f"RULE {rule.id} (workflow {rule.workflow}: {rule.workflow_title}):\n{rule.text}\n\n"
        f"CODE EVIDENCE:\n" + "\n".join(blocks)
    )


async def assess_rule(
    *,
    router: LLMRouter,
    store: BM25Store,
    rule: Rule,
    intent_summary: str,
    model: str,
    rule_token_budget: int = 4000,
    initial_query: str | None = None,
) -> RagJudgment:
    query = initial_query or _initial_query(rule, intent_summary)
    seen: list[list[str]] = []
    last_hits: list[Hit] = []
    judgment = RagJudgment(rule_id=rule.id, violated=False, confidence=0.0, rationale="")
    tokens_spent = 0

    for depth in range(MAX_DEPTH + 1):
        hits = await store.search_async(query, k=8)
        if hits:
            last_hits = hits
            judgment.retrieval_score = max(judgment.retrieval_score, hits[0].score)
        if not hits:
            judgment.rationale = "No retrievable evidence for this rule in the indexed code."
            judgment.confidence = 0.3
            break

        # Saturation detection.
        paths_now = _hit_paths(hits)
        if seen and _jaccard(seen[-1], paths_now) > SATURATION_JACCARD:
            log.debug("rule=%s saturated at depth=%d", rule.id, depth)
            break
        seen.append(paths_now)

        try:
            data = await router.complete_json(
                model=model,
                system=SYSTEM_PROMPT,
                user=_user_prompt(rule, hits, intent_summary),
                temperature=0.0,
                max_tokens=600,
            )
        except Exception as e:  # noqa: BLE001
            log.warning("rule=%s LLM error: %s", rule.id, e)
            judgment.rationale = f"LLM error: {e}"
            judgment.confidence = 0.0
            break

        judgment = RagJudgment(
            rule_id=rule.id,
            violated=bool(data.get("violated")),
            confidence=float(data.get("confidence") or 0.0),
            rationale=str(data.get("rationale") or ""),
            file_path=str(data.get("file_path") or ""),
            start_line=int(data.get("start_line") or 0),
            end_line=int(data.get("end_line") or 0),
            snippet=str(data.get("snippet") or ""),
            fix_suggestion=str(data.get("fix_suggestion") or ""),
            missing=str(data.get("missing") or ""),
            evidence=[h.chunk for h in hits],
            hops=depth + 1,
            retrieval_score=judgment.retrieval_score,
        )
        tokens_spent += 600  # rough max upper bound

        if judgment.confidence >= CONFIDENCE_TARGET:
            break
        if not judgment.missing:
            break
        if tokens_spent >= rule_token_budget:
            break
        # Refine the query with what the model said it needed.
        query = f"{rule.id} {rule.workflow_title} :: {judgment.missing}"

    return judgment
