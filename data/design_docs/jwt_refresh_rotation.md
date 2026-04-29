# JWT Refresh Token Rotation

**Author:** Priya Subramanian (eng-priya)
**Status:** In Review (canary live)
**Date:** 2026-04-18

## Problem
Refresh tokens were long-lived and never rotated. Compromise of a refresh token gave persistent access. Compliance review (Q1) flagged this as a P1.

## Proposal
- Refresh tokens are single-use; each refresh issues a new RT and invalidates the prior.
- 5s grace window for client retries to avoid double-invalidation.
- Family-tree tracking: RT theft is detected when a previously-rotated RT is presented; whole family is revoked.

## Trade-offs

### A — Family-tree + grace window (proposed)
- **Security:** strong; theft detected within one rotation cycle.
- **Cost:** O(rotations) DB writes; cached in Redis.
- **Risk:** Grace window allows ~5s replay; acceptable.

### B — Strict single-use, no grace
- **Security:** strongest.
- **Cost:** false-positive logouts on flaky networks.

## Rollout
1% canary for 24h, 10% for 48h, 100% by end of Sprint Q2-W17.

## Open questions
- Should RTs be bound to device fingerprint? (not in v1)
