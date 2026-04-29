"""Static pre-filters for hybrid rules across workflows 4–17.

Each runner is intentionally pragmatic: simple regex/AST signal that may produce false
positives. The recursive RAG critic re-examines and downgrades unrebutted findings, so
the cost of a false positive is one extra LLM round (cheap). The benefit is high-confidence
deterministic signal that corroborates LLM findings (lifts the `static_corroborated` bit
in the confidence formula).
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from pathlib import Path

from ...ingest.git_extract import BranchDiff
from . import StaticFinding, register
from ._helpers import read_lines, scoped_files

# ============================================================================
#  Workflow 4 — Architecture
# ============================================================================

# R4.7 inheritance_check — class with single base and no domain semantics
_INHERIT_FOR_REUSE = re.compile(
    r"class\s+\w+\s*\(\s*(?:object|BaseModel|Base|Mixin\w*|.*Helper|.*Util\w*)\s*\)"
)


@register("inheritance_check")
def inheritance_check(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py",)):
        for n, line in enumerate(read_lines(p), start=1):
            if _INHERIT_FOR_REUSE.search(line) and "Mixin" not in line:
                yield StaticFinding(
                    rule_id="R4.7",
                    file_path=str(p.relative_to(workdir)),
                    start_line=n, end_line=n,
                    snippet=line.strip()[:200],
                    rationale="Class inherits from a generic helper/util/base — likely inheritance for code reuse, not for an `is-a` domain relationship.",
                    fix_suggestion="Prefer composition: hold the helper as a member, or extract a function module.",
                    confidence=0.5,
                )


# R4.8 global_state — module-level mutable globals
_MODULE_GLOBAL = re.compile(r"^([A-Z_][A-Z0-9_]*)\s*=\s*(?:\{|\[|set\(|dict\(|list\()")


@register("global_state")
def global_state(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py",)):
        for n, line in enumerate(read_lines(p), start=1):
            if _MODULE_GLOBAL.match(line.lstrip()) and not line.lstrip().startswith("#"):
                # Distinguish from constants (CONST = (1,2)): mutable types only.
                yield StaticFinding(
                    rule_id="R4.8",
                    file_path=str(p.relative_to(workdir)),
                    start_line=n, end_line=n,
                    snippet=line.strip()[:200],
                    rationale="Module-level mutable container looks like shared mutable global state. Forbidden in new code unless DI-injected or benchmarked.",
                    fix_suggestion="Move into a class, factory, or DI container. Constants stay tuples/frozensets.",
                    confidence=0.4,
                )


# R4.9 http_client_decl — raw HTTP without timeout/retry
_HTTP_CALL = re.compile(
    r"\b(?:requests|httpx|urllib\.request|aiohttp\.ClientSession)\.(?:get|post|put|delete|patch|head)\s*\("
)
_FETCH_CALL = re.compile(r"\bfetch\s*\(")


@register("http_client_decl")
def http_client_decl(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py", ".ts", ".tsx", ".js", ".jsx")):
        lines = read_lines(p)
        for n, line in enumerate(lines, start=1):
            if not (_HTTP_CALL.search(line) or _FETCH_CALL.search(line)):
                continue
            window = " ".join(lines[max(0, n - 2): n + 4]).lower()
            if "timeout" in window or "abortcontroller" in window or "withcircuit" in window:
                continue
            yield StaticFinding(
                rule_id="R4.9",
                file_path=str(p.relative_to(workdir)),
                start_line=n, end_line=n,
                snippet=line.strip()[:200],
                rationale="HTTP call has no nearby `timeout`/`AbortController`. Service-to-service calls must declare timeout, retry, circuit-breaker, fallback.",
                fix_suggestion="Pass `timeout=5` (or your shared client's default) and route through the team's HTTP wrapper.",
                confidence=0.5,
            )


# ============================================================================
#  Workflow 5 — Domain Logic
# ============================================================================

# R5.5 money_float — float used for monetary values
_MONEY_VAR = r"(?:price|amount|cost|fee|tax|total|subtotal|balance|charge|payment|salary|income|revenue)"
_MONEY_FLOAT = re.compile(rf"\b{_MONEY_VAR}\b\s*[:=]\s*(?:float\(|\d+\.\d+)", re.I)


@register("money_float")
def money_float(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py", ".ts", ".tsx", ".js", ".go", ".java")):
        for n, line in enumerate(read_lines(p), start=1):
            if _MONEY_FLOAT.search(line):
                yield StaticFinding(
                    rule_id="R5.5",
                    file_path=str(p.relative_to(workdir)),
                    start_line=n, end_line=n,
                    snippet=line.strip()[:200],
                    rationale="Monetary value held as `float`. Floating-point on money is a financial bug — use Decimal/fixed-point.",
                    fix_suggestion="Use `decimal.Decimal` (Python), `bignumber.js` (JS), `BigDecimal` (Java/Kotlin). Tag currency at the type level.",
                    confidence=0.55,
                )


# R5.6 time_local — local datetime / `datetime.now()` without tz
_LOCAL_TIME_PY = re.compile(r"\bdatetime\.now\s*\(\s*\)")
_LOCAL_TIME_PY2 = re.compile(r"\.now\(\)\.replace\(tzinfo=None\)")
_LOCAL_TIME_JS = re.compile(r"\bnew\s+Date\s*\(\s*\)")  # default timezone


@register("time_local")
def time_local(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py", ".ts", ".js", ".tsx", ".jsx")):
        for n, line in enumerate(read_lines(p), start=1):
            if _LOCAL_TIME_PY.search(line) or _LOCAL_TIME_PY2.search(line):
                yield StaticFinding(
                    rule_id="R5.6",
                    file_path=str(p.relative_to(workdir)),
                    start_line=n, end_line=n,
                    snippet=line.strip()[:200],
                    rationale="`datetime.now()` without tz returns local time. Time at the boundary of a system must be UTC.",
                    fix_suggestion="Use `datetime.now(timezone.utc)` or `datetime.utcnow().replace(tzinfo=timezone.utc)`.",
                    confidence=0.7,
                )


# R5.7 inline_authz — inline role/permission checks in handlers
_INLINE_ROLE = re.compile(r"\b(?:user|request\.user|ctx\.user|self\.user)\.(?:role|is_admin|is_superuser)\s*[!=]=\s*['\"]")


@register("inline_authz")
def inline_authz(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py", ".ts", ".tsx", ".js", ".go")):
        for n, line in enumerate(read_lines(p), start=1):
            if _INLINE_ROLE.search(line):
                yield StaticFinding(
                    rule_id="R5.7",
                    file_path=str(p.relative_to(workdir)),
                    start_line=n, end_line=n,
                    snippet=line.strip()[:200],
                    rationale="Inline role/permission check (e.g. `user.role == 'admin'`). Permissions must live in a centralized policy module.",
                    fix_suggestion="Replace with `policy.can(user, 'admin:write_resource')` or equivalent guard from your auth layer.",
                    confidence=0.7,
                )


# ============================================================================
#  Workflow 6 — Correctness
# ============================================================================

# R6.4 float_eq_money — `==` on float (especially money-named vars)
_FLOAT_EQ = re.compile(rf"\b{_MONEY_VAR}\b\s*==", re.I)


@register("float_eq_money")
def float_eq_money(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py", ".ts", ".js", ".go", ".java")):
        for n, line in enumerate(read_lines(p), start=1):
            if _FLOAT_EQ.search(line):
                yield StaticFinding(
                    rule_id="R6.4",
                    file_path=str(p.relative_to(workdir)),
                    start_line=n, end_line=n,
                    snippet=line.strip()[:200],
                    rationale="`==` on a money-named variable. Floating-point equality is unsafe.",
                    fix_suggestion="Use Decimal equality, or a tolerance: `abs(a - b) < epsilon`.",
                    confidence=0.5,
                )


# R6.5 int_overflow — checked arithmetic missing on user-controlled input (Go/Rust/C)
@register("int_overflow")
def int_overflow(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".go", ".rs", ".c", ".cpp", ".cc")):
        lines = read_lines(p)
        for n, line in enumerate(lines, start=1):
            if re.search(r"\b(?:int|uint|u32|u64|i32|i64)\s*[\+\-\*]", line) and "checked" not in line and "saturating" not in line:
                # Heuristic — only flag arithmetic involving user input keywords
                window = " ".join(lines[max(0, n - 4): n + 1]).lower()
                if any(t in window for t in ("input", "request", "user", "param", "body")):
                    yield StaticFinding(
                        rule_id="R6.5",
                        file_path=str(p.relative_to(workdir)),
                        start_line=n, end_line=n,
                        snippet=line.strip()[:200],
                        rationale="Untrusted integer arithmetic without checked/saturating ops in a language that wraps silently.",
                        fix_suggestion="Use `checked_add`/`checked_mul` (Rust), `math/big` or explicit bounds check (Go), `__builtin_*_overflow` (C/C++).",
                        confidence=0.4,
                    )
                    break


# R6.6 retry_idempotency — retry decorator without idempotency key
_RETRY_DECO = re.compile(r"@retry\b|@tenacity\.retry|@backoff\.|@retryable\b")


@register("retry_idempotency")
def retry_idempotency(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py", ".ts", ".js", ".go")):
        lines = read_lines(p)
        for n, line in enumerate(lines, start=1):
            if not _RETRY_DECO.search(line):
                continue
            window = " ".join(lines[n: n + 12]).lower()
            if "idempotency" in window or "dedup" in window or "on conflict" in window:
                continue
            yield StaticFinding(
                rule_id="R6.6",
                file_path=str(p.relative_to(workdir)),
                start_line=n, end_line=n,
                snippet=line.strip()[:200],
                rationale="Retry decorator on a function with no visible idempotency key or dedup. Retried side effects double-execute.",
                fix_suggestion="Either prove idempotency (deterministic + same args = same outcome) or add an idempotency key column / `INSERT ... ON CONFLICT DO NOTHING`.",
                confidence=0.5,
            )


# R6.7 concurrency_unsafe — module-level set/dict mutated without locks
_SHARED_MUT = re.compile(r"^\s*([a-z_][a-z0-9_]*)\s*=\s*(?:set\(\)|dict\(\)|list\(\)|\{\}|\[\])")


@register("concurrency_unsafe")
def concurrency_unsafe(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py",)):
        text = "\n".join(read_lines(p))
        if "threading" not in text and "asyncio" not in text and "concurrent.futures" not in text:
            continue
        for n, line in enumerate(text.splitlines(), start=1):
            m = _SHARED_MUT.match(line)
            if m and "self." not in line and ".lock" not in text[: text.find(line)].lower():
                yield StaticFinding(
                    rule_id="R6.7",
                    file_path=str(p.relative_to(workdir)),
                    start_line=n, end_line=n,
                    snippet=line.strip()[:200],
                    rationale=f"Module-level mutable `{m.group(1)}` in a file using threading/asyncio with no visible lock.",
                    fix_suggestion="Wrap accesses in a `Lock`, switch to `queue.Queue`, or restructure to avoid shared state.",
                    confidence=0.4,
                )


# ============================================================================
#  Workflow 7 — Error Handling
# ============================================================================

# R7.1 catch_all
_CATCH_ALL_PY = re.compile(r"^\s*except(?:\s*Exception\s*)?(?:\s+as\s+\w+)?\s*:")
_CATCH_ALL_BARE = re.compile(r"^\s*except\s*:")
_CATCH_ALL_JS = re.compile(r"\}\s*catch\s*\(\s*[\w_]*\s*\)\s*\{")


@register("catch_all")
def catch_all(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py", ".ts", ".tsx", ".js", ".jsx", ".java")):
        lines = read_lines(p)
        for n, line in enumerate(lines, start=1):
            py_bare = _CATCH_ALL_BARE.match(line)
            py_excpt = _CATCH_ALL_PY.match(line) and "as" in line and "Exception" in line
            js = _CATCH_ALL_JS.search(line)
            if not (py_bare or py_excpt or js):
                continue
            # Allow if next 5 lines re-raise / log + raise.
            window = "\n".join(lines[n: n + 6])
            if "raise" in window or "throw" in window:
                continue
            yield StaticFinding(
                rule_id="R7.1",
                file_path=str(p.relative_to(workdir)),
                start_line=n, end_line=n,
                snippet=line.strip()[:200],
                rationale="Catch-all swallowing exceptions without re-raising. Forbidden in new code unless this is a top-level boundary.",
                fix_suggestion="Catch specific exceptions, or re-raise after logging/metric.",
                confidence=0.65,
            )


# R7.2 null_failure — `return None` after error path
_RETURN_NONE_AFTER_ERROR = re.compile(r"except[^:]*:\s*\n\s+(?:log|print|pass|return\s+None)", re.M)


@register("null_failure")
def null_failure(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py",)):
        text = "\n".join(read_lines(p))
        for m in _RETURN_NONE_AFTER_ERROR.finditer(text):
            line_no = text[: m.start()].count("\n") + 1
            yield StaticFinding(
                rule_id="R7.2",
                file_path=str(p.relative_to(workdir)),
                start_line=line_no, end_line=line_no,
                snippet=text[m.start(): m.end()].strip()[:200],
                rationale="`return None` from an exception handler signals failure with a sentinel. Use Result/Either/exception instead.",
                fix_suggestion="Re-raise, return a `Result[Ok, Err]`, or raise a specific domain exception.",
                confidence=0.55,
            )


# R7.5 tx_rollback — `except` inside `with transaction` without rollback
_TRANSACTION = re.compile(r"\bwith\s+(?:db\.)?transaction\.atomic\b|\.begin\(\)|BEGIN;|START TRANSACTION", re.I)


@register("tx_rollback")
def tx_rollback(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py", ".ts", ".js", ".go")):
        lines = read_lines(p)
        full = "\n".join(lines)
        if not _TRANSACTION.search(full):
            continue
        # Line-scan: when we see a transaction-opening line, look at next 40 lines for except-without-raise.
        for n, line in enumerate(lines, start=1):
            if not _TRANSACTION.search(line):
                continue
            block = "\n".join(lines[n: n + 40])
            if "except" in block and "raise" not in block and "rollback" not in block.lower():
                yield StaticFinding(
                    rule_id="R7.5",
                    file_path=str(p.relative_to(workdir)),
                    start_line=n, end_line=n,
                    snippet="transaction block with except but no raise/rollback",
                    rationale="Catching an exception inside a transaction without rollback or re-raise leaves a half-committed state.",
                    fix_suggestion="Re-raise after recording the error, or call rollback explicitly.",
                    confidence=0.5,
                )
                break


# R7.9 unbounded_retry — `while True:` with retry-shaped body
_INF_RETRY = re.compile(r"while\s+True\s*:")


@register("unbounded_retry")
def unbounded_retry(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py",)):
        lines = read_lines(p)
        for n, line in enumerate(lines, start=1):
            if not _INF_RETRY.search(line):
                continue
            window = " ".join(lines[n: n + 12]).lower()
            if "retry" not in window and "attempt" not in window:
                continue
            if "break" not in window and "max_attempts" not in window:
                yield StaticFinding(
                    rule_id="R7.9",
                    file_path=str(p.relative_to(workdir)),
                    start_line=n, end_line=n,
                    snippet=line.strip()[:200],
                    rationale="`while True:` retry loop with no visible bound or `break`. Unbounded retries hammer downstream services.",
                    fix_suggestion="Cap with `for attempt in range(max_attempts):` and exponential backoff with jitter.",
                    confidence=0.55,
                )


# ============================================================================
#  Workflow 8 — Security
# ============================================================================

# R8.5 html_unsafe
_HTML_UNSAFE = re.compile(
    r"\b(?:dangerouslySetInnerHTML|innerHTML\s*=|v-html\s*=|outerHTML\s*=)\b"
)


@register("html_unsafe")
def html_unsafe(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".tsx", ".jsx", ".ts", ".js", ".vue", ".html")):
        for n, line in enumerate(read_lines(p), start=1):
            if _HTML_UNSAFE.search(line):
                yield StaticFinding(
                    rule_id="R8.5",
                    file_path=str(p.relative_to(workdir)),
                    start_line=n, end_line=n,
                    snippet=line.strip()[:200],
                    rationale="Unsafe HTML rendering of user-supplied data. XSS vector unless the source is sanitized.",
                    fix_suggestion="Sanitize via DOMPurify (or equivalent) before injection. Add an inline comment justifying the use.",
                    confidence=0.85,
                )


# R8.6 ssrf — outbound HTTP with user-controlled URL
_SSRF_HINT = re.compile(
    r"(?:requests|httpx|fetch|axios)\.(?:get|post|put|delete)\s*\(\s*(?:request|req|params|body|input|user_input)"
)


@register("ssrf")
def ssrf(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py", ".ts", ".js")):
        for n, line in enumerate(read_lines(p), start=1):
            if _SSRF_HINT.search(line):
                yield StaticFinding(
                    rule_id="R8.6",
                    file_path=str(p.relative_to(workdir)),
                    start_line=n, end_line=n,
                    snippet=line.strip()[:200],
                    rationale="Outbound HTTP whose URL appears to come from the request — SSRF unless validated against an allow-list.",
                    fix_suggestion="Validate the URL against an allow-list of hosts/IP ranges. Reject metadata endpoints (169.254.169.254 etc.).",
                    confidence=0.7,
                )


# R8.7 path_traversal — Path() / open() with unvalidated user input
_PATH_TRAVERSAL = re.compile(
    r"(?:open|Path|os\.path\.join|fs\.readFile|fs\.createReadStream)\s*\(\s*(?:request|req|params|body|input|filename)\b"
)


@register("path_traversal")
def path_traversal(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py", ".ts", ".js")):
        for n, line in enumerate(read_lines(p), start=1):
            if _PATH_TRAVERSAL.search(line):
                yield StaticFinding(
                    rule_id="R8.7",
                    file_path=str(p.relative_to(workdir)),
                    start_line=n, end_line=n,
                    snippet=line.strip()[:200],
                    rationale="File path likely derived from request input. Reject `..`, null bytes, absolute paths; bound to a base directory.",
                    fix_suggestion="`safe = (base / Path(name).name).resolve(); assert base in safe.parents`. Or use a path-traversal-safe library.",
                    confidence=0.6,
                )


# R8.8 file_upload
_UPLOAD_HINT = re.compile(r"\b(?:multer|UploadFile|FileField|multipart/form-data|UploadedFile)\b")


@register("file_upload")
def file_upload(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py", ".ts", ".js", ".go", ".java")):
        text = "\n".join(read_lines(p))
        if not _UPLOAD_HINT.search(text):
            continue
        if "magic" in text or "mimetype" in text.lower() or "content_type" in text.lower():
            continue  # at least some validation
        yield StaticFinding(
            rule_id="R8.8",
            file_path=str(p.relative_to(workdir)),
            start_line=1, end_line=1,
            snippet="file-upload handler without visible MIME / magic-byte / size validation",
            rationale="File-upload code without nearby MIME/magic-byte/size checks. Polyglot files and archive bombs are real.",
            fix_suggestion="Validate MIME server-side (not just headers), check magic bytes, enforce size cap, store outside the web root with a generated filename.",
            confidence=0.5,
        )


# R8.10 log_secrets
_LOG_CALL = re.compile(r"\b(?:log\.(?:info|debug|warn|error)|logger\.(?:info|debug|warn|error)|print|console\.(?:log|info|debug))\s*\(")
_SECRET_NEAR = re.compile(r"\b(?:password|token|secret|api_key|apikey|authorization|cookie|session|otp|ssn)\b", re.I)


@register("log_secrets")
def log_secrets(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".java")):
        for n, line in enumerate(read_lines(p), start=1):
            if _LOG_CALL.search(line) and _SECRET_NEAR.search(line):
                yield StaticFinding(
                    rule_id="R8.10",
                    file_path=str(p.relative_to(workdir)),
                    start_line=n, end_line=n,
                    snippet=line.strip()[:200],
                    rationale="Log line contains a sensitive variable name (password/token/secret/etc.). Logs must redact.",
                    fix_suggestion="Redact at the log boundary. Use a structured logger with field allow-listing, or `***` placeholders.",
                    confidence=0.7,
                )


# R8.14 tenant_predicate — SQL queries missing tenant_id filter (line-scanning, no ReDoS).
_TENANT_TERMS = re.compile(r"\b(?:tenant_id|org_id|workspace_id|account_id)\b", re.I)


@register("tenant_predicate")
def tenant_predicate(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py", ".ts", ".js", ".go", ".sql")):
        lines = read_lines(p)
        full = "\n".join(lines).lower()
        if "tenant" not in full and "org_id" not in full and "workspace" not in full:
            continue  # repo doesn't use multi-tenant naming; skip
        # Walk a small window per SELECT occurrence.
        for n, line in enumerate(lines, start=1):
            up = line.upper()
            if "SELECT" not in up:
                continue
            window = "\n".join(lines[n - 1: n + 5])
            up_w = window.upper()
            if "FROM" not in up_w or "WHERE" not in up_w:
                continue
            if _TENANT_TERMS.search(window):
                continue
            yield StaticFinding(
                rule_id="R8.14",
                file_path=str(p.relative_to(workdir)),
                start_line=n, end_line=n,
                snippet=line.strip()[:200],
                rationale="SQL with `WHERE` but no tenant predicate (`tenant_id`/`org_id`/`workspace_id`). Defense in depth: every multi-tenant query carries the predicate.",
                fix_suggestion="Add `AND tenant_id = :tenant_id` to the WHERE clause.",
                confidence=0.55,
            )


# ============================================================================
#  Workflow 9 — Data & DB
# ============================================================================

_NOT_NULL_NO_DEFAULT = re.compile(
    r"\bALTER\s+TABLE\s+\w+\s+ADD\s+(?:COLUMN\s+)?\w+\s+\w+(?!\s*DEFAULT)\s*[^,;]*\bNOT\s+NULL\b",
    re.I,
)


@register("not_null_no_default")
def not_null_no_default(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".sql",)):
        for n, line in enumerate(read_lines(p), start=1):
            if _NOT_NULL_NO_DEFAULT.search(line):
                yield StaticFinding(
                    rule_id="R9.2",
                    file_path=str(p.relative_to(workdir)),
                    start_line=n, end_line=n,
                    snippet=line.strip()[:200],
                    rationale="`ADD COLUMN ... NOT NULL` without a default fails on tables with existing rows.",
                    fix_suggestion="Add column NULLABLE or with a safe default; backfill in batches; promote to NOT NULL in a follow-up migration.",
                )


_LONG_LOCK = re.compile(
    r"\b(?:ALTER\s+TABLE|DROP\s+(?:COLUMN|TABLE)|RENAME\s+(?:COLUMN|TABLE))\b(?![^\n]*\bCONCURRENTLY\b)",
    re.I,
)


@register("long_lock")
def long_lock(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".sql",)):
        for n, line in enumerate(read_lines(p), start=1):
            if _LONG_LOCK.search(line) and "ADD CONSTRAINT" not in line.upper():
                yield StaticFinding(
                    rule_id="R9.4",
                    file_path=str(p.relative_to(workdir)),
                    start_line=n, end_line=n,
                    snippet=line.strip()[:200],
                    rationale="DDL operation that takes a long lock on a busy table.",
                    fix_suggestion="Use `gh-ost`/`pt-online-schema-change` (MySQL) or expand-migrate-contract pattern (PG).",
                )


_DDL_UNSAFE = re.compile(r"\bDROP\s+COLUMN\b|\bRENAME\s+COLUMN\b|\bALTER\s+COLUMN[^\n]*TYPE\b", re.I)


@register("migration_safety")
def migration_safety(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".sql",)):
        for n, line in enumerate(read_lines(p), start=1):
            if _DDL_UNSAFE.search(line):
                yield StaticFinding(
                    rule_id="R9.1",
                    file_path=str(p.relative_to(workdir)),
                    start_line=n, end_line=n,
                    snippet=line.strip()[:200],
                    rationale="Migration appears to drop/rename/retype a column in a single step. Breaks N-1 readers during deploy.",
                    fix_suggestion="Use expand-migrate-contract: add new, dual-write, backfill, swap, drop in a separate release.",
                )


# R9.7 nplus1 — query inside loop, line-scanning to avoid regex backtracking.
_LOOP_HEAD = re.compile(r"^\s*(?:for|while)\s+\S")
_QUERY_CALL = re.compile(r"\.(?:execute|query|find_one|fetchall|fetchone|objects\.|filter|select)\s*\(")


@register("nplus1")
def nplus1(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py", ".ts", ".js")):
        lines = read_lines(p)
        n = len(lines)
        i = 0
        while i < n:
            line = lines[i]
            if _LOOP_HEAD.match(line):
                # Determine loop body indent (Python-friendly; harmless on JS/TS where indent is also typical).
                head_indent = len(line) - len(line.lstrip())
                # Look at the next 8 lines while still inside the loop body.
                j = i + 1
                while j < n and j < i + 9:
                    body = lines[j]
                    if not body.strip():
                        j += 1
                        continue
                    body_indent = len(body) - len(body.lstrip())
                    if body_indent <= head_indent:
                        break
                    if _QUERY_CALL.search(body):
                        yield StaticFinding(
                            rule_id="R9.7",
                            file_path=str(p.relative_to(workdir)),
                            start_line=i + 1,
                            end_line=j + 1,
                            snippet=body.strip()[:240],
                            rationale="Database call inside a loop — almost always an N+1.",
                            fix_suggestion="Use a JOIN, eager-load relationships, or a batch loader (DataLoader pattern).",
                            confidence=0.55,
                        )
                        break
                    j += 1
            i += 1


_FK_NO_ON_DELETE = re.compile(r"\bFOREIGN\s+KEY\b[^\n]*\bREFERENCES\b[^\n]*(?<!ON\sDELETE)\s*\)", re.I | re.S)


@register("foreign_keys")
def foreign_keys(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".sql",)):
        for n, line in enumerate(read_lines(p), start=1):
            if "FOREIGN KEY" in line.upper() and "ON DELETE" not in line.upper():
                yield StaticFinding(
                    rule_id="R9.8",
                    file_path=str(p.relative_to(workdir)),
                    start_line=n, end_line=n,
                    snippet=line.strip()[:200],
                    rationale="Foreign key without explicit `ON DELETE` behavior. Default cascade behavior varies by engine.",
                    fix_suggestion="Choose: `ON DELETE CASCADE | RESTRICT | SET NULL` based on the relationship semantics.",
                )


_CREATE_TABLE = re.compile(r"\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)", re.I)


@register("table_pk_timestamps")
def table_pk_timestamps(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".sql",)):
        text = "\n".join(read_lines(p))
        for m in _CREATE_TABLE.finditer(text):
            tname = m.group(1)
            block_match = re.search(rf"CREATE\s+TABLE[\s\S]+?{tname}[\s\S]+?\(([\s\S]+?)\)\s*;", text, re.I)
            if not block_match:
                continue
            cols = block_match.group(1).lower()
            missing = []
            if "primary key" not in cols:
                missing.append("primary key")
            if "created_at" not in cols:
                missing.append("created_at")
            if "updated_at" not in cols:
                missing.append("updated_at")
            if missing:
                line_no = text[: m.start()].count("\n") + 1
                yield StaticFinding(
                    rule_id="R9.12",
                    file_path=str(p.relative_to(workdir)),
                    start_line=line_no, end_line=line_no,
                    snippet=f"CREATE TABLE {tname} missing: {', '.join(missing)}",
                    rationale=f"New table `{tname}` is missing: {', '.join(missing)}.",
                    fix_suggestion="Add primary key + `created_at TIMESTAMPTZ DEFAULT NOW()` + `updated_at TIMESTAMPTZ`.",
                    confidence=0.65,
                )


# ============================================================================
#  Workflow 10 — API Contract
# ============================================================================

_RESP_200_ERROR = re.compile(r"status_code\s*=\s*200|status\(200\)|\.status\(200\)", re.I)
_RESP_ERROR_KEY = re.compile(r"['\"]error['\"]\s*:")


@register("status_codes")
def status_codes(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py", ".ts", ".js", ".go")):
        text = "\n".join(read_lines(p))
        if not _RESP_200_ERROR.search(text):
            continue
        for n, line in enumerate(text.splitlines(), start=1):
            if _RESP_200_ERROR.search(line):
                window = " ".join(text.splitlines()[n - 1: n + 4])
                if _RESP_ERROR_KEY.search(window):
                    yield StaticFinding(
                        rule_id="R10.4",
                        file_path=str(p.relative_to(workdir)),
                        start_line=n, end_line=n,
                        snippet=line.strip()[:200],
                        rationale="`200 { \"error\": ... }` pattern — status codes must follow standards (4xx/5xx for errors).",
                        fix_suggestion="Return the right status code: 400 for client errors, 500 for server errors. Reserve 200 for success.",
                        confidence=0.7,
                    )


_SORT_QUERY = re.compile(r"\bsort\s*=\s*(?:request|req|params|body|input)\.")


@register("sort_allowlist")
def sort_allowlist(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py", ".ts", ".js", ".go")):
        for n, line in enumerate(read_lines(p), start=1):
            if _SORT_QUERY.search(line):
                yield StaticFinding(
                    rule_id="R10.7",
                    file_path=str(p.relative_to(workdir)),
                    start_line=n, end_line=n,
                    snippet=line.strip()[:200],
                    rationale="Free-form `sort=<column>` from request — SQL injection risk plus index management nightmare.",
                    fix_suggestion="Enumerate sortable columns in the schema; reject anything not on the allow-list.",
                    confidence=0.7,
                )


# ============================================================================
#  Workflow 11 — Frontend
# ============================================================================

_DIV_ONCLICK = re.compile(r"<div[^>]*\bonClick=", re.I)
_IMG_NO_ALT = re.compile(r"<img\b(?![^>]*\balt=)")


@register("a11y")
def a11y(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".tsx", ".jsx", ".vue", ".html")):
        for n, line in enumerate(read_lines(p), start=1):
            if _DIV_ONCLICK.search(line):
                yield StaticFinding(
                    rule_id="R11.4",
                    file_path=str(p.relative_to(workdir)),
                    start_line=n, end_line=n,
                    snippet=line.strip()[:200],
                    rationale="`<div onClick>` is not keyboard-reachable. Use `<button>` or add `role=\"button\"` + `tabIndex` + key handlers.",
                    fix_suggestion="Replace with `<button>`, or add `role=\"button\" tabIndex={0} onKeyDown={handle}`.",
                    confidence=0.75,
                )
            if _IMG_NO_ALT.search(line):
                yield StaticFinding(
                    rule_id="R11.4",
                    file_path=str(p.relative_to(workdir)),
                    start_line=n, end_line=n,
                    snippet=line.strip()[:200],
                    rationale="`<img>` without `alt`. Decorative images need `alt=\"\"`; meaningful images need a description.",
                    fix_suggestion="Add `alt=\"…\"` (decorative: `alt=\"\"`).",
                    confidence=0.85,
                )


_CLIENT_PII = re.compile(
    r"\b(?:localStorage|sessionStorage)\.setItem\s*\(\s*['\"](?:password|token|ssn|card|cvv|cvc|secret)['\"]",
    re.I,
)


@register("client_pii")
def client_pii(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".tsx", ".jsx", ".ts", ".js", ".vue")):
        for n, line in enumerate(read_lines(p), start=1):
            if _CLIENT_PII.search(line):
                yield StaticFinding(
                    rule_id="R11.8",
                    file_path=str(p.relative_to(workdir)),
                    start_line=n, end_line=n,
                    snippet=line.strip()[:200],
                    rationale="Sensitive value persisted to `localStorage`/`sessionStorage`. Never store secrets in browser storage — readable by any script.",
                    fix_suggestion="Use httpOnly cookies for auth; keep secrets server-side; never persist card data client-side.",
                    confidence=0.9,
                )


# ============================================================================
#  Workflow 12 — Performance
# ============================================================================

# R12.6 pagination_caps — limit param read from request without clamp
_LIMIT_FROM_REQ = re.compile(r"\blimit\s*=\s*(?:int\()?(?:request|req|params|body)\.")


@register("pagination_caps")
def pagination_caps(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py", ".ts", ".js", ".go")):
        text = "\n".join(read_lines(p))
        for n, line in enumerate(text.splitlines(), start=1):
            if not _LIMIT_FROM_REQ.search(line):
                continue
            window = " ".join(text.splitlines()[n - 1: n + 5]).lower()
            if "min(" in window or "clamp" in window or "max_limit" in window:
                continue
            yield StaticFinding(
                rule_id="R12.6",
                file_path=str(p.relative_to(workdir)),
                start_line=n, end_line=n,
                snippet=line.strip()[:200],
                rationale="`limit=` taken from request without clamping. A user can request limit=10_000_000 and exhaust the database.",
                fix_suggestion="Clamp: `limit = min(int(request.limit or 50), MAX_PAGE_SIZE)`.",
                confidence=0.7,
            )


# R12.3 hot_path — synchronous slow call (sleep, requests.get) inside a request handler
_SLOW_IN_HANDLER = re.compile(r"\b(?:time\.sleep|requests\.get|httpx\.get)\s*\(")


@register("hot_path")
def hot_path(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py", ".ts", ".js")):
        text = "\n".join(read_lines(p))
        if "@app.route" not in text and "@router." not in text and "FastAPI" not in text and "@RestController" not in text:
            continue
        for n, line in enumerate(text.splitlines(), start=1):
            if _SLOW_IN_HANDLER.search(line):
                yield StaticFinding(
                    rule_id="R12.3",
                    file_path=str(p.relative_to(workdir)),
                    start_line=n, end_line=n,
                    snippet=line.strip()[:200],
                    rationale="Synchronous blocking call (sleep / sync HTTP) on what looks like a request path.",
                    fix_suggestion="Move off the request path. Use async client + timeout, or push to a background job.",
                    confidence=0.6,
                )


# ============================================================================
#  Workflow 14 — Testing
# ============================================================================

_TEST_SLEEP = re.compile(r"\b(?:time\.sleep|setTimeout|sleep\s*\(\s*\d+)")


@register("test_sleep")
def test_sleep(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py", ".ts", ".js", ".go")):
        rel = str(p.relative_to(workdir))
        if not any(t in rel.lower() for t in ("test", "spec", "_test", ".test.", ".spec.")):
            continue
        for n, line in enumerate(read_lines(p), start=1):
            if _TEST_SLEEP.search(line):
                yield StaticFinding(
                    rule_id="R14.7",
                    file_path=rel,
                    start_line=n, end_line=n,
                    snippet=line.strip()[:200],
                    rationale="`sleep` in tests. Time-based tests must inject a clock — flaky on slow CI.",
                    fix_suggestion="Mock the clock: `freezegun`, `sinon.useFakeTimers`, or a `Clock` interface.",
                    confidence=0.85,
                )


_RANDOM_NO_SEED = re.compile(r"\brandom\.(?:random|randint|choice|sample|shuffle)\s*\(")


@register("rng_seed")
def rng_seed(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py",)):
        rel = str(p.relative_to(workdir))
        if not any(t in rel.lower() for t in ("test", "spec", "_test")):
            continue
        text = "\n".join(read_lines(p))
        if "random.seed" in text or "Random(" in text:
            continue
        for n, line in enumerate(text.splitlines(), start=1):
            if _RANDOM_NO_SEED.search(line):
                yield StaticFinding(
                    rule_id="R14.8",
                    file_path=rel,
                    start_line=n, end_line=n,
                    snippet=line.strip()[:200],
                    rationale="Test uses `random.*` but no visible seed. Failures will be unreproducible.",
                    fix_suggestion="`random.seed(seed); print(f'seed={seed}')` at the start of the test, log on failure.",
                    confidence=0.8,
                )
                break


_NEW_FUNCTION = re.compile(r"^[+]\s*(?:def|function|fn|func)\s+(\w+)", re.M)


@register("test_coverage")
def test_coverage(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    if diff is None or not diff.unified_diff:
        return
    new_funcs = [m.group(1) for m in _NEW_FUNCTION.finditer(diff.unified_diff)]
    if not new_funcs:
        return
    test_files = [p for p in scoped_files(workdir, diff) if "test" in str(p).lower() or "spec" in str(p).lower()]
    test_text = " ".join("\n".join(read_lines(p)) for p in test_files)
    untested = [f for f in new_funcs if f not in test_text and not f.startswith("_")]
    if untested:
        yield StaticFinding(
            rule_id="R14.2",
            file_path="<diff>",
            start_line=0, end_line=0,
            snippet=", ".join(untested[:8]) + (" …" if len(untested) > 8 else ""),
            rationale=f"{len(untested)} new public function(s) without a visible test by name.",
            fix_suggestion="Add tests covering: happy path, invalid input, empty input, permission denied, dependency failure, regression.",
            confidence=0.5,
        )


# ============================================================================
#  Workflow 15 — Maintainability
# ============================================================================

_BOOL_PARAM = re.compile(r"def\s+\w+\s*\([^)]*\b(?:bool|True|False)\b[^)]*\)")
_BOOL_PARAM_TS = re.compile(r"function\s+\w+\s*\([^)]*:\s*boolean[^)]*\)")


@register("bool_params")
def bool_params(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py", ".ts", ".tsx")):
        for n, line in enumerate(read_lines(p), start=1):
            if _BOOL_PARAM.search(line) or _BOOL_PARAM_TS.search(line):
                if line.lstrip().startswith(("def _", "function _")):  # private, skip
                    continue
                yield StaticFinding(
                    rule_id="R15.4",
                    file_path=str(p.relative_to(workdir)),
                    start_line=n, end_line=n,
                    snippet=line.strip()[:200],
                    rationale="Public API takes a boolean parameter. Unreadable at call sites — `f(True, False)`.",
                    fix_suggestion="Replace with an enum: `Mode.DRY_RUN` vs `Mode.LIVE`. Reads at call site, easier to extend.",
                    confidence=0.4,
                )


# ============================================================================
#  Workflow 16 — Observability
# ============================================================================

_PII_LOG = re.compile(
    r"\b(?:log|logger|print|console)\s*[\.(]\s*(?:info|debug|warn|error|log|message)?\s*\(?[^)]*\b(?:email|ssn|phone|address|user_email|fullname|first_name|last_name)\b",
    re.I,
)


@register("pii_in_logs")
def pii_in_logs(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".java")):
        for n, line in enumerate(read_lines(p), start=1):
            if _PII_LOG.search(line):
                yield StaticFinding(
                    rule_id="R16.10",
                    file_path=str(p.relative_to(workdir)),
                    start_line=n, end_line=n,
                    snippet=line.strip()[:200],
                    rationale="Log line includes a PII-named field (email/phone/address/SSN). PII must be redacted/hashed in logs and traces.",
                    fix_suggestion="Hash or redact: `logger.info('user', user_id=user.id)`; never log full PII.",
                    confidence=0.7,
                )


# ============================================================================
#  Workflow 19 — Documentation
# ============================================================================

@register("readme_drift")
def readme_drift(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    if diff is None or not diff.files_changed:
        return
    setup_changed = any(
        Path(f).name in {"pyproject.toml", "package.json", "Dockerfile", "docker-compose.yml", ".env.example", "Makefile"}
        for f in diff.files_changed
    )
    readme_changed = any(Path(f).name.lower() == "readme.md" for f in diff.files_changed)
    if setup_changed and not readme_changed:
        yield StaticFinding(
            rule_id="R19.1",
            file_path="README.md",
            start_line=0, end_line=0,
            snippet=f"setup files changed on `{diff.branch}` but README untouched",
            rationale="Setup/build files changed without a README update. Setup steps, env vars, or run commands likely drifted.",
            fix_suggestion="Update README to match new setup steps / env vars.",
            confidence=0.6,
        )


@register("api_doc_drift")
def api_doc_drift(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    if diff is None or not diff.files_changed:
        return
    api_changed = any(
        re.search(r"(?:^|/)(?:routes|api|controllers|handlers|endpoints)/", f) for f in diff.files_changed
    )
    schema_changed = any(any(h in f.lower() for h in ("openapi", "swagger", ".proto", "graphql/schema")) for f in diff.files_changed)
    if api_changed and not schema_changed:
        yield StaticFinding(
            rule_id="R19.2",
            file_path="<api-docs>",
            start_line=0, end_line=0,
            snippet=f"branch={diff.branch} touches API code but no schema updated",
            rationale="API code changed without a schema update — docs and implementation will drift.",
            fix_suggestion="Update OpenAPI/protobuf/GraphQL schema in this PR; CI must enforce parity.",
            confidence=0.65,
        )


@register("changelog_drift")
def changelog_drift(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    if diff is None or not diff.files_changed:
        return
    user_visible = any(
        re.search(r"(?:^|/)(?:routes|api|cli|public|ui|src/components)/", f) for f in diff.files_changed
    )
    changelog_changed = any("changelog" in f.lower() or "release-notes" in f.lower() for f in diff.files_changed)
    if user_visible and not changelog_changed:
        # Only flag if a CHANGELOG.md exists in repo.
        if not any((workdir / "CHANGELOG.md").exists(), (workdir / "RELEASE_NOTES.md").exists()):
            return
        yield StaticFinding(
            rule_id="R19.4",
            file_path="CHANGELOG.md",
            start_line=0, end_line=0,
            snippet=f"user-visible changes on `{diff.branch}` not reflected in changelog",
            rationale="User-visible code changed without a changelog/release-notes entry.",
            fix_suggestion="Add a one-line entry to CHANGELOG.md under the unreleased section.",
            confidence=0.55,
        )


# ============================================================================
#  Workflow 8 — endpoint_authz / server_side_id / input_schema
# ============================================================================

_HANDLER_DEF = re.compile(r"@(?:app|router)\.(?:get|post|put|delete|patch)\s*\(")
_AUTH_DECO = re.compile(r"@(?:requires_auth|login_required|jwt_required|protected|auth_required|authenticate)\b")


@register("endpoint_authz")
def endpoint_authz(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py", ".ts", ".js", ".go", ".java")):
        lines = read_lines(p)
        for n, line in enumerate(lines, start=1):
            if not _HANDLER_DEF.search(line):
                continue
            window = "\n".join(lines[max(0, n - 4): n + 1])
            if _AUTH_DECO.search(window) or "Depends(get_current_user)" in window or "@auth" in window:
                continue
            yield StaticFinding(
                rule_id="R8.1",
                file_path=str(p.relative_to(workdir)),
                start_line=n, end_line=n,
                snippet=line.strip()[:200],
                rationale="HTTP route handler with no nearby auth decorator/dependency. Every endpoint must enforce authentication and explicit authorization.",
                fix_suggestion="Add `@requires_auth` (or your project's equivalent) and an explicit ownership/tenant check in the body.",
                confidence=0.55,
            )


_SERVER_SIDE_ID = re.compile(r"\b(?:account_id|org_id|customer_id|workspace_id)\s*=\s*(?:request|req|params|body)\.")


@register("server_side_id")
def server_side_id(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py", ".ts", ".js", ".go")):
        for n, line in enumerate(read_lines(p), start=1):
            if _SERVER_SIDE_ID.search(line):
                yield StaticFinding(
                    rule_id="R8.2",
                    file_path=str(p.relative_to(workdir)),
                    start_line=n, end_line=n,
                    snippet=line.strip()[:200],
                    rationale="`account_id`/`org_id` taken from the request rather than derived from the session. IDOR vector.",
                    fix_suggestion="Derive these IDs server-side from `request.user.account_id`. Verify ownership via DB query before any mutation.",
                    confidence=0.85,
                )


_RAW_BODY_ACCESS = re.compile(r"\b(?:request\.body|req\.body)\.(\w+)")


@register("input_schema")
def input_schema(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py", ".ts", ".js", ".go")):
        text = "\n".join(read_lines(p))
        if "BaseModel" in text or "Zod" in text or "pydantic" in text or "joi" in text or "yup" in text or "ajv" in text:
            continue
        for n, line in enumerate(text.splitlines(), start=1):
            if _RAW_BODY_ACCESS.search(line):
                yield StaticFinding(
                    rule_id="R8.3",
                    file_path=str(p.relative_to(workdir)),
                    start_line=n, end_line=n,
                    snippet=line.strip()[:200],
                    rationale="Raw `request.body.x` access without a visible schema validator (Pydantic/Zod/Joi/etc.).",
                    fix_suggestion="Define a schema and validate at the handler boundary before any field is touched.",
                    confidence=0.55,
                )
                break


# ============================================================================
#  Workflow 4 — dep_cycle, business_logic_layer, dao_layering
# ============================================================================

@register("dep_cycle")
def dep_cycle(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    """Naive cycle detector for Python imports — small enough to fit, big enough to flag obvious cases."""
    import ast as _ast
    graph: dict[str, set[str]] = {}
    py_files = [p for p in scoped_files(workdir, diff, suffixes=(".py",))]
    for p in py_files:
        rel = str(p.relative_to(workdir))
        mod = rel.replace("/", ".").removesuffix(".py")
        try:
            tree = _ast.parse("\n".join(read_lines(p)))
        except SyntaxError:
            continue
        deps: set[str] = set()
        for node in _ast.walk(tree):
            if isinstance(node, _ast.ImportFrom) and node.module:
                deps.add(node.module.split(".")[0])
            elif isinstance(node, _ast.Import):
                for n in node.names:
                    deps.add(n.name.split(".")[0])
        graph[mod] = deps

    visited: set[str] = set()
    stack: list[str] = []

    def dfs(node: str) -> list[str] | None:
        if node in stack:
            i = stack.index(node)
            return stack[i:] + [node]
        if node in visited:
            return None
        stack.append(node)
        for nb in graph.get(node, ()):
            res = dfs(nb)
            if res:
                return res
        stack.pop()
        visited.add(node)
        return None

    for start in graph:
        cycle = dfs(start)
        if cycle and len(cycle) > 1:
            yield StaticFinding(
                rule_id="R4.2",
                file_path="<deps>",
                start_line=0, end_line=0,
                snippet=" -> ".join(cycle[:8]),
                rationale="Import cycle detected. Even if the build is green today, cycles compound — break them now.",
                fix_suggestion="Move the shared types/interfaces into a leaf module; invert the dependency.",
                confidence=0.7,
            )
            return  # one cycle is enough


_HANDLER_FILES = re.compile(r"(?:^|/)(?:routes|controllers|views|migrations|handlers)/")
_BUSINESS_HINT = re.compile(r"\b(?:price|tax|fee|discount|invoice|payment|charge|refund|eligibility|permission)\b", re.I)


@register("business_logic_layer")
def business_logic_layer(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py", ".ts", ".js", ".go")):
        rel = str(p.relative_to(workdir))
        if not _HANDLER_FILES.search(rel):
            continue
        for n, line in enumerate(read_lines(p), start=1):
            if _BUSINESS_HINT.search(line) and ("=" in line or "return" in line):
                yield StaticFinding(
                    rule_id="R4.3",
                    file_path=rel,
                    start_line=n, end_line=n,
                    snippet=line.strip()[:200],
                    rationale="Business-logic-flavored code (price/tax/fee/payment/permission) appears in a controller/view/migration. Move to a domain/service layer.",
                    fix_suggestion="Extract to `services/` or `domain/`. Controllers translate HTTP, they don't decide.",
                    confidence=0.5,
                )
                break


_SQL_IN_SERVICE = re.compile(r"\.(?:execute|query|raw_sql)\s*\(\s*['\"]\s*(?:SELECT|UPDATE|DELETE|INSERT)", re.I)


@register("dao_layering")
def dao_layering(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py", ".ts", ".js", ".go")):
        rel = str(p.relative_to(workdir))
        if "service" not in rel.lower() and "usecase" not in rel.lower():
            continue
        for n, line in enumerate(read_lines(p), start=1):
            if _SQL_IN_SERVICE.search(line):
                yield StaticFinding(
                    rule_id="R4.4",
                    file_path=rel,
                    start_line=n, end_line=n,
                    snippet=line.strip()[:200],
                    rationale="Raw SQL inside a service/use-case file. Query construction belongs in a repository/DAO layer.",
                    fix_suggestion="Move the query into a repository class; have the service call the repository's typed method.",
                    confidence=0.6,
                )
                break


# ============================================================================
#  Workflow 5 — audit_emit
# ============================================================================

_AUDIT_OPS = re.compile(r"\b(?:charge|refund|delete_account|change_role|grant|revoke|disable_user|reset_password)\b", re.I)
_AUDIT_LOG_NEAR = re.compile(r"\baudit[._]log\b|\bemit_audit\b|AuditLog\(", re.I)


@register("audit_emit")
def audit_emit(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    for p in scoped_files(workdir, diff, suffixes=(".py", ".ts", ".js", ".go", ".java")):
        text = "\n".join(read_lines(p))
        if not _AUDIT_OPS.search(text):
            continue
        if _AUDIT_LOG_NEAR.search(text):
            continue
        for n, line in enumerate(text.splitlines(), start=1):
            if _AUDIT_OPS.search(line):
                yield StaticFinding(
                    rule_id="R5.8",
                    file_path=str(p.relative_to(workdir)),
                    start_line=n, end_line=n,
                    snippet=line.strip()[:200],
                    rationale="Audit-required operation (financial / role / account-mutation) with no audit-log emission visible in the file.",
                    fix_suggestion="Emit an audit record in the same transaction: who, what, when, target.",
                    confidence=0.55,
                )
                break
