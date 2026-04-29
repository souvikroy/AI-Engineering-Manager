"""Audit which rules in the ruleset are actually verified by the implementation.

Prints a per-rule and per-workflow coverage report. Honest about the gaps.
"""

from __future__ import annotations

import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from reviewer.rules.registry import all_rules
from reviewer.static.runners import all_runners

from reviewer.planner.planner import ALWAYS_ON  # noqa: E402

CONDITIONAL_WF: dict[int, str] = {}  # all workflows are always-on after Phase A.

REGISTERED_RUNNERS = set(all_runners().keys())


def static_status(runner_name: str | None) -> str:
    if not runner_name:
        return "n/a"
    return "implemented" if runner_name in REGISTERED_RUNNERS else "DECLARED-NOT-IMPL"


def llm_status(workflow: int) -> str:
    if workflow in ALWAYS_ON:
        return "always-on"
    return f"conditional ({CONDITIONAL_WF.get(workflow, 'unknown')})"


def main() -> None:
    rules = list(all_rules().values())
    print(f"Total rules in registry: {len(rules)}\n")

    # Per-rule classification of verification path.
    by_kind: Counter[str] = Counter()
    static_impl_count = 0
    static_decl_only = 0
    llm_always = 0
    llm_conditional = 0
    rules_fully_covered = 0
    rules_partially_covered = 0
    rules_not_covered = 0

    per_wf: dict[int, list] = defaultdict(list)

    for r in rules:
        by_kind[r.kind] += 1
        s_status = static_status(r.static_runner)
        l_status = llm_status(r.workflow)

        # Determine "covered today":
        if r.kind == "static":
            if s_status == "implemented":
                covered = "yes"
                static_impl_count += 1
                rules_fully_covered += 1
            else:
                covered = "no"
                static_decl_only += 1
                rules_not_covered += 1
        elif r.kind == "llm":
            if r.workflow in ALWAYS_ON:
                covered = "llm-only (always)"
                llm_always += 1
                rules_fully_covered += 1
            else:
                covered = "llm-only (conditional)"
                llm_conditional += 1
                rules_partially_covered += 1
        else:  # hybrid
            both_static = s_status == "implemented"
            llm_runs = r.workflow in ALWAYS_ON or r.workflow in CONDITIONAL_WF
            if both_static and r.workflow in ALWAYS_ON:
                covered = "hybrid (static + always-on llm)"
                rules_fully_covered += 1
            elif both_static:
                covered = "hybrid (static + conditional llm)"
                rules_partially_covered += 1
            elif llm_runs:
                covered = "llm-only (hybrid w/o static impl)"
                rules_partially_covered += 1
            else:
                covered = "no"
                rules_not_covered += 1

        per_wf[r.workflow].append((r.id, r.kind, r.severity, r.static_runner or "-",
                                   s_status, l_status, covered))

    # Detail
    for wf in sorted(per_wf):
        print(f"\n--- Workflow {wf} ---")
        for rid, kind, sev, runner, sstat, lstat, covered in sorted(per_wf[wf]):
            print(f"  {rid:6}  kind={kind:6}  sev={sev}  runner={runner:24} "
                  f"static={sstat:18}  llm={lstat[:28]:28}  -> {covered}")

    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print(f"Total rules:                {len(rules)}")
    print(f"  static rules:             {by_kind['static']:>3}")
    print(f"  llm rules:                {by_kind['llm']:>3}")
    print(f"  hybrid rules:             {by_kind['hybrid']:>3}")
    print()
    print(f"Static runners registered:  {len(REGISTERED_RUNNERS)}")
    print(f"  rules with implemented runner: {static_impl_count}")
    print(f"  rules with declared-but-no-impl runner: {static_decl_only}")
    print()
    print(f"Coverage today (assuming OPENROUTER_API_KEY set):")
    print(f"  fully covered (static-impl OR always-on llm OR both): {rules_fully_covered}  ({100*rules_fully_covered/len(rules):.0f}%)")
    print(f"  partially covered (only runs for matching intents):   {rules_partially_covered}  ({100*rules_partially_covered/len(rules):.0f}%)")
    print(f"  NOT covered:                                          {rules_not_covered}  ({100*rules_not_covered/len(rules):.0f}%)")
    print()
    print("Coverage when OPENROUTER_API_KEY is NOT set (static path only):")
    print(f"  rules verified: {static_impl_count} / {len(rules)}  ({100*static_impl_count/len(rules):.0f}%)")
    print()
    print("Workflow-level reachability:")
    for wf in sorted(set(r.workflow for r in rules)):
        gate = "ALWAYS" if wf in ALWAYS_ON else CONDITIONAL_WF.get(wf, "unknown")
        rcount = sum(1 for r in rules if r.workflow == wf)
        print(f"  WF{wf:02d}  rules={rcount:>2}  {gate}")


if __name__ == "__main__":
    main()
