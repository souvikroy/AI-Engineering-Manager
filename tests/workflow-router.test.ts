import { describe, expect, it } from "vitest";
import { selectWorkflows } from "@/lib/modules/pr-review/workflow-router";
import type { GitHubPR } from "@/lib/adapters/types";

function pr(partial: Partial<GitHubPR>): GitHubPR {
  return {
    number: 1,
    title: "",
    body: "",
    author: "test",
    draft: false,
    baseRef: "main",
    headRef: "feature",
    labels: [],
    changedFiles: [],
    diff: "",
    ciStatus: "success",
    url: "https://example.com",
    createdAt: new Date().toISOString(),
    commits: [],
    ...partial,
  };
}

const ALWAYS = [1, 2, 3, 6, 7, 14, 15, 16, 17, 19, 20, 21];

describe("workflow-router", () => {
  it("always includes the always-on workflows", () => {
    const w = selectWorkflows("chore", pr({}));
    for (const a of ALWAYS) expect(w).toContain(a);
  });

  it("feature PR includes architecture + domain + correctness + errors", () => {
    const w = selectWorkflows("feature", pr({}));
    expect(w).toEqual(expect.arrayContaining([4, 5, 6, 7]));
  });

  it("migration PR adds data + deploy/rollback", () => {
    const w = selectWorkflows("migration", pr({ changedFiles: ["db/migrations/0042.sql"] }));
    expect(w).toContain(9);
    expect(w).toContain(17);
  });

  it("UI changes add frontend workflow", () => {
    const w = selectWorkflows("feature", pr({ changedFiles: ["src/app/page.tsx"] }));
    expect(w).toContain(11);
  });

  it("API/protobuf changes add API contract workflow", () => {
    const w = selectWorkflows("feature", pr({ changedFiles: ["proto/v1/users.proto", "src/app/api/users/route.ts"] }));
    expect(w).toContain(10);
  });

  it("dependency changes add dependency review workflow", () => {
    const w = selectWorkflows("chore", pr({ changedFiles: ["package.json", "package-lock.json"] }));
    expect(w).toContain(18);
  });

  it("auth-related files trigger security workflow", () => {
    const w = selectWorkflows("feature", pr({ changedFiles: ["src/auth/jwt.ts"] }));
    expect(w).toContain(8);
  });

  it("concurrency primitives in diff add concurrency workflow", () => {
    const w = selectWorkflows("feature", pr({ diff: "+ const m = new Mutex();\n+ async function takeLock() { await m.acquire(); }" }));
    expect(w).toContain(13);
  });

  it("returns sorted ascending workflow IDs", () => {
    const w = selectWorkflows("feature", pr({ changedFiles: ["src/app/api/users/route.ts", "src/app/page.tsx"] }));
    expect([...w].sort((a, b) => a - b)).toEqual(w);
  });
});
