# Code Review Rule Set — Production Standard

**Author voice:** Engineering Manager, ex-Facebook (20+ yrs), large-scale application platforms.
**Audience:** Authors and reviewers of GitHub PRs in a production codebase.
**Enforcement language:** `MUST` (blocking), `MUST NOT` (blocking), `SHOULD` (strong default, deviation requires written justification in the PR), `MAY` (allowed).

> Rule numbering: `R<workflow>.<index>`. Every rule maps back to the 21-step expert workflow. Rules are written to be **specific, mechanically checkable, and tied to a concrete failure mode**.

---

## Workflow 1 — Pre-Review Context Discovery

**Goal:** Reviewer never reads code without understanding the change.

- **R1.1** Every PR description MUST contain, in this order: `Problem`, `Solution`, `Out of Scope`, `Risk`, `Rollback`, `Testing`, `Linked ticket`. PRs missing any section MUST be returned with a single comment: `Blocking: PR description incomplete — please populate the required template.` No deep review until then.
- **R1.2** PR title MUST follow `<type>(<scope>): <imperative summary>` where `<type> ∈ {feat, fix, refactor, perf, sec, chore, migration, revert, docs, test, infra, exp}`. Length ≤ 72 chars.
- **R1.3** PR MUST link a ticket (Jira/Linear/GitHub issue). Hot-fixes MAY skip linkage only with a `hotfix/` branch prefix and a follow-up ticket created within 24 hours.
- **R1.4** Changes that affect product behavior MUST link the PRD or design doc. Missing PRD → `Blocking`.
- **R1.5** API and UI changes MUST include either a request/response example, screenshot, or short Loom/GIF.
- **R1.6** Migrations MUST link a written rollback plan in the PR description. "Revert the PR" is **not** an acceptable rollback plan for schema, data, or config migrations.
- **R1.7** Reviewer MUST classify the PR before reading code: `bug | feature | refactor | migration | security | experiment | infra`. The classification gates which subsequent workflows apply.
- **R1.8** Reviewer MUST be able to answer the four context questions (problem, why now, out-of-scope, blast radius) from the description alone. If they cannot, ask — do not infer.
- **R1.9** Acceptance criteria MUST be enumerated and each criterion MUST be traceable to a test or to a manual verification step listed in `Testing`.

---

## Workflow 2 — PR Hygiene & Review Readiness

**Goal:** Reviewer's attention is spent on substance, not janitorial work.

- **R2.1** CI MUST be green at the time review is requested. CI red ≥ 24h with no fix → reviewer MUST close PR as draft and unassign themselves.
- **R2.2** PR MUST NOT exceed **400 net changed lines** of hand-written code (excluding lock files, generated code, fixtures explicitly marked `// generated`). Larger PRs MUST be split, OR carry an `[oversized-justified]` label and a paragraph explaining why splitting is impossible.
- **R2.3** A PR MUST NOT mix `refactor` with `behavior change`. If both are present, split. Reviewer comment template: `Blocking: refactor and behavior change must ship as separate PRs to preserve rollback granularity.`
- **R2.4** No `TODO`, `FIXME`, `XXX`, `HACK`, or `console.log`/`println!`/`fmt.Println`/`print(`/`debugger;` left in shipped code without an attached ticket reference (e.g., `// TODO(JIRA-1234): ...`).
- **R2.5** No commented-out code. Dead code is removed; history is for archeology.
- **R2.6** No secrets, tokens, private keys, `.env` files, customer data, or internal hostnames. Reviewer MUST run a secret-scan locally if the diff touches config/IaC files.
- **R2.7** Generated files (lock files, protobuf stubs, OpenAPI clients) MUST live in their own commit and the commit message MUST start with `chore(generated):`.
- **R2.8** Lint, formatter, type-check MUST pass. "Lint disabled for this line" requires a comment justifying *why*.
- **R2.9** No merge conflicts. Rebase, do not "merge main into branch" repeatedly — clean history is required for `bisect`.
- **R2.10** Tests MUST NOT be `.skip`ped, `xit`'d, `t.Skip`ed, or removed without a linked ticket and reviewer explicit approval. "Tests are flaky, deleted them" → `Blocking`.

---

## Workflow 3 — Scope Review

**Goal:** PR does *exactly* what its title says — nothing more, nothing less.

- **R3.1** Every changed file MUST be justified by a section in the PR description. If a reviewer cannot map a file to a description section, ask: `Why does this PR touch <file>?`
- **R3.2** No "drive-by" refactors. If the author finds rot, file a separate ticket and PR.
- **R3.3** Public API surface changes (exported functions, REST endpoints, GraphQL schema, protobuf, event payloads) MUST be enumerated in the description under `Public API Changes` or marked `None`.
- **R3.4** UI copy changes, feature flag flips, and config-file edits each MUST be called out in the description even when "small."
- **R3.5** Mixed-domain PRs (e.g., DB migration + API + UI in one PR) MUST justify the coupling. Default = split; coupling = exception.
- **R3.6** A PR labeled `fix` MUST NOT introduce new public APIs.
- **R3.7** A PR labeled `refactor` MUST be behavior-preserving — proven by *unchanged* tests still passing, plus a one-line author attestation in the description: `Behavior-preserving: yes`.

