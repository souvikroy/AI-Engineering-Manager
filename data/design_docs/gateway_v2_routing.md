# Gateway v2 Routing Layer — RFC

**Author:** Amir Hassan (eng-amir)
**Status:** Draft
**Date:** 2026-04-28

## Problem
Our v1 gateway uses path-prefix-only routing. As we approach 50 services, route conflicts and middleware ordering bugs are an ongoing source of incidents (3 in Q1).

## Proposal
Adopt a declarative routing config in YAML, compiled at boot to a Trie. Middleware runs in declared order with explicit short-circuit semantics.

## Trade-offs

### A — Trie + boot-time compilation (proposed)
- **Latency:** O(path-depth) lookup, ~1-3μs in our benches.
- **Operational cost:** YAML config; reload requires SIGHUP.
- **Risk:** Misconfig at boot crashes the gateway. Mitigation: dry-run validator in CI.

### B — Regex-table at request time
- **Latency:** O(N) over routes, ~25μs at 200 routes.
- **Operational cost:** Hot-reload trivial.
- **Risk:** Performance cliff as routes grow.

## Open questions
- How do we handle wildcard routes during the migration?
- Do we need per-tenant routing, or is path-based namespacing enough?

## Migration
Run v1 and v2 side-by-side behind a feature flag for 4 weeks. Mirror traffic to v2, compare responses, flip when divergence < 0.01%.
