# CTO Brain

> Your AI chief of staff for engineering leadership — grounded on live organisational data.

Engineering-management copilot built on Claude. Two halves:

- **Next.js + TypeScript** ([src/](src/)) — UI, chat orchestration (Anthropic tool-use loop), Prisma-backed app data, GitHub PR review.
- **Python context engine** ([services/context/](services/context/)) — recursive RAG over Slack / Jira / Sentry / Confluence / Notion / Sheets / Linear. Owns the `rag.*` Postgres schema.

Both halves share one Postgres+pgvector database with strict schema ownership: TypeScript owns `app.*`, Python owns `rag.*`. They communicate only over HTTP via `PYTHON_CONTEXT_URL` (default `http://localhost:8000`).

---

## Run locally

### 1. Bring up Postgres + the Python context engine

```bash
docker compose up --build
```

Starts:
- `postgres` — pgvector-enabled Postgres on `:5432`
- `context` — FastAPI on `:8000`, runs `alembic upgrade head` at startup

Smoke-test:
```bash
curl http://localhost:8000/healthz   # liveness
curl http://localhost:8000/readyz    # confirms pgvector + rag schema
```

### 2. Bring up Next.js

```bash
cp .env.example .env
# Fill in ANTHROPIC_API_KEY at minimum.

npm install
npx prisma migrate dev      # creates dev.db + tables
npm run db:seed             # mock data
npm run dev                 # http://localhost:3000
```

Set any of these to graduate from mock to live:
- `JIRA_BASE_URL`, `JIRA_PAT`, `JIRA_EMAIL` → live Jira adapter
- `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` → live Sentry adapter
- `GITHUB_PAT`, `GITHUB_REPO` → live PR review (already wired)
- `VOYAGE_API_KEY` → real 1024-dim embeddings (falls back to dev-hash without it)

The console logs which adapters are live vs mock at startup.

### 3. End-to-end smoke

```bash
./scripts/e2e-smoke.sh
```

Seeds one document, triggers an L1 summary, runs a `/search`, then asks the Next.js chat a question and prints the answer with citations.

---

## Architecture

### System overview

```
┌───────────────────────────────────────────┐         ┌──────────────────────────────────────────┐
│  Next.js  (TypeScript / src/)             │         │  Python context engine                   │
│                                           │         │  (services/context/)                     │
│  ┌─────────┐  ┌──────────┐  ┌─────────┐  │  HTTP   │  ┌──────────┐  ┌────────┐  ┌─────────┐  │
│  │   UI    │  │ Chat     │  │Modules  │  │◀──────▶│  │  Ingest  │  │  RAG   │  │Workers  │  │
│  │(7 pages)│  │tool-loop │  │(briefs, │  │         │  │pipelines │  │pipeline│  │(APSched)│  │
│  │         │  │(Opus 4.x)│  │OKRs,    │  │         │  │(7 source │  │        │  │         │  │
│  │         │  │6-turn    │  │PRs,     │  │         │  │ adapters)│  │        │  │         │  │
│  │         │  │budget    │  │incidents│  │         │  │          │  │        │  │         │  │
│  └─────────┘  └──────────┘  └─────────┘  │         │  └──────────┘  └────────┘  └─────────┘  │
│                                           │         │                                          │
│  ┌──────────────────────────────────────┐ │         │  ┌───────────────────────────────────┐  │
│  │  Live adapters (env-gated)           │ │         │  │  Voyage AI (embed + rerank)        │  │
│  │  Jira · Sentry · GitHub · Slack(mock)│ │         │  │  Anthropic (Haiku L1 · Opus L2/L3)│  │
│  └──────────────────────────────────────┘ │         │  └───────────────────────────────────┘  │
└───────────────┬───────────────────────────┘         └──────────────────┬───────────────────────┘
                │ Prisma ORM (schema = app)            asyncpg + pgvector │
                │                                      SQLAlchemy / Alembic (schema = rag)
                └──────────────────────────┬───────────────────────────────┘
                                           ▼
                               ┌─────────────────────────┐
                               │   Postgres + pgvector    │
                               │   schemas: app  |  rag   │
                               │   tables ───────────────┐│
                               │   app: Team, Engineer,  ││
                               │       OKR, Incident,    ││
                               │       PRReview, …       ││
                               │   rag: document, chunk, ││
                               │       summary,          ││
                               │       ingest_cursor     ││
                               └─────────────────────────┘
```