---

## Workflow 4 — Architecture Review

**Goal:** The change lives where it belongs and does not corrode the system.

- **R4.1** New code MUST follow existing module boundaries. Cross-boundary calls require either an existing public interface or a documented new one.
- **R4.2** Dependency direction MUST be acyclic. Reviewer rejects PRs that introduce a cycle even if the build passes today (cycles compound). Run `madge`/`go list -deps`/equivalent if in doubt.
- **R4.3** Business logic MUST NOT live in controllers/handlers, view templates, ORM models, or migration files. Place in a domain/service layer.
- **R4.4** Data-access code (SQL, ORM queries) MUST NOT appear inside service methods that also perform business decisions. Keep query construction in repository/DAO layer.
- **R4.5** New abstractions (interface, base class, generic helper) require: (a) at least two concrete current callers, OR (b) an immediate, written future caller. **No speculative generality.**
- **R4.6** Cross-team dependencies (calling another team's service, reading another team's DB) MUST be reviewed by a code-owner from that team.
- **R4.7** Inheritance for code reuse only is forbidden; prefer composition. Inheritance MUST encode an `is-a` domain relationship.
- **R4.8** Shared mutable global state (singletons, module-level dicts) is forbidden in new code unless gated by a dependency-injection container or explicitly justified for performance with a benchmark.
- **R4.9** Any new service-to-service call MUST declare: timeout, retry policy, circuit breaker behavior, and fallback. Default values from a shared client library are acceptable; ad-hoc HTTP calls are not.
- **R4.10** "Make the next correct change easier" — reviewer MUST mentally simulate the next likely requirement and confirm the design accommodates it without rewrite.

---

## Workflow 5 — Domain Logic Review

**Goal:** The code expresses the business correctly.

- **R5.1** Every state machine MUST be representable as an explicit transition table or enum-driven function. Implicit transitions buried in `if/else` chains require refactor before approval.
- **R5.2** Invalid states MUST be unrepresentable where the type system allows it (e.g., `Result<Paid, Failure>` instead of `Order` with nullable `paidAt`).
- **R5.3** Business rules (pricing, eligibility, permissions, tax, fees, discounts, SLAs) MUST live in a single canonical module. If duplicated across services, the duplication MUST be flagged in the description with the planned consolidation ticket.
- **R5.4** Domain terms in code MUST match the terms in the PRD/glossary. If product says "subscription" and code says "plan", reviewer MUST request rename.
- **R5.5** Money MUST use a fixed-point or decimal type, never `float`/`double`. Currency MUST be tagged on every monetary value at the type level.
- **R5.6** Time MUST be represented as `Instant`/`UTC datetime`. Local times only at presentation boundaries. Durations MUST use a duration type, not raw integers.
- **R5.7** Permission checks MUST be centralized (policy/guard module). Inline `if user.role == 'admin'` in handlers is forbidden.
- **R5.8** Audit-required operations (financial, PII access, admin actions, security-sensitive) MUST emit an audit event in the same transaction as the operation.
- **R5.9** Feature flags gating business behavior MUST have a documented owner and a removal date in the flag definition. Permanent flags require approval from a Director.

---

## Workflow 6 — Correctness Review

**Goal:** Find real bugs before users do.

- **R6.1** Every function accepting external input MUST handle `null`, `undefined`, empty string, empty collection, and oversized input explicitly. Tests MUST cover at least three of these.
- **R6.2** All numeric boundaries (`0`, `1`, `MAX`, `MAX-1`, negative, overflow point) MUST be considered. Off-by-one in pagination, slicing, batching, or time windows is a `Blocking` defect.
- **R6.3** All datetime arithmetic MUST account for timezone, DST, leap seconds (where applicable), and month/year boundaries. Tests MUST include a timezone other than UTC and a DST-transition date.
- **R6.4** Floating-point equality (`==`) on monetary, geographic, or scientific values is forbidden — use epsilon comparison or fixed-point.
- **R6.5** Integer arithmetic on user-controlled input MUST be checked for overflow in languages where it silently wraps (C, C++, Rust release, Go). Use checked arithmetic or saturating ops.
- **R6.6** Any code path that can be retried MUST be idempotent OR protected by a deduplication key. The PR MUST state which.
- **R6.7** Concurrent access to shared state MUST be protected by a documented synchronization primitive (mutex, channel, transaction, optimistic lock). "It's probably fine" → `Blocking`.
- **R6.8** Read-after-write across replicas MUST either route to primary or tolerate stale reads explicitly. Code that assumes synchronous replication MUST cite the replication SLA.
- **R6.9** Cache reads MUST handle `cache miss`, `cache stale`, and `cache returned wrong shape` (post-deploy schema change) cases.
- **R6.10** Backward compatibility window: during a deploy, **N-1 and N MUST coexist** for at least one full deploy cycle. Code that only works after full rollout requires a feature flag and a rollout plan.
- **R6.11** Every `if` branch MUST have a corresponding `else` consideration documented or tested, including the implicit `else` (do nothing) — reviewer MUST ask "what should happen otherwise?"

