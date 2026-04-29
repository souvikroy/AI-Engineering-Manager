"use client";

import { useEffect, useState } from "react";
import { Card, Pill, SectionHeader } from "@/components/Card";
import { Button } from "@/components/Button";
import { GitPullRequestArrow, Loader2, Sparkles, ExternalLink, ShieldCheck, ShieldX, ShieldAlert, Search } from "lucide-react";

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

const VERDICT_TONE: Record<string, "ok" | "warn" | "bad" | "muted" | "accent"> = {
  APPROVE: "ok",
  APPROVE_WITH_NITS: "ok",
  REQUEST_CHANGES: "warn",
  BLOCK: "bad",
  INSUFFICIENT_INFO: "muted",
};

const VERDICT_ICON: Record<string, React.ReactNode> = {
  APPROVE: <ShieldCheck className="w-3.5 h-3.5" />,
  APPROVE_WITH_NITS: <ShieldCheck className="w-3.5 h-3.5" />,
  REQUEST_CHANGES: <ShieldAlert className="w-3.5 h-3.5" />,
  BLOCK: <ShieldX className="w-3.5 h-3.5" />,
  INSUFFICIENT_INFO: <ShieldAlert className="w-3.5 h-3.5" />,
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
    <div className="space-y-8 animate-fade-in">
      <header className="space-y-2">
        <SectionHeader kicker="PR reviews">21 workflows · 224 rules · CODE_REVIEW_RULESET.md</SectionHeader>
        <h1 className="text-[28px] font-semibold tracking-tight">Production review, on every PR.</h1>
      </header>

      <Card
        title="Run a review"
        subtitle="Pulls open PRs from the configured repo, or a single PR by number"
        icon={<Search className="w-4 h-4" strokeWidth={1.75} />}
      >
        <div className="grid md:grid-cols-3 gap-2 mb-3">
          <input
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="owner/repo (or use GITHUB_REPO env)"
            className="bg-bg-elevated border border-border rounded-lg p-2.5 text-[13px] focus:outline-none focus:border-accent/40 placeholder:text-ink-ghost transition"
          />
          <input
            value={prNumber}
            onChange={(e) => setPrNumber(e.target.value)}
            placeholder="PR number (optional)"
            className="bg-bg-elevated border border-border rounded-lg p-2.5 text-[13px] focus:outline-none focus:border-accent/40 placeholder:text-ink-ghost transition"
          />
          <label className="flex items-center gap-2 px-3 rounded-lg border border-border bg-bg-elevated text-[12.5px] text-ink-dim cursor-pointer">
            <input type="checkbox" checked={postToGitHub} onChange={(e) => setPostToGitHub(e.target.checked)} className="accent-accent" />
            Post summary to GitHub
          </label>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={scan} disabled={loading} variant="primary">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {loading ? "Reviewing" : prNumber ? `Review PR #${prNumber}` : "Scan open PRs (max 5)"}
          </Button>
          {err && <span className="text-[11.5px] text-bad break-all">{err}</span>}
        </div>
      </Card>

      <Card title="Recent reviews" subtitle={reviews.length === 0 ? "Run your first scan above" : `${reviews.length} reviewed`} icon={<GitPullRequestArrow className="w-4 h-4" strokeWidth={1.75} />}>
        {reviews.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <GitPullRequestArrow className="w-5 h-5 text-ink-ghost mx-auto mb-2" strokeWidth={1.5} />
            <p className="text-[12.5px] text-ink-dim">No reviews yet. Configure GITHUB_PAT and run a scan.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {reviews.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => setActive(r)}
                  className={`w-full text-left p-3.5 rounded-lg border transition-all ${
                    active?.id === r.id ? "border-accent/40 bg-accent/[0.06]" : "border-border bg-surface hover:bg-surface-hover hover:border-border-strong"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <Pill tone={VERDICT_TONE[r.verdict]} size="xs">
                        <span className="flex items-center gap-1">
                          {VERDICT_ICON[r.verdict]}
                          {r.verdict.replace("_", " ")}
                        </span>
                      </Pill>
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-ink leading-snug">
                          <span className="font-mono text-[11.5px] text-accent">#{r.prNumber}</span>
                          <span className="ml-1.5">{r.prTitle}</span>
                        </p>
                        <p className="text-[11.5px] text-ink-faint font-mono mt-0.5">{r.repo}</p>
                      </div>
                    </div>
                    <Pill tone="muted" size="xs">{r.classification}</Pill>
                  </div>
                  <p className="text-[12px] text-ink-dim mt-2 leading-snug">{r.summary}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {active && (
        <Card
          title={`#${active.prNumber} ${active.prTitle}`}
          subtitle={`${active.repo} · classification ${active.classification} · workflows ${active.workflowsRun}`}
          icon={<GitPullRequestArrow className="w-4 h-4 text-accent" strokeWidth={1.75} />}
          action={active.postedCommentUrl ? (
            <a href={active.postedCommentUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[12px] text-accent hover:text-ink transition">
              <ExternalLink className="w-3.5 h-3.5" /> View on GitHub
            </a>
          ) : null}
        >
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-2">
            {active.findings.filter((f) => f.status === "fail").length === 0 ? (
              <div className="md:col-span-2 lg:col-span-3 rounded-lg border border-dashed border-border p-6 text-center">
                <ShieldCheck className="w-5 h-5 text-ok mx-auto mb-2" strokeWidth={1.5} />
                <p className="text-[12.5px] text-ink-dim">No failures.</p>
              </div>
            ) : (
              active.findings
                .filter((f) => f.status === "fail")
                .map((f) => (
                  <div key={f.id} className="rounded-lg border border-border bg-bg/40 p-3">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Pill tone={f.severity === "blocking" ? "bad" : f.severity === "warning" ? "warn" : "muted"} size="xs">
                        {f.severity}
                      </Pill>
                      <span className="font-mono text-[11px] text-accent">{f.ruleId}</span>
                      <span className="text-[10.5px] text-ink-ghost">W{f.workflowId}</span>
                    </div>
                    <p className="text-[11.5px] text-ink/90 leading-snug">{f.evidence}</p>
                  </div>
                ))
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
