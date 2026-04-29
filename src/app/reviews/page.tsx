"use client";

import { useEffect, useState } from "react";
import { Card, Pill } from "@/components/Card";

type Finding = { id: string; ruleId: string; workflowId: number; status: string; severity: string; evidence: string };
type Review = {
  id: string;
  repo: string;
  prNumber: number;
  prTitle: string;
  classification: string;
  verdict: string;
  summary: string;
  workflowsRun: string;
  postedCommentUrl: string | null;
  createdAt: string;
  findings: Finding[];
};

export default function ReviewsPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [repo, setRepo] = useState("");
  const [prNumber, setPrNumber] = useState("");
  const [postToGitHub, setPostToGitHub] = useState(true);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState<Review | null>(null);

  async function refresh() {
    const j = (await (await fetch("/api/reviews")).json()) as { reviews: Review[] };
    setReviews(j.reviews ?? []);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function scan() {
    setLoading(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = { postToGitHub };
      if (repo) body.repo = repo;
      if (prNumber) body.prNumber = parseInt(prNumber, 10);
      const res = await fetch("/api/reviews/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      if (j.errors?.length) setErr(JSON.stringify(j.errors));
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">PR Reviews</h1>
        <p className="text-sm text-muted mt-1">Classifies each PR, runs the relevant workflows from CODE_REVIEW_RULESET.md, and (optionally) posts a summary comment to GitHub.</p>
      </header>

      <Card title="Run a review" subtitle="Pulls open PRs from the configured repo, or a single PR by number">
        <div className="grid md:grid-cols-3 gap-2">
          <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo (or use GITHUB_REPO env)" className="bg-bg border border-border rounded p-2 text-sm" />
          <input value={prNumber} onChange={(e) => setPrNumber(e.target.value)} placeholder="PR number (optional)" className="bg-bg border border-border rounded p-2 text-sm" />
          <label className="text-xs text-muted flex items-center gap-2">
            <input type="checkbox" checked={postToGitHub} onChange={(e) => setPostToGitHub(e.target.checked)} />
            Post summary comment to GitHub
          </label>
        </div>
        <button onClick={scan} disabled={loading} className="mt-3 bg-accent hover:bg-accent/80 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50">
          {loading ? "Reviewing…" : prNumber ? `Review PR #${prNumber}` : "Scan open PRs (max 5)"}
        </button>
        {err && <p className="text-xs text-bad mt-2">{err}</p>}
      </Card>

      <Card title="Recent reviews">
        {reviews.length === 0 ? (
          <p className="text-xs text-muted">No reviews yet.</p>
        ) : (
          <ul className="space-y-2">
            {reviews.map((r) => (
              <li key={r.id}>
                <button onClick={() => setActive(r)} className={`w-full text-left p-3 border rounded text-sm ${active?.id === r.id ? "border-accent bg-accent/10" : "border-border hover:bg-border"}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <Pill tone={r.verdict === "BLOCK" ? "bad" : r.verdict === "REQUEST_CHANGES" ? "warn" : "ok"}>{r.verdict}</Pill>
                      <span className="ml-2 font-mono text-accent">{r.repo}#{r.prNumber}</span>
                      <span className="ml-2">{r.prTitle}</span>
                    </div>
                    <Pill tone="muted">{r.classification}</Pill>
                  </div>
                  <p className="text-xs text-muted mt-1">{r.summary}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {active && (
        <Card title={`#${active.prNumber} ${active.prTitle}`} subtitle={`${active.repo} · classification ${active.classification} · workflows ${active.workflowsRun}`}>
          {active.postedCommentUrl && (
            <p className="text-xs mb-3"><a href={active.postedCommentUrl} target="_blank" rel="noreferrer" className="text-accent underline">View posted comment on GitHub →</a></p>
          )}
          <div className="grid md:grid-cols-3 gap-2 text-xs">
            {active.findings.filter((f) => f.status === "fail").map((f) => (
              <div key={f.id} className="border border-border rounded p-2">
                <div><Pill tone={f.severity === "blocking" ? "bad" : f.severity === "warning" ? "warn" : "muted"}>{f.severity}</Pill> <span className="font-mono ml-1">{f.ruleId}</span></div>
                <p className="text-white/80 mt-1">{f.evidence}</p>
              </div>
            ))}
            {active.findings.filter((f) => f.status === "fail").length === 0 && <p className="text-muted">No failures.</p>}
          </div>
        </Card>
      )}
    </div>
  );
}
