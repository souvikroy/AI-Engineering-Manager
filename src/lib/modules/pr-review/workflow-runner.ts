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
    .map((r) => `${r.id} [${r.enforcement}] ${r.text.replace(/\n/g, " ")}`)
    .join("\n");
  return [
    `# Workflow ${workflow.id} — ${workflow.title}`,
    ``,
    `Rules to evaluate (${workflow.rules.length}):`,
    rules,
  ].join("\n");
}

const SYSTEM_PROMPT = `You are an expert code reviewer at Meta (formerly Facebook) with 20+ years of experience on large-scale platforms.
You apply the production code-review ruleset mechanically, rule by rule.
Output is consumed programmatically; respond ONLY with the JSON object specified in the instructions.

For each rule provided you must produce a finding with:
- ruleId: the rule's ID like "R3.4"
- status: "pass" | "fail" | "na" (na = not applicable to this PR)
- severity: "blocking" | "warning" | "nit" | "info"
  - "blocking" only when status is "fail" AND the rule is MUST or MUST NOT
  - "warning" when SHOULD/SHOULD NOT failed
  - "nit" for MAY-style or stylistic
  - "info" when status is "pass" or "na"
- evidence: ≤ 800 chars quoting the smallest relevant snippet from the PR (file path, line, or quoted text). If "na", explain why in one sentence.

Be conservative: when uncertain, prefer "na" over "fail". Never invent code that is not in the diff.`;

export async function runWorkflow(workflowId: number, pr: GitHubPR): Promise<WorkflowResult> {
  const ruleset = loadRuleset();
  const workflow = ruleset.workflows.find((w) => w.id === workflowId);
  if (!workflow) throw new Error(`Workflow ${workflowId} not found in ruleset`);

  const prContext = buildPRContext(pr);
  const workflowSpec = buildWorkflowPrompt(workflow);

  const userInstruction =
    `Evaluate every rule in Workflow ${workflowId} against the PR above.\n\n` +
    `Return STRICT JSON of shape:\n` +
    `{ "findings": [ { "ruleId": "R${workflowId}.1", "status": "pass|fail|na", "severity": "blocking|warning|nit|info", "evidence": "..." }, ... ] }\n\n` +
    `Include exactly one finding per rule (${workflow.rules.length} findings total). Do not add commentary outside the JSON.`;

  const responseText = await complete({
    model: "reasoning",
    system: SYSTEM_PROMPT,
    messages: [
      { role: "user", content: cached(prContext + "\n\n" + workflowSpec) },
      { role: "user", content: userInstruction },
    ],
    maxTokens: 4096,
    temperature: 0,
  });

  const findings = parseFindings(responseText, workflow);
  return { workflowId: workflow.id, workflowTitle: workflow.title, findings };
}

function parseFindings(text: string, workflow: Workflow): Finding[] {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  const json = match ? match[0] : cleaned;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return workflow.rules.map((r) => ({ ruleId: r.id, status: "na", severity: "info", evidence: "model returned unparseable output" } as Finding));
  }
  const arr = (parsed as { findings?: unknown[] }).findings;
  if (!Array.isArray(arr)) {
    return workflow.rules.map((r) => ({ ruleId: r.id, status: "na", severity: "info", evidence: "model output missing 'findings' array" } as Finding));
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
      valid.push({ ruleId: r.id, status: "na", severity: "info", evidence: "model did not return a finding for this rule" });
    }
  }
  return valid;
}

export async function runWorkflows(workflowIds: number[], pr: GitHubPR): Promise<WorkflowResult[]> {
  return Promise.all(workflowIds.map((id) => runWorkflow(id, pr)));
}