---

### Context engineering deep-dive

The Python service is the core of CTO Brain's intelligence. It turns raw organisational noise into a queryable, hierarchically-summarised corpus that the chat tool-use loop consumes.

#### Data flow (end to end)

```
External sources                  Python context engine                     Next.js chat
──────────────   ──────────────────────────────────────────────────────   ────────────────
Slack           ──▶  /ingest/slack    ┐
Jira            ──▶  /ingest/jira     │
Sentry          ──▶  /ingest/sentry   │  upsert_document()
Confluence      ──▶  admin/sync/conf  │  1. SHA-256 content hash (dedup)
Notion          ──▶  admin/sync/notion│  2. PII redaction
Linear          ──▶  hourly poll      │  3. Source-aware chunking
GSheet          ──▶  hourly poll      ├──▶  rag.document + rag.chunk
                                      │  4. Voyage voyage-3 embed (1024-d)
                                      │  5. pgvector IVFFlat index
                                      │
                     APScheduler      │
                     L1 sweep (hrly)  │  L1: per-document summary (Haiku)
                     L2 build (hrly)  ├──▶  rag.summary  (layer 1/2/3)
                     L3 build (06:00) │  L2: per-entity/window (Opus)
                                      │  L3: daily digest (Opus)
                                      │
                     /search  ◀───────┘  Hybrid BM25 + vector (pgvector)
                              │          Voyage rerank-2 (top-50 → top-k)
                              │          Overflow: group→Haiku summarise
                              │
                              └─────────────────────────────────────────▶  tool: search_corpus()
                                                                           tool: get_entity_summary()
                                                                           tool: get_doc()
                                                                           → Claude Opus answer
                                                                              + citations
```

---

#### 1. Ingestion layer (`services/context/app/ingest/`)

Every source adapter calls the shared `base.py::upsert_document()`:

| Step | Detail |
|------|--------|
| **Dedup** | SHA-256(content + metadata) stored as `content_hash`; skip if unchanged |
| **PII redaction** | `redact_with_mentions()` strips sensitive data, canonicalises Slack @-handles |
| **Chunking** | Source-aware strategy (see table below) |
| **Embedding** | Voyage `voyage-3` (1024 dims) via `embed.py`; `dev-hash` fallback if no API key |
| **Upsert** | Atomic transaction: replace `rag.chunk` rows, update `rag.document` + `rag.ingest_cursor` |
| **Entity refs** | Regex extraction of ticket keys, PR refs, canonical IDs (e.g. `engineer:eng_priya`) |

**Chunking strategies by source:**

| Source | Strategy |
|--------|----------|
| Slack | 1 message = 1 chunk |
| Jira | Description + each comment as separate chunks |
| Sentry | `title + culprit + top-frame` = 1 chunk |
| Confluence / Notion | Split on H2/H3, ~800-token target, 100-token overlap |
| GSheet | Split on H2/H3, ~800 tokens, 100-token overlap |
| Generic / text | Recursive paragraph splitter |

**Source adapters:**

| Adapter | Trigger | Key detail |
|---------|---------|-----------|
| `jira.py` | Webhook (`/ingest/jira`) | Issues + comments |
| `slack.py` | Webhook (`/ingest/slack`) | Messages + threads |
| `sentry.py` | Webhook (`/ingest/sentry`) | Error events |
| `confluence.py` | Hourly cron + `/admin/sync/confluence` | Cursor-paginated space sync |
| `notion.py` | Hourly cron + `/admin/sync/notion` | Database page sync |
| `linear.py` | Hourly cron | Issues + projects |
| `gsheet.py` | Hourly cron + `/admin/sync/gsheet` | Sheet-to-text |

---

#### 2. Storage schema (`rag.*` in Postgres)

