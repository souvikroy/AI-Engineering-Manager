/**
 * `produce_code_review` artifact builder.
 *
 * Thin wrapper over the existing PR review pipeline. The chat tool flattens
 * the per-workflow findings into a single list and emits a `code_review`
 * artifact for the UI; the model also gets a JSON summary so it can talk
 * about the verdict in chat text.
 */
import { reviewPR } from "@/lib/modules/pr-review";
import { github } from "@/lib/adapters/github";
import type { CodeReviewArtifact, CodeReviewFinding } from "@/lib/chat/events";
import type { Citation } from "@/lib/python";

export type ProduceCodeReviewInput = {
  pr_number?: number;
  repo?: string;
  post_to_github?: boolean;
};

export type ProduceCodeReviewOutput = {
  artifact: CodeReviewArtifact;
  citations: Citation[];
  summary: string;
};

const DEFAULT_REPO = process.env.GITHUB_REPO?.replace(/^https?:\/\/github\.com\//, "") ?? "";

export async function produceCodeReview(
  input: ProduceCodeReviewInput,
): Promise<ProduceCodeReviewOutput> {
  const repo = (input.repo ?? DEFAULT_REPO).trim();
  if (!repo) {
    throw new Error("No repo configured. Set GITHUB_REPO or pass repo explicitly.");
  }

  // Resolve PR number — default to highest-numbered open PR.
  let prNumber = input.pr_number;
  if (prNumber == null) {
    const open = await github.listOpenPRs(repo);
    if (open.length === 0) {
      throw new Error(`No open PRs found in ${repo}.`);
    }
    prNumber = open.sort((a, b) => b.number - a.number)[0].number;
  }

  const review = await reviewPR({
    repo,
    prNumber,
    postToGitHub: input.post_to_github ?? false,
  });

  // Flatten per-workflow findings into a single list, carrying workflowId.
  const findings: CodeReviewFinding[] = review.results.flatMap((r) =>
    r.findings.map((f) => ({
      ruleId: f.ruleId,
      severity: f.severity,
      status: f.status,
      workflowId: r.workflowId,
      location: f.location || undefined,
      issue: f.issue,
      fix: f.fix || undefined,
      evidence: f.evidence,
    })),
  );

  // Look up the PR for title + URL (re-fetch is fine — cached upstream by gh API typically).
  const pr = await github.getPR(repo, prNumber);

  const artifact: CodeReviewArtifact = {
    repo,
    pr_number: prNumber,
    pr_title: pr.title,
    pr_url: pr.url,
    classification: review.classification,
    verdict: review.verdict,
    summary: review.summary,
    findings,
    posted_url: review.postedCommentUrl ?? null,
  };

  const citations: Citation[] = [
    {
      kind: "github",
      id: `${repo}#${prNumber}`,
      url: pr.url,
      freshness_seconds: 0,
    },
  ];

  // Compact summary for the model — avoid dumping every finding into context.
  const summary = JSON.stringify({
    pr: `${repo}#${prNumber}`,
    title: pr.title,
    classification: review.classification,
    verdict: review.verdict,
    blocking: findings.filter((f) => f.severity === "blocking").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
    nits: findings.filter((f) => f.severity === "nit").length,
    summary_text: review.summary,
    posted: !!review.postedCommentUrl,
  });

  return { artifact, citations, summary };
}
