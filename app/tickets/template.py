"""Deterministic Jira-style ticket body renderer.

Used as:
- A fallback when the LLM is disabled, errors, or times out.
- An input bundle for the LLM (we hand the raw facts to the model and ask it
  to flesh out the engineering-grade Jira template around them).
"""

from __future__ import annotations

from typing import Optional

# Severity → Jira priority label.
SEVERITY_PRIORITY = {
    "P0": "P0 (Critical)",
    "P1": "P1",
    "P2": "P2",
    "P3": "P3",
}


def _short_repo(url: str) -> str:
    return url.replace("https://github.com/", "").replace("http://github.com/", "").rstrip("/")


def render_template_body(
    *,
    key: str,
    repo_url: str,
    rule_id: str,
    severity: str,
    file_path: str,
    start_line: int,
    end_line: int,
    branch: str,
    rationale: str,
    fix_suggestion: str,
    snippet: str,
    confidence: float,
    workflow: Optional[int] = None,
) -> str:
    """Render the Jira template with raw finding data — no LLM."""
    repo_short = _short_repo(repo_url) if repo_url else "(local)"
    component = file_path.split("/")[0] if file_path and "/" in file_path else file_path or "(unknown)"
    line_str = f":{start_line}" if start_line else ""
    line_range = f"{start_line}-{end_line}" if end_line and end_line != start_line else str(start_line or "—")
    workflow_str = f"WF{workflow:02d}" if workflow else "—"
    snippet_block = f"```\n{snippet.strip()}\n```\n" if snippet.strip() else "_No snippet captured._\n"
    fix_block = fix_suggestion.strip() or "_No suggested fix recorded._"
    rationale_block = rationale.strip() or "_No rationale captured._"

    return f"""## 🔖 Title

[{component}] {rule_id}: issue at `{file_path}{line_str}`

## 🧩 Ticket Type

Bug

## 🚨 Priority

{SEVERITY_PRIORITY.get(severity, severity)}

## 📍 Component / Service

`{repo_short}` — {component}

## 👤 Owner

_Unassigned_

## 📝 Description

A {severity} review finding for rule `{rule_id}` was detected in `{file_path}` (lines {line_range}) on branch `{branch or "—"}`.

{rationale_block}

## 🎯 Goal / Outcome

Resolve the violation of `{rule_id}` so the affected code passes the review ruleset and no regression is introduced in adjacent flows.

## 🔍 Problem Details

* **Symptoms:** {rationale_block}
* **Frequency:** Detected statically by the reviewer ({workflow_str}, confidence {confidence:.2f}).
* **Environment(s):** Source repository `{repo_short}`.
* **First observed:** This review run.
* **Related incidents / alerts:** —

## 🔁 Steps to Reproduce

1. Check out branch `{branch or "main"}` of `{repo_short}`.
2. Open `{file_path}{line_str}`.
3. Inspect the offending code (see snippet below).

## ✅ Expected Behavior

Code at `{file_path}{line_str}` complies with rule `{rule_id}`.

## ❌ Actual Behavior

{rationale_block}

## 🧠 Technical Context

* **Code areas / files:** `{file_path}` (lines {line_range})
* **Branch:** `{branch or "—"}`
* **Detection workflow:** {workflow_str}
* **Rule:** `{rule_id}`

## 📊 Logs / Evidence

```text
{file_path}{line_str}
```

{snippet_block}

## 🧪 Acceptance Criteria

* [ ] The condition described in the rationale no longer holds at `{file_path}{line_str}`.
* [ ] No new findings introduced in the same file by the next review run.
* [ ] Suggested fix applied or an equivalent mitigation documented in this ticket.
* [ ] Tests covering the affected behavior pass on `{branch or "main"}`.

## 🔒 Scope

**In Scope:**
* Resolve `{rule_id}` at `{file_path}{line_str}`.

**Out of Scope:**
* Refactors unrelated to this rule.
* Other findings in this repo (tracked under their own tickets).

## ⚠️ Risks & Edge Cases

* Fix may interact with adjacent code in `{file_path}`; verify nearby tests.
* {SEVERITY_PRIORITY.get(severity, severity)} severity — if blocking, prioritise above feature work.

## 🔗 Dependencies

_None identified. Update if the fix touches shared code paths._

## 🚀 Rollout Plan

* Feature flag? No (defect fix).
* Rollback strategy: revert the fix commit; reviewer will re-flag the finding on the next run.

## 🧹 Definition of Done

* [ ] Code implemented
* [ ] Unit tests added / updated
* [ ] Code reviewed
* [ ] Re-run of the reviewer no longer surfaces `{rule_id}` at this location
* [ ] Ticket auto-closes (status: done) on next clean review pass

## 💡 Suggested Fix

{fix_block}

## 📎 Additional Notes

Auto-generated from review finding for ticket `{key}`. Linked finding contains the full evidence chain.
""".strip() + "\n"
