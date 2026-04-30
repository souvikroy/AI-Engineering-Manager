# AI-EM Context Engine

Recursive-RAG service for the AI-EM Copilot. Owns the `rag.*` Postgres schema:
ingest pipelines, chunking, embeddings, hierarchical summaries, hybrid retrieval.

## Run locally

```bash
# From the repo root
docker compose up --build

# First run will:
# 1. start Postgres+pgvector
# 2. build the Python image
# 3. run alembic upgrade head (creates rag schema + indexes)
# 4. start uvicorn on http://localhost:8000

# Quick smoke test
curl http://localhost:8000/healthz
curl http://localhost:8000/readyz
```

## Configuration

Required:
- `DATABASE_URL` — `postgresql+asyncpg://...`

Optional (everything degrades gracefully when missing):
- `VOYAGE_API_KEY` — without it, embeddings fall back to `dev-hash` (deterministic, NOT for production).
- `ANTHROPIC_API_KEY` — needed for L1/L2/L3 summarization + Haiku entity extraction.
- `SLACK_BOT_TOKEN`, `JIRA_PAT`, `SENTRY_AUTH_TOKEN`, ... — wire when each integration goes live.

## Endpoints

| Route | Purpose |
|---|---|
| `GET /healthz` `/readyz` | Liveness + DB readiness |
| `POST /search` | Hybrid retrieval (BM25 + vector + rerank) with overflow valve |
| `GET /summary` | L1/L2/L3 hierarchical summaries |
| `GET /doc/{id}` | Single Document fetch (with optional anchor) |
| `GET /freshness` | Per-source data age |
| `POST /ingest/text` | Generic dev ingest — useful for fixtures and the eval harness |
| `POST /ingest/{slack,jira,sentry,...}` | Source-specific webhooks |

## Smoke-seed and search

```bash
# Seed one document
curl -sX POST http://localhost:8000/ingest/text \
  -H 'content-type: application/json' \
  -d '{
    "source": "confluence",
    "source_id": "demo-1",
    "title": "Demo design doc",
    "text": "# Auth Migration\n\nWe are moving JWT refresh rotation from sticky sessions to a stateless approach. Owner: eng_priya. Tickets: AUTH-12, AUTH-19.\n\n## Risk\nClock skew across regions.",
    "entity_refs": ["engineer:eng_priya", "service:auth"]
  }'

# Search for it
curl -sX POST http://localhost:8000/search \
  -H 'content-type: application/json' \
  -d '{ "query": "auth migration risk", "k": 5 }'
```

## Schema ownership

This service is the ONLY writer to `rag.*`. The Next.js side reads via the HTTP
API, never via Prisma. The Next.js `app.*` schema is owned by Prisma; this
service does not write there.

## Migrations

```bash
# Inside the container (or locally with the same DATABASE_URL):
alembic upgrade head           # apply
alembic revision -m "..." --autogenerate=false  # author a new migration
alembic downgrade -1           # back out one step
```

## Testing

```bash
pip install -e '.[dev]'
pytest
```
