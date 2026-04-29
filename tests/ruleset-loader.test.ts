import { describe, expect, it } from "vitest";
import { loadRuleset, parseRuleset, isBlocking } from "@/lib/modules/pr-review/ruleset-loader";

describe("ruleset-loader", () => {
  it("parses 21 workflows and 224 rules from CODE_REVIEW_RULESET.md", () => {
    const rs = loadRuleset(true);
    expect(rs.workflows.length).toBe(21);
    expect(rs.totalRules).toBe(224);
  });

  it("workflow IDs are numbered 1..21 contiguously", () => {
    const rs = loadRuleset(true);
    const ids = rs.workflows.map((w) => w.id).sort((a, b) => a - b);
    expect(ids).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
  });

  it("every rule ID is unique", () => {
    const rs = loadRuleset(true);
    const ids = [...rs.workflows.flatMap((w) => w.rules.map((r) => r.id))];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("rule belongs to its declared workflow", () => {
    const rs = loadRuleset(true);
    for (const w of rs.workflows) {
      for (const r of w.rules) expect(r.workflowId).toBe(w.id);
    }
  });

  it("detects MUST_NOT before MUST", () => {
    const md = `## Workflow 1 — Test\n\n- **R1.1** Reviewer MUST NOT do X.\n- **R1.2** Reviewer MUST do Y.\n`;
    const rs = parseRuleset(md);
    expect(rs.byId.get("R1.1")?.enforcement).toBe("MUST_NOT");
    expect(rs.byId.get("R1.2")?.enforcement).toBe("MUST");
  });

  it("captures multi-line rule continuations (sub-bullets)", () => {
    const md = `## Workflow 21 — Test\n\n- **R21.8** Approval MUST NOT be given for:\n  - known correctness bug,\n  - missing tests.\n- **R21.9** Reviewer MUST NOT block on personal preference.\n`;
    const rs = parseRuleset(md);
    const rule = rs.byId.get("R21.8");
    expect(rule).toBeDefined();
    expect(rule?.text).toContain("known correctness bug");
    expect(rule?.text).toContain("missing tests");
  });

  it("isBlocking returns true only for MUST/MUST_NOT", () => {
    expect(isBlocking("MUST")).toBe(true);
    expect(isBlocking("MUST_NOT")).toBe(true);
    expect(isBlocking("SHOULD")).toBe(false);
    expect(isBlocking("MAY")).toBe(false);
    expect(isBlocking("INFO")).toBe(false);
  });
});
