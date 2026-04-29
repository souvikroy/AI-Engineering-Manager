import { complete } from "@/lib/anthropic";
import { github } from "@/lib/adapters/github";
import { prisma } from "@/lib/prisma";
import { classify } from "./classifier";
import { selectWorkflows } from "./workflow-router";
import { runWorkflows } from "./workflow-runner";
import { decideVerdict } from "./verdict";
import { postReview } from "./github-poster";
import { ReviewSchema, type Review } from "./types";

export type ReviewRunOptions = {
  repo: string;
  prNumber: number;
  postToGitHub?: boolean;
};

export async function reviewPR(opts: ReviewRunOptions): Promise<Review & { postedCommentUrl?: string }> {
  const pr = await github.getPR(opts.repo, opts.prNumber);

  const classification = await classify(pr);
  const workflowsRun = selectWorkflows(classification, pr);
  const results = await runWorkflows(workflowsRun, pr);
  const { verdict, blocking, warnings, nits } = decideVerdict(results);

  const summary = await summarize(pr.title, classification, verdict, blocking.length, warnings, nits);

  const review = ReviewSchema.parse({ classification, workflowsRun, results, verdict, summary });

  let postedCommentUrl: string | undefined;
  if (opts.postToGitHub) {
    const posted = await postReview(opts.repo, opts.prNumber, review);
    postedCommentUrl = posted.url;
  }

  await persist(opts.repo, pr.number, pr.title, review, postedCommentUrl);

  return { ...review, postedCommentUrl };
}

async function summarize(prTitle: string, classification: string, verdict: string, blocking: number, warnings: number, nits: number): Promise<string> {
  const sys = `You write a 2-3 sentence summary of an automated PR review. Voice: senior engineering manager, calm and direct. No emojis, no preamble.`;
  const user = `PR title: ${prTitle}\nClassification: ${classification}\nVerdict: ${verdict}\nBlocking issues: ${blocking}\nWarnings: ${warnings}\nNits: ${nits}\n\nWrite the summary now.`;
  return complete({
    model: "fast",
    system: sys,
    messages: [{ role: "user", content: user }],
    maxTokens: 200,
    temperature: 0.3,
  });
}

async function persist(repo: string, prNumber: number, prTitle: string, review: Review, postedCommentUrl?: string) {
  const allFindings = review.results.flatMap((r) => r.findings.map((f) => ({ ...f, workflowId: r.workflowId })));
  const created = await prisma.pRReview.create({
    data: {
      repo,
      prNumber,
      prTitle,
      classification: review.classification,
      verdict: review.verdict,
      summary: review.summary,
      workflowsRun: JSON.stringify(review.workflowsRun),
      postedCommentUrl,
    },
  });
  if (allFindings.length > 0) {
    await prisma.finding.createMany({
      data: allFindings.map((f) => ({
        prReviewId: created.id,
        ruleId: f.ruleId,
        workflowId: f.workflowId,
        status: f.status,
        severity: f.severity,
        evidence: f.evidence,
      })),
    });
  }
}