---

## Workflow 7 — Error Handling Review

**Goal:** Failures are handled deliberately, observable, and safe.

- **R7.1** Catch-all error handlers (`catch (Exception)`, `except:`, `catch(_)`) are forbidden in new code unless: (a) the handler re-raises after side effects (logging, metric), or (b) the function is a top-level boundary (request handler, job runner, main).
- **R7.2** Returning `null`/`None`/`nil` to signal failure is forbidden where the language has `Result`, `Either`, `Option`, or exceptions. Use them.
- **R7.3** Error messages MUST distinguish user-facing copy (safe, actionable) from internal logs (detailed, contextual). Stack traces MUST NOT cross the API boundary in production.
- **R7.4** Every external dependency call MUST classify failures as `retryable | non-retryable | unknown` and act accordingly. Blanket retry on all errors is forbidden.
- **R7.5** Transactions MUST roll back on error. Code that catches an exception inside a transaction and continues without rollback is `Blocking`.
- **R7.6** Partial-success operations (bulk updates, fan-out calls) MUST return a structured result (`succeeded`, `failed`, `errors`) — never silently drop failures.
- **R7.7** Payment, authentication, authorization, and data-mutation failures MUST emit a metric and log at `ERROR` level minimum. Silent swallow → `Blocking`.
- **R7.8** Error logs MUST contain: error type, message, correlation/trace ID, and the smallest reproducing context (user-id only if authorized; never PII in plaintext).
- **R7.9** Retries MUST use exponential backoff with jitter and a bounded retry count. Unbounded retry loops are forbidden.

---

## Workflow 8 — Security Review

**Goal:** Adversary cannot misuse the change.

- **R8.1** Every endpoint MUST enforce authentication and explicit authorization. "Authenticated == authorized" assumption is forbidden — object-level access control (ownership/tenant) MUST be checked.
- **R8.2** Identifiers identifying *whose* resource an action targets (account_id, org_id, customer_id) MUST be derived server-side from the session, **never** trusted from request body or URL path without an ownership verification query.
- **R8.3** All user input crossing a trust boundary MUST be validated against an explicit schema (JSON Schema, Pydantic, Zod, protobuf) before use. No raw `request.body.field` access in handlers.
- **R8.4** SQL MUST be parameterized. String concatenation/format/template-literal SQL is `Blocking`. ORMs MUST be used in their parameterized mode (e.g., no raw `.where()` with interpolated user input).
- **R8.5** HTML/JSX rendering of user-supplied data MUST escape by default. `dangerouslySetInnerHTML`, `v-html`, `innerHTML`, `Markup`, etc. require an inline justification comment and a sanitization step (DOMPurify or equivalent).
- **R8.6** Outbound HTTP from servers MUST validate destinations against an allow-list (SSRF defense). User-supplied URLs without validation → `Blocking`.
- **R8.7** File paths derived from user input MUST be normalized and bounded to a base directory. Reject any path containing `..`, null bytes, or absolute prefixes.
- **R8.8** File uploads MUST validate: MIME (server-side, not just header), magic bytes, size limit, extension allow-list, and store outside the web root with a generated filename.
- **R8.9** Secrets MUST come from a secret manager (Vault, AWS SM, GCP SM, K8s sealed secrets). Hard-coded secrets, secrets in env defaults, secrets in tests → `Blocking`.
- **R8.10** Logs MUST NOT contain: passwords, tokens (full or partial > 8 chars), OTPs, API keys, session IDs, raw PII (SSN, full card number), full request bodies for auth endpoints. Reviewer MUST grep the diff for `log`, `print`, `console` near sensitive variables.
- **R8.11** New cryptography is forbidden. Use vetted libraries (`libsodium`, language-stdlib `crypto`). Hand-rolled hashing, MAC, encryption → `Blocking`.
- **R8.12** Dependencies introduced or upgraded MUST pass the dependency vulnerability scan (Snyk/Dependabot/Trivy). High/Critical CVEs → `Blocking` until resolved.
- **R8.13** Rate limits MUST be defined for: auth endpoints, password reset, OTP, signup, expensive search, write endpoints. Default = block; opt-in = explicit.
- **R8.14** Multi-tenant data access MUST always include a `tenant_id` predicate. Queries without it are `Blocking` even when "the application layer filters" — defense in depth.
- **R8.15** Admin/internal-only endpoints MUST live behind a separate auth scope or network boundary, AND have an explicit admin role check, AND emit an audit log per call.
- **R8.16** CORS, CSRF, CSP, HSTS, and cookie attributes (`HttpOnly`, `Secure`, `SameSite`) MUST be reviewed for any change that touches HTTP middleware or cookie code.

---

## Workflow 9 — Data & Database Review

**Goal:** Schema and data changes are safe, reversible, and observable.

