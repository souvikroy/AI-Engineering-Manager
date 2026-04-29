import { describe, expect, it } from "vitest";
import { decideVerdict } from "@/lib/modules/pr-review/verdict";
import type { WorkflowResult } from "@/lib/modules/pr-review/types";

function result(workflowId: number, findings: { ruleId: string; status: "pass" | "fail" | "na"; severity: "blocking" | "warning" | "nit" | "info"; evidence?: string }[]): WorkflowResult {
  return {
    workflowId,
    workflowTitle: `Workflow ${workflowId}`,
    findings: findings.map((f) => ({ ...f, evidence: f.evidence ?? "" })),
  };
}

describe("verdict", () => {
  it("APPROVE when nothing failed", () => {
    const v = decideVerdict([result(1, [{ ruleId: "R1.1", status: "pass", severity: "info" }])]);
    expect(v.verdict).toBe("APPROVE");
  });

  it("BLOCK when a MUST rule fails with blocking severity", () => {
    const v = decideVerdict([result(1, [{ ruleId: "R1.1", status: "fail", severity: "blocking", evidence: "missing template" }])]);
    expect(v.verdict).toBe("BLOCK");
    expect(v.blocking.length).toBe(1);
  });

  it("REQUEST_CHANGES when only warnings", () => {
    const v = decideVerdict([result(1, [{ ruleId: "R1.5", status: "fail", severity: "warning" }])]);
    expect(v.verdict).toBe("REQUEST_CHANGES");
  });

  it("APPROVE_WITH_NITS when only nits", () => {
    const v = decideVerdict([result(2, [{ ruleId: "R2.4", status: "fail", severity: "nit" }])]);
    expect(v.verdict).toBe("APPROVE_WITH_NITS");
  });

  it("BLOCK supersedes warnings and nits", () => {
    const v = decideVerdict([
      result(1, [{ ruleId: "R1.1", status: "fail", severity: "blocking" }]),
      result(2, [{ ruleId: "R2.4", status: "fail", severity: "warning" }]),
      result(3, [{ ruleId: "R3.1", status: "fail", severity: "nit" }]),
    ]);
    expect(v.verdict).toBe("BLOCK");
    expect(v.warnings).toBe(1);
    expect(v.nits).toBe(1);
  });
});
