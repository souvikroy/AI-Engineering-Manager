# CTO Brain

Engineering-management copilot built around Claude. Two halves:

- **Next.js + TypeScript** ([src/](src/)) — UI, chat orchestration (Anthropic tool-use loop), Prisma-backed app data, GitHub PR review.
- **Python context engine** ([services/context/](services/context/)) — recursive RAG over Slack / Jira / Sentry / Confluence / Notion / Sheets / GitHub. Owns the `rag.*` Postgres schema.

Both halves share one Postgres+pgvector database, but with strict schema ownership: TS owns `app.*`, Python owns `rag.*`. They communicate only over HTTP; the Python URL is `PYTHON_CONTEXT_URL` (default `http://localhost:8000`).

## Run locally

### 1. Bring up Postgres + the Python context engine

```bash
docker compose up --build
```

This starts:
- `postgres` — pgvector-enabled Postgres on `:5432`
- `context` — FastAPI on `:8000`, runs `alembic upgrade head` at startup so the `rag` schema is ready

Once up:
```bash
curl http://localhost:8000/healthz   # liveness
curl http://localhost:8000/readyz    # confirms pgvector + rag schema
```

### 2. Bring up Next.js

```bash
cp .env.example .env
# Fill in ANTHROPIC_API_KEY at minimum.
# (Phase 1 keeps the TS app on SQLite by default; flip to Postgres when ready.)

npm install
npx prisma migrate dev      # idempotent — creates dev.db + tables
npm run db:seed             # mock data
npm run dev                 # http://localhost:3000
```

Set any of these to graduate from mock to live:
- `JIRA_BASE_URL`, `JIRA_PAT`, `JIRA_EMAIL` → live Jira adapter
- `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` → live Sentry adapter
- `GITHUB_PAT`, `GITHUB_REPO` → live PR review (already wired)

The console logs which adapters are live vs mock at startup.

### 3. End-to-end smoke

```bash
./scripts/e2e-smoke.sh
```

This script seeds one document into the Python service via `/ingest/text`,
triggers an L1 summary, runs a `/search`, then asks the Next.js chat a
question and prints the answer with citations.

## Architecture

See [the approved plan](.claude/plans/now-plan-for-integrate-optimized-squid.md) for the full design — recursive RAG, hierarchical summaries, identity resolution, phasing.

```
┌─────────────────────────────────────┐         ┌──────────────────────────────────┐
│  Next.js (TypeScript)               │         │  Python context engine           │
│  • UI                               │  HTTP   │  • FastAPI                        │
│  • Chat tool-call loop              │ ◀─────▶ │  • Ingest pipelines               │
│  • Prisma (app schema)              │         │  • Hybrid retrieval               │
│  • Live adapters: GitHub / Jira /   │         │  • L1/L2/L3 summary jobs          │
│    Sentry (env-gated, mock fallback)│         │  • Recursive overflow valve       │
└────────┬────────────────────────────┘         └──────────────┬───────────────────┘
         │                                                     │
         │ Prisma (schema=app)          asyncpg + pgvector     │
         │                              SQLAlchemy + Alembic   │
         │                              (schema=rag)           │
         └──────────────────┬──────────────────────────────────┘
                            ▼
                ┌────────────────────────┐
                │  Postgres + pgvector   │
                │  schemas: app, rag     │
                └────────────────────────┘
```

## Tests

```bash
# TS — vitest, no infra needed
npm test

# Python — pytest, pure-function tests run without DB
cd services/context && pytest tests/test_chunk_redact.py tests/test_eval_golden.py
```

## Layout

| Path | Purpose |
|---|---|
| [src/app/](src/app/) | Next.js pages + API routes |
| [src/lib/chat/](src/lib/chat/) | Tool definitions + provenance verifier |
| [src/lib/python.ts](src/lib/python.ts) | Typed HTTP client over the Python service |
| [src/lib/adapters/](src/lib/adapters/) | Live + mock adapters (Jira / Sentry / Slack / GitHub / Standups) |
| [src/lib/modules/](src/lib/modules/) | Higher-level features (daily-brief, people-intel, PR review, …) |
| [services/context/app/](services/context/app/) | Python FastAPI service |
| [services/context/migrations/](services/context/migrations/) | Alembic — `rag` schema |
| [prisma/](prisma/) | Prisma schema + migrations + seed (`app` schema) |
| [docker-compose.yml](docker-compose.yml) | Postgres + Python stack |

## Phasing status

- ✅ Phase 1 — Foundation (Postgres+pgvector, Python service, schemas, retrieval, embed)
- ✅ Phase 2 — Tool-use chat (system prompt 30K → 2K, Python proxies, provenance verifier)
- 🟡 Phase 3 — L1/L2/L3 summary writers + workers shipped; live Slack ingest pending creds
- 🟡 Phase 4 — Live Jira / Sentry adapters in place (env-gated)
- 🟡 Phase 5 — Confluence ingester scaffolded; Linear / Notion / Sheets to follow
- 🟡 Phase 6 — Hallucination verifier + freshness pill live; eval-harness scaffolded, golden set TBD