- **R9.1** Schema migrations MUST be backward compatible across one deploy. Disallowed in a single migration: drop column used by N-1, rename column, change column type to incompatible, add `NOT NULL` without default. Use the **expand-migrate-contract** pattern.
- **R9.2** New columns MUST be `NULLABLE` initially OR have a safe default that is correct for all existing rows. `NOT NULL` is added in a follow-up migration after backfill.
- **R9.3** Backfills on tables > 1M rows MUST be batched (chunk size ≤ 10k by default), throttled, idempotent, resumable, and run outside the migration transaction.
- **R9.4** Any migration that takes a long lock (`ALTER TABLE` adding column with default on PG < 11, adding index without `CONCURRENTLY`, MySQL `ALTER` without `pt-online-schema-change`/`gh-ost`) → `Blocking`.
- **R9.5** Indexes MUST be added with `CREATE INDEX CONCURRENTLY` (PG) or online-DDL tooling (MySQL). New indexes MUST be justified by an actual query in the diff.
- **R9.6** Every new query MUST be EXPLAIN-checked. Reviewer MAY request the EXPLAIN plan in the PR for any query touching a table > 1M rows.
- **R9.7** N+1 queries are `Blocking`. Use eager loading, batch loaders (DataLoader pattern), or explicit JOINs.
- **R9.8** Foreign keys MUST be defined for every referential relationship in OLTP schemas, with `ON DELETE` behavior explicitly chosen (`CASCADE`, `RESTRICT`, `SET NULL`).
- **R9.9** Migration files MUST include `up` and `down` (reverse). Irreversible migrations (data drop) require a documented `down` describing the manual recovery.
- **R9.10** Every migration MUST be runnable on a production-sized clone before merge for tables > 10M rows; the PR MUST link the test result.
- **R9.11** Transactions MUST be as short as possible. Long-running transactions wrapping external calls (HTTP, queues) → `Blocking`. Use the outbox pattern.
- **R9.12** New tables MUST have: primary key, `created_at`, `updated_at`, and a tenant/owner column where applicable. Soft-delete columns require a documented retention policy.
- **R9.13** PII columns MUST be tagged in the schema (column comment or schema annotation) and routed to the encryption/tokenization layer.
- **R9.14** Cross-database joins, distributed transactions, and 2PC are forbidden in new code. Use sagas/outbox/eventual consistency with documented compensation.

---

## Workflow 10 — API Contract Review

**Goal:** Public contracts are stable, versioned, and explicit.

- **R10.1** Removing or renaming a field, changing a field type, changing required/optional, changing a status code, or changing an error code is a **breaking change**. Breaking changes MUST go through a versioning process (new version, dual-serve period, deprecation header, sunset date).
- **R10.2** New required request fields are breaking. New optional fields with safe defaults are non-breaking.
- **R10.3** Every public endpoint MUST have an OpenAPI/GraphQL/protobuf schema in the same PR. Schema and implementation MUST be enforced to match in CI.
- **R10.4** Status codes MUST follow standards: `2xx` success, `4xx` client error, `5xx` server error. `200 { "error": ... }` patterns are forbidden in new endpoints.
- **R10.5** Error response shape MUST be uniform across the service: `{ code, message, details?, traceId }`. Inventing per-endpoint error formats → `Blocking`.
- **R10.6** Pagination MUST use cursor pagination for any unbounded list. Offset pagination is allowed only for admin/back-office endpoints.
- **R10.7** Sorting and filtering parameters MUST be enumerated in schema with allow-list. Free-form `sort=<column>` is forbidden (SQL injection risk + index management).
- **R10.8** Rate-limit headers (`X-RateLimit-*` or `Retry-After`) MUST be returned for rate-limited endpoints.
- **R10.9** Mobile clients have **long upgrade tails**. API changes MUST be reviewed against the mobile minimum supported version. Removing fields a v1.0 mobile app reads → `Blocking` until v1.0 is sunset.
- **R10.10** Webhook payload changes are breaking even when "additive" if signed — re-sign and version-bump.
- **R10.11** Idempotency keys MUST be supported on all non-GET endpoints with side effects (payments, sends, creates).

---

## Workflow 11 — Frontend / UI Review

**Goal:** Real users on real devices, real networks, real abilities.

