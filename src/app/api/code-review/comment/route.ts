/**
 * POST /api/code-review/comment — per-finding action button.
 *
 * Posts a GitHub review comment (inline at file:line if the finding's
 * `location` parses, otherwise a general PR conversation comment) AND
 * creates a Jira ticket for the same finding. Both calls run in parallel
 * via Promise.allSettled — partial success is preserved and surfaced to
 * the UI so the user can retry only the side that failed.
 *
 * `skip_github` / `skip_jira` let the UI retry just one side without
 * re-firing the successful one.
 */
import { NextResponse } from "next/server";
import { github } from "@/lib/adapters/github";
import { jira } from "@/lib/adapters";

export const dynamic = "force-dynamic";

type Severity = "blocking" | "warning" | "nit" | "info";

type Finding = {
  ruleId: string;
  severity: Severity;
  status?: string;
  workflowId?: number;
  location?: string;
  issue: string;
  fix?: string;
  evidence?: string;
};

type ReqBody = {
  repo: string;
  pr_number: number;
  pr_url?: string;
  pr_title?: string;
  finding: Finding;
  skip_github?: boolean;
  skip_jira?: boolean;
};

type GhResult =
  | { url: string; mode: "inline" | "general" }
  | { error: string };
type JiraResult =
  | { key: string; url: string | null; mocked: boolean }
  | { error: string };

export async function POST(req: Request) {
  let body: ReqBody;
  try {
    body = (await req.json()) as ReqBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const { repo, pr_number, finding, pr_url, pr_title } = body;
  if (!repo || !pr_number || !finding?.ruleId || !finding.issue) {
    return NextResponse.json(
      { error: "missing_required_fields", required: ["repo", "pr_number", "finding"] },
      { status: 400 },
    );
  }

  const tasks = await Promise.allSettled([
    body.skip_github ? Promise.resolve(null) : postGithubComment(repo, pr_number, finding),
    body.skip_jira ? Promise.resolve(null) : createJiraTicket(repo, pr_number, finding, pr_url, pr_title),
  ]);

  const [ghTask, jiraTask] = tasks;
  const comment: GhResult | null =
    ghTask.status === "fulfilled"
      ? ghTask.value
      : { error: shortenError(ghTask.reason) };
  const jiraOut: JiraResult | null =
    jiraTask.status === "fulfilled"
      ? jiraTask.value
      : { error: shortenError(jiraTask.reason) };

  return NextResponse.json({ comment, jira: jiraOut });
}

// ── GitHub side ──────────────────────────────────────────────────────

/**
 * Try posting an inline review comment first; if the location can't be
 * parsed to file+line, OR if the inline call fails (commonly because the
 * line isn't part of the diff), fall back to a general conversation comment.
 */
async function postGithubComment(
  repo: string,
  prNumber: number,
  finding: Finding,
): Promise<GhResult> {
  const body = renderCommentBody(finding);
  const parsed = parseLocation(finding.location);
  if (parsed) {
    try {
      const out = await github.postInlineComment(repo, prNumber, {
        path: parsed.path,
        line: parsed.line,
        body,
      });
      return { url: out.url, mode: "inline" };
    } catch (err) {
      // Most common cause: the line isn't part of the diff. Fall through to
      // a general comment so the user still gets *something* on the PR.
      const msg = (err as Error).message ?? "";
      if (!/422|not.*valid|outside the diff/i.test(msg)) {
        // Genuinely unexpected — surface it instead of silently fallback.
        throw err;
      }
    }
  }
  const out = await github.postReviewComment(
    repo,
    prNumber,
    `**[${finding.ruleId}] ${finding.severity}** ${
      finding.location ? `· \`${finding.location}\` ` : ""
    }\n\n${body}`,
  );
  return { url: out.url, mode: "general" };
}

function renderCommentBody(finding: Finding): string {
  const lines: string[] = [];
  lines.push(`**${finding.ruleId} · ${labelForSeverity(finding.severity)}** — ${finding.issue}`);
  if (finding.fix) lines.push("", `**Fix:** ${finding.fix}`);
  if (finding.evidence) {
    lines.push("", "<details><summary>Evidence</summary>", "", "```", finding.evidence, "```", "", "</details>");
  }
  lines.push("", "_Filed automatically by CTO Brain code review._");
  return lines.join("\n");
}

function labelForSeverity(s: Severity): string {
  return s === "blocking" ? "Blocking" : s === "warning" ? "Warning" : s === "nit" ? "Nit" : "Info";
}

/**
 * Parse a finding's `location` field into (path, line). Accepts a few common
 * shapes seen in the existing review pipeline:
 *   - "src/auth.ts:42"
 *   - "src/auth.ts:42-45"  (uses 42)
 *   - "src/auth.ts L42"
 *   - "src/auth.ts" (no line — returns null so caller falls back to general)
 */
function parseLocation(loc?: string): { path: string; line: number } | null {
  if (!loc) return null;
  const trimmed = loc.trim();
  // path:line or path:line-line
  const colon = /^(.+?):(\d+)(?:-\d+)?$/.exec(trimmed);
  if (colon) {
    const line = Number(colon[2]);
    if (Number.isFinite(line) && line > 0) return { path: colon[1], line };
  }
  // path L42
  const lForm = /^(.+?)\s+L(\d+)\b/.exec(trimmed);
  if (lForm) {
    const line = Number(lForm[2]);
    if (Number.isFinite(line) && line > 0) return { path: lForm[1], line };
  }
  return null;
}

// ── Jira side ────────────────────────────────────────────────────────

async function createJiraTicket(
  repo: string,
  prNumber: number,
  finding: Finding,
  prUrl?: string,
  prTitle?: string,
): Promise<JiraResult> {
  const issueType = finding.severity === "blocking" ? "Bug" : "Task";
  const summary = `[${finding.ruleId}] ${finding.issue}`.slice(0, 254);

  const descLines: string[] = [];
  descLines.push(`Auto-filed from CTO Brain code review for PR ${repo}#${prNumber}.`);
  if (prUrl) descLines.push(`PR: ${prUrl}`);
  if (prTitle) descLines.push(`Title: ${prTitle}`);
  descLines.push("");
  descLines.push(`Rule: ${finding.ruleId}`);
  descLines.push(`Severity: ${finding.severity}`);
  if (finding.location) descLines.push(`Location: ${finding.location}`);
  descLines.push("");
  descLines.push(`Issue: ${finding.issue}`);
  if (finding.fix) descLines.push("", `Suggested fix: ${finding.fix}`);
  if (finding.evidence) descLines.push("", `Evidence:`, finding.evidence);

  const result = await jira.createIssue({
    summary,
    description: descLines.join("\n"),
    issueType,
    labels: [
      "cto-brain",
      "code-review",
      `severity:${finding.severity}`,
      `rule:${finding.ruleId}`.replace(/[^a-z0-9:.-]/gi, ""),
    ],
  });
  return result;
}

// ── Misc ─────────────────────────────────────────────────────────────

function shortenError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.length > 300 ? msg.slice(0, 297) + "…" : msg;
}
