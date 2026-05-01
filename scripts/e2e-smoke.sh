#!/usr/bin/env bash
# End-to-end smoke for the AI-EM stack.
#
# Walks: Python /healthz → /ingest/text → /admin/summarize/l1/<id> →
#        /search → Next.js /api/chat. Prints each response so you can see the
#        contract working. Designed to run idempotently — re-running upserts
#        the same doc and confirms the dedup path.
#
# Requires: docker compose stack running (Postgres + Python on :8000) and the
# Next.js dev server on :3000. ANTHROPIC_API_KEY in env for the chat step.
set -euo pipefail

PY="${PYTHON_CONTEXT_URL:-http://localhost:8000}"
WEB="${WEB_URL:-http://localhost:3000}"

say() { printf '\n\033[1;35m▌ %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m✗ %s\033[0m\n' "$*"; exit 1; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }

say "1. Python health"
curl -fsS "$PY/healthz" | tee /dev/stderr | grep -q '"ok": *true' || fail "Python not healthy"
ok "healthz"

curl -fsS "$PY/readyz" | tee /dev/stderr | grep -q '"pgvector": *true' || fail "pgvector not enabled"
ok "readyz · pgvector"

say "2. Seed one document via /ingest/text"
DOC_BODY='{
  "source": "confluence",
  "source_id": "smoke-auth-migration",
  "title": "Auth migration RFC",
  "text": "# Auth Migration\n\nWe are moving JWT refresh rotation from sticky sessions to a stateless approach. Owner: eng_priya. Tickets: AUTH-12, AUTH-19.\n\n## Risk\nClock skew across regions can yield false rejections; mitigate with 60s grace.\n\n## Decision\nGo with stateless rotation behind feature flag auth.refresh.v2.",
  "entity_refs": ["engineer:eng_priya", "service:auth"],
  "source_url": "https://confluence.example.com/auth/migration"
}'
curl -fsS -X POST "$PY/ingest/text" \
  -H 'content-type: application/json' \
  -d "$DOC_BODY" | tee /dev/stderr | grep -q '"ok"' || fail "ingest/text failed"
ok "document ingested"

say "3. Search for it"
SEARCH_BODY='{ "query": "auth migration risk", "k": 5 }'
SEARCH_RES=$(curl -fsS -X POST "$PY/search" -H 'content-type: application/json' -d "$SEARCH_BODY")
echo "$SEARCH_RES" | python3 -m json.tool
echo "$SEARCH_RES" | grep -q "Auth Migration\|stateless\|AUTH-12" || fail "search did not surface seeded doc"
ok "search hit"

say "4. Find the document id and trigger an L1 summary"
DOC_ID=$(echo "$SEARCH_RES" | python3 -c "import json,sys; r=json.load(sys.stdin); ids=[c['id'] for c in r.get('citations',[]) if c['kind']=='confluence']; print(ids[0] if ids else '')")
[ -n "$DOC_ID" ] || fail "no confluence citation found"
echo "doc_id=$DOC_ID"
curl -fsS -X POST "$PY/admin/summarize/l1/$DOC_ID" | tee /dev/stderr
ok "L1 summary built"

say "5. Trigger an L2 entity rollup"
curl -fsS -X POST "$PY/admin/summarize/l2" \
  -H 'content-type: application/json' \
  -d '{"entity_type":"engineer","entity_id":"eng_priya","window":"week"}' | tee /dev/stderr
ok "L2 summary built"

say "6. Per-source freshness"
curl -fsS "$PY/freshness" | python3 -m json.tool

say "7. Ask the Next.js chat (uses Python search via tool-use)"
CHAT_BODY='{
  "messages": [
    { "role": "user", "content": "What is the risk in the auth migration RFC, and who owns it?" }
  ]
}'
echo "POST $WEB/api/chat …"
curl -fsS -X POST "$WEB/api/chat" \
  -H 'content-type: application/json' \
  --max-time 90 \
  -d "$CHAT_BODY"
echo
ok "end-to-end OK"