- **R11.1** Every async UI MUST render: `loading`, `empty`, `error`, `partial`, `success` states. Reviewer MUST verify each in the screenshot/storybook.
- **R11.2** Submit buttons MUST be disabled while a request is in-flight; double-click MUST NOT submit twice. Idempotency on the server is defense in depth, not the only defense.
- **R11.3** Forms MUST validate on the client AND the server. Client-only validation → `Blocking`.
- **R11.4** Components MUST hit WCAG 2.1 AA: keyboard reachable, focus visible, ARIA labels for icon buttons, color contrast ≥ 4.5:1 for text, alt text on images, semantic HTML (`<button>` not `<div onClick>`).
- **R11.5** Tab order MUST be logical; modals MUST trap focus and restore on close.
- **R11.6** New user-visible strings MUST be wired through the i18n system. Hard-coded English strings → `Blocking` for products with i18n.
- **R11.7** Date, time, number, currency formatting MUST use locale-aware APIs (`Intl.*` or platform equivalent).
- **R11.8** Sensitive data (full card number, SSN, password) MUST NOT be rendered, logged to the browser console, sent to analytics, or persisted in `localStorage`/`sessionStorage`.
- **R11.9** State management: derived state MUST be computed (memoized), not stored. Storing computed state is a defect because it desyncs.
- **R11.10** Component responsibility: a single component file MUST NOT exceed ~250 lines or contain more than one network-bound effect. Split.
- **R11.11** Bundle impact: any PR adding > 10 KB gzipped to the main bundle MUST justify it in the description. Use dynamic imports for non-critical paths.
- **R11.12** Every interactive element MUST have a stable `data-testid` (or equivalent) for E2E tests.
- **R11.13** Browser support matrix MUST be respected. Use Browserslist + Babel/PostCSS targets; do not add modern APIs without polyfill plan.

---

## Workflow 12 — Performance Review

**Goal:** Performance is reasoned-about, not guessed.

- **R12.1** Reviewer MUST classify the changed code: `per-request | per-user | per-item | per-batch | per-startup`. The acceptable cost differs by class.
- **R12.2** Algorithmic complexity MUST be stated for any new loop over user-controlled data. `O(n²)` over user input → `Blocking` unless n is bounded with a documented hard cap.
- **R12.3** Hot-path code (any code on the request critical path of the top 10 endpoints by traffic) MUST NOT add: synchronous external calls, unbounded queries, JSON parsing of large blobs, unnecessary serialization round-trips.
- **R12.4** Caching: every cache MUST declare TTL, eviction strategy, key namespace, and invalidation triggers. "Cache forever" → `Blocking`.
- **R12.5** Cache stampede protection (lock, single-flight, request coalescing) MUST be present for caches in front of expensive computations.
- **R12.6** Batch sizes and pagination limits MUST be capped (default ≤ 100). User-supplied `limit` parameter MUST be clamped to a server-side max.
- **R12.7** Background jobs MUST have: timeout, retry budget, dead-letter queue, and concurrency limit.
- **R12.8** Response payload MUST NOT exceed 1 MB without justification; default to projection (return only needed fields).
- **R12.9** Performance-sensitive changes MUST include a benchmark or load-test result in the PR.
- **R12.10** "Premature optimization" arguments MUST be backed by a profile showing the optimization is unwarranted; otherwise the rule still applies.

---

## Workflow 13 — Concurrency & Distributed Systems Review

**Goal:** Survive duplication, delay, failure, and reordering.

- **R13.1** Every message handler MUST be idempotent. The idempotency mechanism MUST be named in code: `idempotency_key`, `dedup_id`, version check, or `INSERT ... ON CONFLICT DO NOTHING`.
- **R13.2** Distributed locks MUST have a timeout, fencing token, and a documented behavior on lock-loss. Locks "forever" → `Blocking`.
- **R13.3** "Exactly once" assumptions are forbidden across networks. The system MUST be designed for at-least-once delivery with consumer-side dedup.
- **R13.4** Event ordering assumptions MUST be explicit. If ordering is required, the partition/shard key MUST be specified and documented.
- **R13.5** Outbox pattern MUST be used for "DB write + emit event" to avoid dual-write inconsistency.
- **R13.6** Read-modify-write MUST use optimistic concurrency (`version` column, CAS) or pessimistic locking. Last-write-wins on multi-writer fields → `Blocking` for financial or security data.
- **R13.7** Cross-service workflows MUST be modeled as sagas with documented compensations OR as a deterministic workflow engine (Temporal, Cadence). Ad-hoc multi-call sequences → `Blocking`.
- **R13.8** Every retry MUST have a bounded budget, a backoff with jitter, and a circuit breaker. Naked retry loops → `Blocking`.
- **R13.9** Time-based logic across services MUST tolerate clock skew (≥ 1 minute by default). NTP is not a guarantee.
- **R13.10** Worker shutdown MUST be graceful: drain in-flight work, ack only on completion, support `SIGTERM` with a deadline.

---

## Workflow 14 — Testing Review

**Goal:** Tests prove behavior; tests fail when the code is wrong.