```
rag.document
  id, source, source_id, workspace_id, title,
  content_hash, entity_refs[], metadata (JSONB),
  created_at, updated_at

rag.chunk
  id, document_id, ordinal, text, token_count,
  entity_refs[], embedding (vector 1024),     ◀── pgvector IVFFlat index (100 lists, cosine)
  tsv (tsvector),                             ◀── GIN index (BM25)
  embedding_model, embedding_version,
  created_at

rag.summary
  id, layer (1|2|3), entity_type, entity_id, window,
  text, token_count, content_hash,
  source_chunk_ids[], source_doc_ids[],
  created_at

rag.ingest_cursor
  id (source:workspace), cursor (timestamp / page token)
```

---

#### 3. Retrieval (`services/context/app/rag/retrieve.py`)

`search_corpus()` runs a single parameterised SQL query combining:

1. **BM25** — `tsv @@ plainto_tsquery(query)` (GIN-indexed)
2. **Vector similarity** — `embedding <=> query_vec` (cosine, IVFFlat)
3. **Filters** — `workspace_id`, source allow-list, `entity_refs ∩`, time window
4. **Top-50 candidates** → **Voyage `rerank-2`** → top-k (default k=10)
5. **Overflow valve** — if tokens exceed 8 000-token budget, group by entity, summarise with Haiku, return `truncated=True`

Query routing:
- **Entity-centric** — explicit `engineer:` / `team:` refs in query → filter by `entity_refs`
- **Structured** — ticket keys detected → direct doc lookup
- **Semantic** — default hybrid path

---

#### 4. Hierarchical summarisation (`services/context/app/rag/summarize.py`)

Three layers build on each other, all idempotent on `content_hash`:

```
Raw chunks  ──▶  L1 summaries  ──▶  L2 summaries  ──▶  L3 digest
              (per document)     (per entity/window)  (daily brief)
              Claude Haiku       Claude Opus           Claude Opus
              on-demand          hourly sweep          06:00 UTC
```

| Layer | Scope | Model | Trigger |
|-------|-------|-------|---------|
| L1 | Per `rag.document` | Haiku | On-demand or hourly sweep |
| L2 | Per entity × window (day/week/sprint/quarter) | Opus | Hourly APScheduler |
| L3 | Daily org digest | Opus | Daily 06:00 UTC APScheduler |

All summaries use Anthropic prompt-cache on the input block (reduces latency + cost on repeated sweeps).

---

#### 5. Workers / scheduling (`services/context/app/workers/scheduler.py`)

| Job | Cadence | Function |
|-----|---------|----------|
| L1 sweep | Hourly | `sweep_l1_missing()` — fills gaps |
| L2 build | Hourly | `run_l2_for_active()` — all active entities |
| L3 build | 06:00 UTC daily | `run_l3_daily()` |
| Confluence poll | Hourly | `confluence_ingest.sync_space()` |
| GSheet poll | Hourly | `gsheet_ingest.sync_sheet()` |
| Linear poll | Hourly | `linear_ingest.sync_workspace()` |
| Notion poll | Hourly | `notion_ingest.sync_database()` |

---

#### 6. Python API endpoints (`services/context/app/routers/`)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/healthz` / `/readyz` | GET | Liveness + readiness |
| `/search` | POST | Hybrid BM25+vector retrieval + rerank |
| `/summary` | GET | Fetch L1/L2/L3 summary for entity+window |
| `/doc/{id}` | GET | Raw document + optional anchor |
| `/freshness` | GET | Source data age (seconds since last ingest) |
| `/ingest/text` | POST | Generic text ingest |
| `/ingest/{slack,jira,sentry,linear}` | POST | Source-specific webhooks |
| `/ingest/{confluence,gsheet}` | POST | Webhook stubs (cron-only) |
| `/admin/sync/{confluence,notion,gsheet}` | POST | Manual backfill trigger |
| `/admin/summarize/{l1,l2,l3}` | POST | Manual summary build |
| `/admin/sweep/{l1,l2}` | POST | Missing summary sweeper |

Security: Slack webhooks verified via HMAC-SHA256 (`X-Slack-Signature`, ±5 min replay window). Admin endpoints are network-boundary protected (no app-layer auth in phase 1).

---

### Next.js layer

