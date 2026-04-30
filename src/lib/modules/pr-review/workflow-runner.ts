import { complete, cached } from "@/lib/anthropic";
import type { GitHubPR } from "@/lib/adapters/types";
import { loadRuleset, type Workflow } from "./ruleset-loader";
import { FindingSchema, type Finding, type WorkflowResult } from "./types";

const MAX_DIFF_CHARS = 60_000;

function trimDiff(diff: string): string {
  if (diff.length <= MAX_DIFF_CHARS) return diff;
  return diff.slice(0, MAX_DIFF_CHARS) + `\n\n... [diff truncated, original ${diff.length} chars]`;
}

function buildPRContext(pr: GitHubPR): string {
  return [
    `# PR #${pr.number}: ${pr.title}`,
    ``,
    `**Author:** ${pr.author}`,
    `**Branch:** \`${pr.headRef}\` → \`${pr.baseRef}\``,
    `**Draft:** ${pr.draft}`,
    `**Labels:** ${pr.labels.join(", ") || "(none)"}`,
    `**CI Status:** ${pr.ciStatus}`,
    `**Commits:** ${pr.commits.length}`,
    `**Files changed:** ${pr.changedFiles.length}`,
    ``,
    `## Body`,
    pr.body || "(no body provided)",
    ``,
    `## Commit messages`,
    pr.commits.map((c) => `- ${c.sha.slice(0, 7)} ${c.message.split("\n")[0]}`).join("\n"),
    ``,
    `## Files changed`,
    pr.changedFiles.map((f) => `- ${f}`).join("\n"),
    ``,
    `## Diff`,
    "```diff",
    trimDiff(pr.diff),
    "```",
  ].join("\n");
}

function buildWorkflowPrompt(workflow: Workflow): string {
  const rules = workflow.rules
    .map((r) => `${r.id} [${r.enforcement}] — ${r.text.replace(/\n/g, " ")}`)
    .join("\n\n");
  return [
    `# Workflow ${workflow.id} — ${workflow.title}`,
    ``,
    `You MUST evaluate ALL ${workflow.rules.length} rules below. Do not skip any. Produce exactly one finding per rule.`,
    ``,
    `Rules:`,
    rules,
  ].join("\n");
}

const SYSTEM_PROMPT = `You are an expert code reviewer at Meta (formerly Facebook) with 20+ years of experience on large-scale platforms.
You apply the production code-review ruleset mechanically, rule by rule. Your output is consumed programmatically AND is read by the PR author to fix issues fast — so every failed finding must be specific enough that the author can act in under two minutes without re-reading the diff.

For EACH rule provided you produce a finding with these fields:

- ruleId: the rule's ID like "R3.4"
- status: "pass" | "fail" | "na" (na = rule does not apply to this PR's scope)
- severity: "blocking" | "warning" | "nit" | "info"
  - "blocking" ONLY when status is "fail" AND the rule's enforcement is MUST or MUST_NOT
  - "warning" when status is "fail" AND enforcement is SHOULD or SHOULD_NOT
  - "nit" when status is "fail" AND enforcement is MAY (style/preference)
  - "info" whenever status is "pass" or "na"
- issue: ONE sentence in plain English stating what is wrong. If status is "pass" or "na", state in one sentence why. No filler like "this PR violates...". Lead with the defect: "SQL string is built with template literal interpolation, allowing SQL injection."
- location: where in the PR the issue lives. Use one of these formats:
  - "<file path>:<line>" or "<file path>:<startLine>-<endLine>" for code (use the diff hunk @@ line numbers — pick the new-file line, not the old)
  - "PR description" / "PR title" / "PR labels" / "commit <sha7>" for non-code locations
  - "" (empty string) only when status is "pass" or "na"
- fix: a concrete, copy-pasteable next step. Not "consider refactoring" — say what to change. Examples:
  - "Replace the template-literal SQL with a parameterized query: \`db.query('SELECT * FROM users WHERE id = $1', [userId])\`."
  - "Add a 'Rollback' section to the PR description with the manual recovery steps; 'revert PR' is not sufficient for a schema migration."
  - "Wrap the fetch in withTimeout(5000) and add { retries: 3, backoff: 'exponential' } from @/lib/http."
  Empty string only when status is "pass" or "na".
- evidence: ≤ 600 chars quoting the smallest relevant snippet from the PR diff or description that proves the finding. Quote verbatim — do not paraphrase. If "na", explain in one sentence why the rule does not apply.

Hard rules:
1. Be conservative: when uncertain, prefer "na" over "fail". Never invent code that is not in the diff.
2. NEVER mark a rule "pass" without having checked the diff for the failure mode it targets.
3. The fix MUST reference an actual file/symbol/section from this PR, not generic advice.
4. Severity follows enforcement strictly — a failed MUST is always "blocking", a failed SHOULD is always "warning". No exceptions.
5. If the same defect violates multiple rules, fail each rule independently with its own location.`;