- **R14.1** Every PR with behavior change MUST add or modify tests. "No tests because trivial" requires explicit reviewer waiver.
- **R14.2** Each new function MUST have tests covering: happy path, invalid input, empty input, permission denied, dependency failure, boundary, regression for the linked bug (if `fix`).
- **R14.3** Tests MUST assert behavior, not implementation. Tests that check "method X was called with Y" without checking outcomes are over-mocked → `Blocking`.
- **R14.4** Mocks MUST match real contracts. Use contract tests (Pact, schema-validated mocks) for cross-service mocks.
- **R14.5** Snapshot tests are allowed only for stable, intentional UI/serialization output. Never snapshot-test business logic.
- **R14.6** Flaky tests MUST be quarantined within 24 hours of detection (with a ticket) or fixed. Merging a known-flaky-test PR is forbidden.
- **R14.7** Time-based tests MUST inject a clock; `sleep()` in tests → `Blocking`.
- **R14.8** Random-based tests MUST seed the RNG and log the seed on failure.
- **R14.9** Tests MUST be deterministic across machines, OSes, time zones, and locales. Tests that assume `en-US`, UTC, or a specific OS → `Blocking`.
- **R14.10** Integration tests MUST cover at least: auth boundary, persistence, cross-service call. End-to-end tests cover the top user journeys.
- **R14.11** A test MUST fail when the production code is broken. Reviewer SHOULD mentally mutate the production code and ask "would any test catch this?"
- **R14.12** Migration tests MUST run the migration up + down and verify idempotency.
- **R14.13** Security-sensitive code (auth, permissions, multi-tenant) MUST have a negative test ("user A cannot access user B's resource"). Without it → `Blocking`.

---

## Workflow 15 — Maintainability Review

**Goal:** The code reads well a year from now to an engineer who wasn't here.

- **R15.1** Names MUST be domain-correct, unambiguous, and pronounceable. Single-letter names are forbidden except loop indices and conventional math (`x`, `y`, `i`, `j`).
- **R15.2** Function length: ≤ 50 lines as default, ≤ 100 with justification. Longer = decompose.
- **R15.3** Cyclomatic complexity ≤ 10 per function. Tools: `radon` (Py), `eslint-complexity`, `gocyclo`, etc.
- **R15.4** Boolean parameters in public APIs are forbidden. Use enums (`Mode.DRY_RUN` vs `true`).
- **R15.5** Output parameters and return-by-mutation in new code → `Blocking`. Prefer pure functions returning new values.
- **R15.6** Comments MUST explain *why*, not *what*. `// increment counter` is forbidden. `// Counter is per-tenant to avoid cross-tenant leak in shared cache (see SEC-219)` is good.
- **R15.7** Public functions and modules MUST have a doc comment with: purpose, parameters, return, errors, side effects.
- **R15.8** Duplicate logic across ≥ 3 sites MUST be extracted. Two sites: discretion. One site: do not abstract.
- **R15.9** Dead code (unreachable, unused exports, commented-out blocks, `if false`) MUST be removed.
- **R15.10** Magic numbers and strings MUST become named constants with a comment of origin (PRD section, RFC, regulatory limit).
- **R15.11** File length: ≤ 500 lines in most languages. Larger = split by responsibility.
- **R15.12** Code locality: things that change together MUST live together. Avoid scattering a single concern across 5 files.
- **R15.13** Consistency with existing patterns is preferred over a "better" inconsistent approach. Pattern migration requires a separate dedicated PR with a migration plan.

---

## Workflow 16 — Observability Review

**Goal:** When this breaks at 3am, an on-call engineer can diagnose it from their phone.

- **R16.1** Every new code path MUST emit structured logs (JSON). Free-text logs → `Blocking` for new code.
- **R16.2** Every log line MUST contain: `timestamp`, `level`, `service`, `traceId`, `spanId` (if applicable), `userId` or `tenantId` (if authorized), `event`. Domain context as additional fields.
- **R16.3** Log levels MUST be used correctly: `DEBUG` (off in prod), `INFO` (notable events), `WARN` (recoverable degradation), `ERROR` (failure requiring attention). Routine success at `WARN` → `Blocking`.
- **R16.4** Every external dependency call MUST emit a metric: count, latency histogram, error count tagged by error class. Otherwise the dependency is invisible during incidents.
- **R16.5** Every business-significant event (signup, purchase, plan change, cancellation, refund) MUST emit a metric or analytics event so PMs can detect anomalies.
- **R16.6** Distributed traces MUST propagate `traceparent`/`tracestate` (W3C Trace Context) across all internal calls. Breaking trace propagation → `Blocking`.
- **R16.7** Alerts MUST be defined or linked for: SLO breaches, error-rate spikes, dependency failures, queue backlogs introduced by this PR. "No alert needed" requires explicit justification.
- **R16.8** Audit logs (who did what, when, to which resource) MUST be append-only, time-stamped, signed/checksummed if regulatory.
- **R16.9** Logs MUST NOT be the only signal for production behavior. Critical paths require metrics — log scraping is not a monitoring strategy.
- **R16.10** PII MUST be redacted or hashed in logs and traces. Reviewer greps the diff for sensitive fields near logging calls.
- **R16.11** Background-job logs MUST include `job_id`, `run_id`, `attempt`, `duration`, and `outcome`. Otherwise the job is silent on failure.

---

## Workflow 17 — Deployment & Rollback Review

**Goal:** The change can be released safely and reversed safely.

