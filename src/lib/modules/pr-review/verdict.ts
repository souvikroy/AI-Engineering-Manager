import type { Verdict, WorkflowResult } from "./types";

export function decideVerdict(results: WorkflowResult[]): { verdict: Verdict; blocking: { ruleId: string; evidence: string }[]; warnings: number; nits: number } {
  const blocking: { ruleId: string; evidence: string }[] = [];
  let warnings = 0;
  let nits = 0;

  for (const r of results) {
    for (const f of r.findings) {
      if (f.status !== "fail") continue;
      if (f.severity === "blocking") {
        blocking.push({ ruleId: f.ruleId, evidence: f.evidence });
      } else if (f.severity === "warning") {
        warnings += 1;
      } else if (f.severity === "nit") {
        nits += 1;
      }
    }
  }

  let verdict: Verdict;
  if (blocking.length > 0) verdict = "BLOCK";
  else if (warnings > 0) verdict = "REQUEST_CHANGES";
  else if (nits > 0) verdict = "APPROVE_WITH_NITS";
  else verdict = "APPROVE";

  return { verdict, blocking, warnings, nits };
}
