# Experiment SDK v2 — Design

**Author:** Marcus Johnson (eng-marcus)
**Status:** In progress (60% migrated)
**Date:** 2026-04-20

## Problem
v1 SDK requires server roundtrip per assignment, adds 80-120ms p99 to checkout. Self-serve experiment creation is impossible because the schema is hand-edited Protobuf.

## Proposal
- Pull assignments from a CDN-cached, signed bundle refreshed every 60s.
- Schema becomes JSON, validated server-side, edited via a PM-facing UI.
- Backwards-compatible shim for v1 callers during 4-week migration.

## Trade-offs

### A — Edge bundle + signed manifest (proposed)
- **Latency:** 0ms additional in hot path; bundle fetched lazily.
- **Cost:** CDN egress ≈ $400/mo at current scale.
- **Risk:** 60s staleness window; users may see stale variants briefly.

### B — In-process gRPC stream
- **Latency:** ~5ms p99 streaming.
- **Cost:** higher infra footprint.
- **Risk:** stream reconnection storms during deploys (we hit this with the metrics SDK already).

## Migration plan
Two old experiments use deprecated callbacks. Mark deprecated, log warnings, remove in 4 weeks.

## Open questions
- Do we need per-region bundles? (probably not at our scale yet)
- Cache key: user_id or device_id?