#### Chat tool-use loop (`src/lib/chat/tools.ts` + `src/app/api/chat/route.ts`)

Claude Opus runs a 6-turn agentic loop. Tools available per turn:

| Tool | Calls | Returns |
|------|-------|---------|
| `search_corpus` | Python `/search` | Ranked chunks + citations |
| `search_slack` | `search_corpus(sources=["slack"])` | Slack-scoped results |
| `get_entity_summary` | Python `/summary` | L1/L2/L3 summary text |
| `get_doc` | Python `/doc/{id}` | Full document |
| `get_engineer_profile` | Prisma `Engineer` | Name, team, role, handles |
| `get_ticket` | Prisma / Jira adapter | Ticket status + assignee |
| `get_okr_status` | Prisma `OKR` | Team OKRs + progress |
| `list_incidents` | Prisma `Incident` | Open + recent incidents |
| `get_pr` | GitHub adapter | PR diff + metadata |
| `compose_brief` | `generateBrief()` | Structured daily brief |

Post-generation: `src/lib/chat/verify.ts` cross-checks every claim against citations before the response is sent.

---

#### Live adapters (`src/lib/adapters/`)

| Adapter | External API | Key methods |
|---------|-------------|-------------|
| `github.ts` | GitHub REST v3 | `getPR(repo, prNumber)` |
| `jira.ts` | Jira Cloud REST v3 | `sprints()`, `tickets(team, assigneeId)` |
| `sentry.ts` | Sentry REST | `services() → ServiceHealth[]`, `alerts()` |
| `slack` (mock) | — | `recentMessages()`, `hesitationSignals()` |
| `standups` (mock) | — | `forDate(YYYY-MM-DD)` |

Each adapter is env-gated: if credentials are absent, it returns typed mock data and logs `adapter=mock` at startup.

---

#### Modules (`src/lib/modules/`)

| Module | Purpose | Claude model |
|--------|---------|-------------|
| `daily-brief` | Aggregates standups, Jira, Slack, Sentry, on-call → structured Brief JSON | Opus |
| `execution-tower` | OKR tracking, status rollups, priority rebalancing recommendations | Opus |
| `interrupt-memory` | Incident summaries, postmortems (timeline + root cause + action items) | Opus |
| `people-intel` | Engineer profiles, 1:1 agenda drafts | Opus |
| `decision-engine` | Decision simulation + outcome analysis | Opus |
| `pr-review` | Classify PR → select workflows → run rule checks → verdict + GitHub comment | Haiku (classify) + Opus (review) |

**PR review sub-pipeline** (`src/lib/modules/pr-review/`):
```
GitHub PR  →  classifier.ts (Haiku: feature/fix/refactor/docs)
           →  ruleset-loader.ts (parses CODE_REVIEW_RULESET.md)
           →  workflow-router.ts (selects applicable workflows)
           →  workflow-runner.ts (executes checks)
           →  verdict.ts (blocking / warnings / nits)
           →  github-poster.ts (posts comment to PR)
```

---

#### Next.js API routes (`src/app/api/`)

| Route | Purpose |
|-------|---------|
| `POST /api/chat` | Agentic Q&A (Opus, 6-turn tool budget, streaming) |
| `GET/POST /api/brief` | Generate or fetch latest daily brief |
| `GET /api/people/[id]` | Engineer profile |
| `GET /api/people/[id]/agenda` | 1:1 agenda draft |
| `GET /api/incidents` | Open + recent incidents |
| `GET /api/incidents/[id]/summary` | Situation + suggested actions |
| `GET /api/incidents/[id]/postmortem` | Timeline + root cause + AIs |
| `GET /api/decisions/list` | Known decisions |
| `POST /api/decisions/analyze` | Evaluate decision outcome |
| `POST /api/decisions/simulate` | Scenario modelling |
| `GET /api/execution/okrs` | Team OKRs + progress |
| `GET /api/execution/status-report` | Headline + risks |
| `POST /api/execution/rebalance` | Priority recommendations |
| `GET /api/reviews` | Recent PR reviews |
| `GET /api/reviews/[id]` | Review detail + findings |
| `POST /api/reviews/scan` | Trigger new PR analysis |
| `GET /api/freshness` | Source data age (proxied from Python) |
| `GET /api/health` | Python service liveness check |

