# `reviewer` — AI Code Reviewer

A production-grade reviewer that pulls a GitHub repo, walks every branch as a synthesized PR, and applies the 21-workflow / ~200-rule production ruleset (`CODE_REVIEW_RULESET.md`) using Qwen on OpenRouter. Voice fingerprint: terse, specific, fix-forward — written like an ex-Facebook engineering manager.

## Architecture (MVP slice)

```
CLI (typer) ──► Orchestrator
                  │
   ┌──────────────┼─────────────────┬───────────────┐
   ▼              ▼                 ▼               ▼
 Ingest        Static            Intent          Recursive
 (git clone   analyzers       (heuristic +        RAG
 + diffs +    (R2.4 R2.6      LLM enrich)      (Self-RAG +
 PAT API)     R8.4 R9.5                          BM25 +
              R15.2/3/11)                        graph hops)
                  │                 │               │
                  └──── Planner (DAG, budget) ─────┘
                                    │
                       Workflow agents (1 per WF)
                                    │
                       Verifier: self-consistency + critic
                                    │
                            Report (md + json)
```

Persistence is **SQLite** by default for the MVP (Postgres-compatible models). Vector store is in-memory **BM25** (Qdrant ready behind `[qdrant]` extra).

## Quick start

### 1. Install

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e .
```

### 2. Configure

Copy `.env.example` to `.env` and fill in:

```bash
cp .env.example .env
# edit .env — at minimum set OPENROUTER_API_KEY (and GITHUB_TOKEN for private repos)
```

Without `OPENROUTER_API_KEY` the system runs static rules only — useful for the secret-scan / size / TODO / SQL-concat / migration / file-length checks that don't need an LLM.

### 3. Review a repo

```bash
reviewer review https://github.com/souvikroy/real-time-voice-bot --out ./report
```

The CLI:
- clones the repo (mirror + partial blob filter) into `./.reviewer/<owner>__<repo>`
- enumerates branches and computes per-branch diff vs default
- runs the static ruleset (deterministic; no LLM)
- if `OPENROUTER_API_KEY` is set, extracts intent, plans the workflow DAG, runs each workflow agent through the recursive RAG loop, and verifies P0/P1 with self-consistency + adversarial critic
- writes `report/report.md` (human) and `report/findings.json` (machine)
- exits non-zero based on highest severity (`4` = P0, `3` = P1, `2` = P2, `1` = P3, `0` = clean)

### Other commands

```bash
reviewer rules                   # print the rule registry (200+ rules)
reviewer status <job-id>         # status of a previous review
reviewer report <job-id>         # print findings of a previous review
```

## Rule classification

The 200-rule set splits into three buckets at `reviewer/rules/rules_meta.yaml`:

- **`static`** (~40%): regex/AST/tooling. No LLM. Free, deterministic, run first.
- **`llm`** (~30%): irreducibly semantic — judged by a Qwen agent.
- **`hybrid`** (~30%): static pre-filter narrows candidates, LLM verifies. Cuts cost ~3x vs LLM-everywhere.

`reviewer rules` prints the full table.

## Recursive RAG

For each LLM/hybrid rule the reviewer:
1. Builds an initial query from the rule text + intent summary.
2. Hybrid retrieval — BM25 over chunked code, hybrid lexical + (future) embedding.
3. LLM judgment returns `{violated, confidence, missing}`.
4. If `confidence < 0.8` and the model named what's `missing`, the query is rewritten and we retrieve again.
5. Stop on confidence threshold OR depth ≥ 3 OR per-rule token budget OR retrieval saturation (Jaccard > 0.7 across hops).

Every hit set is logged into the finding's `evidence` so reviewers can trace the trail.

## Verifier

P0/P1 findings are rerun with self-consistency (paraphrased prompts, looser temperature) and then handed to the **critic** — a different Qwen variant prompted to *defend* the code. Survivors keep severity; downgraded findings drop one tier; killed findings are dropped.

Final confidence:
```
0.30 * retrieval_score
+ 0.25 * llm_self_report
+ 0.20 * ensemble_agreement
+ 0.15 * static_agreement
+ 0.10 * critic_survival
```

## What's next (v1)

- 21 specialist agents (one per workflow) replacing the unified loop.
- Tree-sitter chunking for TS/JS/Go/Java/Rust (Python today).
- Qdrant + Qwen3-Embedding-8B in place of in-memory BM25.
- Arq queue + Postgres for multi-tenant deployment.
- Semgrep packs covering hybrid rules.
- Eval harness with mutation tests.

See [the plan](./.claude/plans/plan-and-extensive-application-iridescent-pie.md) (or the local copy) for full design.

## Project layout

```
reviewer/
  cli.py                 # Typer entry
  core/                  # config, redactor, llm_router (OpenRouter)
  ingest/                # github_pat, git_extract, chunker
  index/                 # BM25 store (Qdrant adapter pending)
  rag/                   # recursive RAG loop
  intent/                # intent extractor
  planner/               # workflow DAG planner
  agents/                # base reviewer + critic + verifier
  static/                # deterministic analyzers (one per rule_id)
  orchestrator/          # ingest -> static -> intent -> plan -> review -> verify -> report
  persistence/           # SQLAlchemy models + repository
  rules/                 # rule registry + rules_meta.yaml
  report/                # markdown + JSON renderer
```

## Verification

The plan includes a verification ladder (smoke, static parity, golden set, mutation tests, voice check, SLO probe, hallucination probe, idempotency probe) — runs nightly against `souvikroy/real-time-voice-bot`. Harness lives at `eval/harness.py` (stub for now).
