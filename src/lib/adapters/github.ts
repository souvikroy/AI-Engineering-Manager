import { Octokit } from "@octokit/rest";
import type { GitHubPR, IGitHubAdapter } from "./types";

let octokit: Octokit | null = null;

function client(): Octokit {
  if (!octokit) {
    const token = process.env.GITHUB_PAT;
    if (!token) throw new Error("GITHUB_PAT not set");
    octokit = new Octokit({ auth: token });
  }
  return octokit;
}

function parseRepo(repo: string): { owner: string; repo: string } {
  const cleaned = repo.replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "").replace(/\/+$/, "");
  const [owner, name] = cleaned.split("/");
  if (!owner || !name) throw new Error(`Invalid GITHUB_REPO format, expected owner/name (or https URL), got: ${repo}`);
  return { owner, repo: name };
}

function ciStatus(checkRuns: { conclusion: string | null; status: string }[]): GitHubPR["ciStatus"] {
  if (checkRuns.length === 0) return "unknown";
  if (checkRuns.some((c) => c.conclusion === "failure" || c.conclusion === "timed_out" || c.conclusion === "cancelled")) return "failure";
  if (checkRuns.some((c) => c.status !== "completed")) return "pending";
  if (checkRuns.every((c) => c.conclusion === "success" || c.conclusion === "neutral" || c.conclusion === "skipped")) return "success";
  return "unknown";
}

export const github: IGitHubAdapter = {
  async listOpenPRs(repo) {
    const { owner, repo: name } = parseRepo(repo);
    const { data } = await client().pulls.list({ owner, repo: name, state: "open", per_page: 50 });
    return data.map((p) => ({ number: p.number, title: p.title, url: p.html_url }));
  },
  async listMergedPRs(repo, since) {
    const { owner, repo: name } = parseRepo(repo);
    const sinceDate = new Date(since).getTime();
    // GitHub PR list doesn't filter by merge date — pull last 100 closed PRs
    // and trim to the window. Plenty for leaderboard windows up to ~1 quarter.
    const { data } = await client().pulls.list({
      owner,
      repo: name,
      state: "closed",
      sort: "updated",
      direction: "desc",
      per_page: 100,
    });
    return data
      .filter((p) => p.merged_at && new Date(p.merged_at).getTime() >= sinceDate)
      .map((p) => ({
        number: p.number,
        title: p.title,
        url: p.html_url,
        author: p.user?.login ?? "unknown",
        mergedAt: p.merged_at as string,
      }));
  },
  async getPR(repo, number) {
    const { owner, repo: name } = parseRepo(repo);
    const o = client();
    const [pr, files, commits, checks] = await Promise.all([
      o.pulls.get({ owner, repo: name, pull_number: number }),
      o.pulls.listFiles({ owner, repo: name, pull_number: number, per_page: 300 }),
      o.pulls.listCommits({ owner, repo: name, pull_number: number, per_page: 100 }),
      o.checks.listForRef({ owner, repo: name, ref: `pull/${number}/head`, per_page: 50 }).catch(() => ({ data: { check_runs: [] as { conclusion: string | null; status: string }[] } })),
    ]);

    const diffParts = files.data.map((f) => {
      const header = `diff --git a/${f.filename} b/${f.filename}\n`;
      return header + (f.patch ?? "(binary or no patch)");
    });

    return {
      number: pr.data.number,
      title: pr.data.title,
      body: pr.data.body ?? "",
      author: pr.data.user?.login ?? "unknown",
      draft: pr.data.draft ?? false,
      baseRef: pr.data.base.ref,
      headRef: pr.data.head.ref,
      labels: pr.data.labels.map((l) => (typeof l === "string" ? l : l.name ?? "")).filter(Boolean),
      changedFiles: files.data.map((f) => f.filename),
      diff: diffParts.join("\n\n"),
      ciStatus: ciStatus(checks.data.check_runs),
      url: pr.data.html_url,
      createdAt: pr.data.created_at,
      commits: commits.data.map((c) => ({ sha: c.sha, message: c.commit.message })),
    };
  },
  async postReviewComment(repo, number, body) {
    const { owner, repo: name } = parseRepo(repo);
    const { data } = await client().pulls.createReview({
      owner,
      repo: name,
      pull_number: number,
      event: "COMMENT",
      body,
    });
    return { url: data.html_url };
  },
};
