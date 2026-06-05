#!/usr/bin/env bash
# Flip the Prisma schema from SQLite to Postgres + pgvector.
#
# What it does:
#   1. Confirms DATABASE_URL points at Postgres (postgresql://...).
#   2. Backs up prisma/schema.prisma → prisma/schema.sqlite.prisma.bak
#   3. Backs up the existing SQLite migrations dir → prisma/migrations.sqlite.bak/
#   4. Replaces prisma/schema.prisma with prisma/schema.postgres.prisma
#   5. Wipes prisma/migrations (the SQLite migrations don't apply to Postgres)
#   6. Runs `prisma migrate dev --name initial_postgres_app_schema`
#   7. Optionally re-seeds via npm run db:seed (with --demo)
#
# Reversal: `mv prisma/schema.sqlite.prisma.bak prisma/schema.prisma`
#           `rm -rf prisma/migrations && mv prisma/migrations.sqlite.bak prisma/migrations`
#
# Pass --dry-run to see the plan without doing anything.
set -euo pipefail

DRY_RUN=0
SKIP_SEED=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --skip-seed) SKIP_SEED=1 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -25
      exit 0
      ;;
  esac
done

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '\033[36m▶ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m⚠ %s\033[0m\n' "$*"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
ok()   { printf '\033[32m✓ %s\033[0m\n' "$*"; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

bold "AI-EM · flip Prisma to Postgres + pgvector"
echo

# 1. Validate DATABASE_URL
DB_URL="${DATABASE_URL:-}"
if [[ -z "$DB_URL" ]]; then
  if [[ -f .env ]]; then
    DB_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//')"
  fi
fi

case "$DB_URL" in
  postgresql://*|postgres://*) ok "DATABASE_URL points at Postgres" ;;
  file:*|"") fail "DATABASE_URL is unset or points at SQLite ($DB_URL). Update .env to a Postgres URL first." ;;
  *) warn "DATABASE_URL has unrecognized scheme: $DB_URL — proceeding anyway" ;;
esac

# 2. Pre-flight: pgvector must be installable on the target. We can't check
#    remotely without psql, so just remind the operator.
info "Reminder: the target Postgres needs the pgvector extension. Neon + Supabase + pgvector/pgvector:pg16 image all support it."
echo

if [[ ! -f prisma/schema.postgres.prisma ]]; then
  fail "prisma/schema.postgres.prisma is missing"
fi

# 3. Plan
bold "Plan:"
echo "  • backup prisma/schema.prisma   → prisma/schema.sqlite.prisma.bak"
echo "  • backup prisma/migrations/     → prisma/migrations.sqlite.bak/"
echo "  • copy   prisma/schema.postgres.prisma → prisma/schema.prisma"
echo "  • wipe   prisma/migrations/"
echo "  • run    prisma migrate dev --name initial_postgres_app_schema"
if [[ $SKIP_SEED -eq 0 ]]; then
  echo "  • run    npm run db:seed -- --demo"
fi
echo

if [[ $DRY_RUN -eq 1 ]]; then
  warn "--dry-run set; exiting without changes."
  exit 0
fi

read -p "Proceed? [y/N] " -n 1 -r
echo
[[ $REPLY =~ ^[Yy]$ ]] || { warn "aborted"; exit 1; }

# 4. Execute
info "Backing up SQLite schema + migrations…"
[[ -f prisma/schema.sqlite.prisma.bak ]] && fail "prisma/schema.sqlite.prisma.bak already exists. Resolve manually or remove it first."
cp prisma/schema.prisma prisma/schema.sqlite.prisma.bak
if [[ -d prisma/migrations ]]; then
  [[ -d prisma/migrations.sqlite.bak ]] && fail "prisma/migrations.sqlite.bak already exists. Resolve manually."
  mv prisma/migrations prisma/migrations.sqlite.bak
fi
ok "backed up"

info "Activating Postgres schema…"
cp prisma/schema.postgres.prisma prisma/schema.prisma
ok "schema swapped"

info "Running prisma migrate dev…"
npx prisma migrate dev --name initial_postgres_app_schema
ok "migration applied"

if [[ $SKIP_SEED -eq 0 ]]; then
  info "Seeding mock data (--demo)…"
  if grep -qE '"db:seed":' package.json; then
    npm run db:seed -- --demo || warn "seed failed — check errors above"
  else
    npx tsx prisma/seed.ts --demo || warn "seed failed — check errors above"
  fi
fi

echo
bold "Done."
echo
echo "Next steps:"
echo "  • Bring up the Python context engine: docker compose up --build"
echo "  • Run the e2e smoke:                 ./scripts/e2e-smoke.sh"
echo
echo "To revert:"
echo "  mv prisma/schema.sqlite.prisma.bak prisma/schema.prisma"
echo "  rm -rf prisma/migrations && mv prisma/migrations.sqlite.bak prisma/migrations"