---

### Environment variables

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Claude API auth |
| `ANTHROPIC_MODEL_REASONING` | Opus model override (default `claude-opus-4-7`) |
| `ANTHROPIC_MODEL_FAST` | Haiku model override (default `claude-haiku-4-5`) |
| `DATABASE_URL` | Prisma — SQLite (`file:./dev.db`) or Postgres (`postgresql://…`) |
| `PYTHON_CONTEXT_URL` | Context engine base URL (default `http://localhost:8000`) |
| `WORKSPACE_ID` | Single-tenant phase-1 key (default `personal`) |
| `VOYAGE_API_KEY` | Voyage AI — embeddings + reranking (dev-hash fallback if absent) |
| `GITHUB_PAT` | GitHub REST auth |
| `GITHUB_REPO` | PR review target (`owner/repo`) |
| `JIRA_BASE_URL` · `JIRA_PAT` · `JIRA_EMAIL` | Jira Cloud auth |
| `SENTRY_AUTH_TOKEN` · `SENTRY_ORG` | Sentry REST auth |
| `SLACK_BOT_TOKEN` · `SLACK_SIGNING_SECRET` | Slack Events API |
| `CONFLUENCE_BASE_URL` · `CONFLUENCE_PAT` | Confluence Cloud auth |
| `NOTION_TOKEN` | Notion API auth |
| `LINEAR_API_KEY` | Linear GraphQL API key |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | GCP service account (GSheet / Drive) |
| `SENTRY_DSN_SELF` | Python service self-monitoring |
| `LOG_LEVEL` | Python logging (`INFO` / `DEBUG`) |

---

## Tests

```bash
# TypeScript — vitest, no infra needed
npm test

# Python — pytest (pure-function tests run without DB)
cd services/context && pytest tests/test_slack_sig.py tests/test_eval_retrieval.py
```

---

## Repo layout

| Path | Purpose |
|------|---------|
| [src/app/](src/app/) | Next.js pages + API routes |
| [src/lib/chat/](src/lib/chat/) | Tool definitions + provenance verifier |
| [src/lib/python.ts](src/lib/python.ts) | Typed HTTP client → Python service |
| [src/lib/adapters/](src/lib/adapters/) | Live + mock adapters (Jira / Sentry / GitHub / Slack / Standups) |
| [src/lib/modules/](src/lib/modules/) | Higher-level features (daily-brief, people-intel, PR review, …) |
| [src/components/](src/components/) | Shared UI components |
| [services/context/app/](services/context/app/) | FastAPI service |
| [services/context/app/ingest/](services/context/app/ingest/) | Source adapters (7 sources) |
| [services/context/app/rag/](services/context/app/rag/) | Retrieval, chunking, embedding, summarisation |
| [services/context/app/workers/](services/context/app/workers/) | APScheduler jobs |
| [services/context/app/security/](services/context/app/security/) | Slack HMAC webhook verification |
| [services/context/migrations/](services/context/migrations/) | Alembic — `rag` schema |
| [prisma/](prisma/) | Prisma schema + migrations + seed (`app` schema) |
| [scripts/](scripts/) | e2e smoke, seed helpers |
| [docker-compose.yml](docker-compose.yml) | Postgres + Python stack |

---

## Phasing status

| Phase | Status | Detail |
|-------|--------|--------|
| 1 — Foundation | ✅ | Postgres+pgvector, Python service, schemas, hybrid retrieval, embedding |
| 2 — Tool-use chat | ✅ | System prompt 30K → 2K, Python proxies, provenance verifier |
| 3 — Summary workers | 🟡 | L1/L2/L3 writers + APScheduler shipped; live Slack ingest pending creds |
| 4 — Live adapters | 🟡 | Jira + Sentry env-gated and live; Slack mock only |
| 5 — Source coverage | 🟡 | Confluence ingester done; Linear / Notion / Sheets scaffolded |
| 6 — Eval + hardening | 🟡 | Hallucination verifier + freshness pill live; eval golden set TBD |