- **R17.1** Every PR MUST state in the description: `Rollback: <plan>`. Acceptable plans are concrete steps, not "revert PR" alone for stateful changes.
- **R17.2** High-risk changes (auth, payments, data migrations, public API contract, cron schedule, feature flag default) MUST ship behind a feature flag with default OFF and a staged rollout plan: internal → 1% → 10% → 50% → 100%.
- **R17.3** Feature flags MUST have an owner, a creation date, and a planned removal date. Flags older than 90 days require a quarterly cleanup review.
- **R17.4** Migrations and code MUST be deploy-order independent: code can be deployed before migration, after migration, and during partial rollout.
- **R17.5** Config changes (env vars, feature flag definitions, cron specs, queue specs) MUST be reviewed by an infra-aware reviewer.
- **R17.6** Cron and scheduler changes MUST state: previous schedule, new schedule, expected runtime, dependency on other jobs.
- **R17.7** New env variables MUST be added to all environments (dev, staging, prod) with defaults documented in `.env.example` and the deployment system.
- **R17.8** Kill switches MUST exist for any new high-risk integration (third-party payment, third-party AI, third-party messaging) so operators can disable without a deploy.
- **R17.9** Data migrations that are irreversible MUST require Director-level sign-off captured as a PR review approval.
- **R17.10** Post-deploy verification steps MUST be documented (synthetic, smoke test, canary metric) and assigned to an on-call engineer for a defined watch period.

---

## Workflow 18 — Dependency Review

**Goal:** Every external dependency is a long-term liability — accept it knowingly.

- **R18.1** Every new dependency MUST be justified in the PR with: problem solved, alternatives considered (including stdlib), maintainership signal, license, last-release date, security history.
- **R18.2** License MUST be on the approved list (typically MIT/Apache-2.0/BSD; copyleft requires legal review).
- **R18.3** Dependencies with < 1k weekly downloads, single maintainer with no recent activity, or last release > 2 years ago require Staff-engineer approval.
- **R18.4** Transitive dependencies MUST be reviewed for the same criteria — `npm audit`/`pip-audit`/`govulncheck` clean.
- **R18.5** Lockfiles MUST be committed and updated by tooling (no hand-edits).
- **R18.6** Pin to a version range that allows patch updates by default (`^x.y.z` for npm, `~=x.y` for Python). Major version bumps MUST be standalone PRs with a changelog review.
- **R18.7** Deprecating an internal dependency MUST include a migration path and a deprecation timeline. "Just use the new one" without removing the old → `Blocking`.
- **R18.8** Avoid duplicate dependencies that solve the same problem (two HTTP clients, two date libraries). Reviewer flags as `Blocking`.
- **R18.9** Self-hosting risk: if the dependency is abandoned tomorrow, can we fork or replace it within one quarter? If no — escalate.
- **R18.10** Frontend dependencies adding > 10 KB gzipped require a bundle-size justification.

---

## Workflow 19 — Documentation Review

**Goal:** Operators, support, consumers, and future engineers can understand the change.

- **R19.1** README MUST be updated when any of the following change: setup steps, environment variables, run commands, supported versions, architecture overview.
- **R19.2** API doc MUST be updated for any public API change. CI MUST fail when implementation diverges from documented schema.
- **R19.3** Runbook MUST be updated or created for any new on-call surface: alerts, dashboards, common failure modes, escalation paths.
- **R19.4** Changelog/release notes MUST capture user-visible changes, breaking changes, deprecations.
- **R19.5** ADR (Architecture Decision Record) MUST be created when the PR makes a material architectural decision: new service, new data store, new pattern, deprecating a system.
- **R19.6** Internal-only changes MUST update internal docs (Confluence/Notion/repo `/docs`) if they affect another team's mental model.
- **R19.7** Migration runbooks MUST include: precondition checks, batched execution plan, monitoring checkpoints, rollback steps, post-checks.
- **R19.8** Feature-flag definitions MUST include: owner, purpose, default, removal date, dependencies.

---

## Workflow 20 — Review Comment Quality

**Goal:** Comments accelerate the team rather than slow it down.

- **R20.1** Every reviewer comment MUST start with a label: `[Blocking]`, `[Suggestion]`, `[Question]`, `[Nit]`, `[Praise]`. Unlabeled comments are ambiguous.
- **R20.2** `[Blocking]` MUST cite a concrete failure mode, a rule reference, or a reproducer. Vague "I don't like this" → not blocking.
- **R20.3** Reviewer MUST propose a path forward, not just identify a problem. "This is wrong" without "consider X" is forbidden.
- **R20.4** Tone MUST be respectful and depersonalized: critique the code, not the author. Forbidden phrasings: "obviously", "just", "simply", "any junior would know", sarcasm.
- **R20.5** Reviewer MUST acknowledge non-trivial good work with `[Praise]`. Reviewing is not only finding faults.
- **R20.6** Reviewer MUST batch comments and post once, not piecemeal pings, except for `Blocking` security/data issues which warrant immediate notice.
- **R20.7** If the same issue appears > 3 times, write one summary comment with examples instead of repeating per-line.
- **R20.8** Reviewer MUST distinguish "different but acceptable" from "wrong". Personal style is not a `Blocking` reason; the linter is.
- **R20.9** Disagreements that cannot be resolved in two rounds MUST escalate to a synchronous discussion or a tech lead — do not loop indefinitely in comments.
- **R20.10** Author MUST resolve every comment with one of: code change, "Done" + commit ref, "Won't fix because <reason>", or escalation. Silent dismissal → reviewer re-opens.

