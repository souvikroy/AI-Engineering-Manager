"""Workflow 10 missing static runners.

R10.3 openapi_present — Public endpoints require an OpenAPI/GraphQL/protobuf schema in the same PR.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from pathlib import Path

from ...ingest.git_extract import BranchDiff
from . import StaticFinding, register

# Heuristic: any file under `routes/`, `api/`, `controllers/`, or with `@app.route`/`@router.`/`@RestController`.
_API_HINTS = (
    re.compile(r"(?:^|/)(?:routes|api|controllers|handlers|endpoints)/"),
    re.compile(r"@app\.route\b"),
    re.compile(r"@(?:router|api)\.(?:get|post|put|delete|patch)\b"),
    re.compile(r"@RestController\b"),
    re.compile(r"\bFastAPI\("),
)
_SCHEMA_HINTS = ("openapi", "swagger", ".proto", "graphql/schema", "schema.graphql")


@register("openapi_present")
def openapi_present(workdir: Path, diff: BranchDiff | None = None) -> Iterable[StaticFinding]:
    if diff is None or not diff.files_changed:
        return

    api_changed = False
    for f in diff.files_changed:
        if any(pat.search(f) for pat in _API_HINTS if hasattr(pat, "search")):
            api_changed = True
            break
        # also check first 200 chars for decorators
        try:
            head = (workdir / f).read_text(encoding="utf-8", errors="ignore")[:4000]
        except OSError:
            continue
        if any(pat.search(head) for pat in _API_HINTS if hasattr(pat, "search")):
            api_changed = True
            break

    if not api_changed:
        return

    repo_has_schema = any(
        any(h in str(p).lower() for h in _SCHEMA_HINTS)
        for p in workdir.rglob("*")
        if p.is_file()
    )
    diff_has_schema = any(any(h in f.lower() for h in _SCHEMA_HINTS) for f in diff.files_changed)

    if repo_has_schema and not diff_has_schema:
        yield StaticFinding(
            rule_id="R10.3",
            file_path="<diff>",
            start_line=0,
            end_line=0,
            snippet=f"branch={diff.branch} touches API code but no schema file",
            rationale="API code changed but no OpenAPI/GraphQL/protobuf schema file is in the diff. Schema and implementation must move together.",
            fix_suggestion="Update the schema in the same PR. CI must enforce schema/implementation parity.",
            confidence=0.7,
        )
    elif not repo_has_schema:
        yield StaticFinding(
            rule_id="R10.3",
            file_path="<repo>",
            start_line=0,
            end_line=0,
            snippet="no openapi/swagger/proto/graphql schema found in repo",
            rationale="Public API code exists but the repo carries no machine-readable schema. Add one — drift is otherwise inevitable.",
            fix_suggestion="Adopt OpenAPI/GraphQL/protobuf and wire CI to enforce parity with the implementation.",
            confidence=0.6,
        )