export async function runWorkflow(workflowId: number, pr: GitHubPR): Promise<WorkflowResult> {
  const ruleset = loadRuleset();
  const workflow = ruleset.workflows.find((w) => w.id === workflowId);
  if (!workflow) throw new Error(`Workflow ${workflowId} not found in ruleset`);

  const prContext = buildPRContext(pr);
  const workflowSpec = buildWorkflowPrompt(workflow);

  const userInstruction =
    `Evaluate every rule in Workflow ${workflowId} against the PR above.\n\n` +
    `Return STRICT JSON of this exact shape:\n` +
    `{\n  "findings": [\n    {\n      "ruleId": "R${workflowId}.1",\n      "status": "pass|fail|na",\n      "severity": "blocking|warning|nit|info",\n      "issue": "<one sentence stating what is wrong, or why the rule passes/does not apply>",\n      "location": "<file path>:<line> | PR description | PR title | PR labels | \\"\\"",\n      "fix": "<concrete, copy-pasteable next step the author can apply, or \\"\\" if status != fail>",\n      "evidence": "<verbatim ≤600-char quote from the diff or description>"\n    }\n  ]\n}\n\n` +
    `Include exactly one finding per rule — ${workflow.rules.length} findings total, in the same order as the rules above. Do not add commentary outside the JSON.`;

  const responseText = await complete({
    model: "reasoning",
    system: SYSTEM_PROMPT,
    messages: [
      { role: "user", content: cached(prContext + "\n\n" + workflowSpec) },
      { role: "user", content: userInstruction },
    ],
    maxTokens: 8000,
    temperature: 0,
  });

  const findings = parseFindings(responseText, workflow);
  return { workflowId: workflow.id, workflowTitle: workflow.title, findings };
}

function parseFindings(text: string, workflow: Workflow): Finding[] {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  const json = match ? match[0] : cleaned;
  const stub = (r: { id: string }, reason: string): Finding => ({
    ruleId: r.id,
    status: "na",
    severity: "info",
    issue: reason,
    location: "",
    fix: "",
    evidence: reason,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return workflow.rules.map((r) => stub(r, "model returned unparseable output"));
  }
  const arr = (parsed as { findings?: unknown[] }).findings;
  if (!Array.isArray(arr)) {
    return workflow.rules.map((r) => stub(r, "model output missing 'findings' array"));
  }
  const valid: Finding[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    const f = FindingSchema.safeParse(item);
    if (f.success && workflow.rules.some((r) => r.id === f.data.ruleId)) {
      valid.push(f.data);
      seen.add(f.data.ruleId);
    }
  }
  for (const r of workflow.rules) {
    if (!seen.has(r.id)) {
      valid.push(stub(r, "model did not return a finding for this rule"));
    }
  }
  return valid;
}

export async function runWorkflows(workflowIds: number[], pr: GitHubPR): Promise<WorkflowResult[]> {
  return Promise.all(workflowIds.map((id) => runWorkflow(id, pr)));
}