---

## Workflow 21 — Approval Decision Framework

**Goal:** Approval is a deliberate, principled act.

- **R21.1** Reviewer MUST NOT approve until every `[Blocking]` is resolved or downgraded with explicit justification.
- **R21.2** Reviewer MUST verify, not assume, that CI is green at the time of approval (CI may have been re-triggered by later commits).
- **R21.3** Reviewer MUST re-review after force-push or significant new commits. "Approved + further changes" is not auto-approved.
- **R21.4** Two reviewers required for: schema migrations, auth/permission code, payment code, public API breaking changes, cross-team interfaces, security-sensitive paths.
- **R21.5** Code-owners (`CODEOWNERS`) MUST approve changes in their domain. Bypassing code-owners requires VP-level approval.
- **R21.6** "Rubber stamp" approvals (LGTM in < 5 minutes on a > 200-line PR) are forbidden. Reviewer MUST attest mentally to having read every changed line.
- **R21.7** Self-merge after self-approval is forbidden in production codebases. Emergency hotfixes require a second reviewer in the post-mortem within 48h.
- **R21.8** Approval MUST NOT be given for:
  - known correctness bug (R6),
  - unmitigated security risk (R8),
  - missing tests on critical behavior (R14),
  - design that creates long-term coupling (R4),
  - unsafe migration (R9),
  - irreversible deployment without a written rollback plan (R17).
- **R21.9** Reviewer MUST NOT block on personal preference. If unsure whether a comment is preference or principle, label it `[Suggestion]` not `[Blocking]`.
- **R21.10** Approval is the reviewer's signature on production quality. Treat it accordingly.

---

## Appendix A — Granular Reviewer Checklist (paste into PR template)

**Correctness:** null/empty/invalid input handled · duplicates handled · retry/timeout handled · concurrency considered · stale data tolerated · timezone handled · boundaries tested · large input bounded.

**Security:** authenticated · authorized · tenant-isolated · input validated · output escaped · secrets safe · sensitive logs redacted · ownership verified · injection-safe · rate-limited · secure defaults.

**Performance:** no N+1 · queries indexed · pagination · payload bounded · cache correct (TTL + invalidation) · no hot-path heavy work · no leaks · no unnecessary network calls · bundle size acceptable.

**Maintainability:** clear names · small functions · single responsibility · low duplication · simple control flow · no dead code · useful comments · consistent patterns · easily testable.

**Testing:** happy + edge + failure + permission + regression cases · integration coverage · deterministic · meaningful assertions · not over-mocked.

**Operations:** structured logs · metrics · alerts considered · rollback documented · feature flag used · migration safe · runbook updated · monitoring plan clear.

---

## Appendix B — PR Description Template (enforce in repo)

```markdown
## Problem
<What user/system problem this solves; link PRD/Jira>

## Solution
<High-level approach; key design choices>

## Out of Scope
<Explicit non-goals for this PR>

## Public API / Schema Changes
<None | enumerated; mark breaking>

## Risk
<Blast radius: services/users/data affected; worst-case failure mode>

## Rollback
<Concrete steps; if revert is sufficient, say so and justify>

## Testing
- Unit:
- Integration:
- Manual:
- Load/perf (if applicable):

## Observability
<New logs/metrics/alerts/dashboards>

## Feature Flag / Rollout
<Flag name, default, rollout plan, owner, removal date>

## Linked Ticket
<JIRA-XXXX>
```

---

## Appendix C — Severity & Escalation Matrix

| Severity | Examples | Action |
|---|---|---|
| **P0 — Block + escalate** | Auth bypass, data loss risk, irreversible migration without plan, secret leak, payment correctness bug | Block PR, page Tech Lead, file incident pre-emptively |
| **P1 — Block** | N+1 on hot path, missing tenant filter, missing tests on critical path, breaking API change without versioning, generic catch-all swallow | Block until fixed |
| **P2 — Strongly recommend** | Suboptimal naming, missing docstring on public function, marginal duplication, missing alert | `[Suggestion]`, may merge if author justifies |
| **P3 — Nit** | Style, spelling, optional refactor | `[Nit]`, never blocks |

---

## Appendix D — When to Reject Outright (do not start review)

- PR description missing required sections (R1.1).
- CI red without a written reason (R2.1).
- PR > 400 lines without `[oversized-justified]` (R2.2).
- Refactor mixed with behavior change (R2.3, R3.7).
- Tests deleted without ticket and approval (R2.10).
- Secrets in diff (R2.6).

Return with a single comment quoting the rule. Do not perform deep review on a PR that fails hygiene — it teaches the wrong norm.

---

*This rule set is meant to be enforced by a combination of: bot checks (lint, size limits, CODEOWNERS, secret scan, CI), templated PR descriptions, and reviewer judgment. A rule that is only enforced by goodwill will erode; wire each rule into tooling where possible.*
