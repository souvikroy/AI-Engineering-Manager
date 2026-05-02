"use client";

import { useState } from "react";
import {
  ExternalLink,
  AlertOctagon,
  AlertTriangle,
  Info,
  Check,
  MessageSquarePlus,
  Loader2,
  RotateCw,
  Ticket,
  AlertCircle,
} from "lucide-react";
import type { CodeReviewArtifact, CodeReviewFinding } from "@/lib/chat/events";

const SEVERITY_ORDER: CodeReviewFinding["severity"][] = ["blocking", "warning", "nit", "info"];

const VERDICT_LABELS: Record<CodeReviewArtifact["verdict"], { label: string; tone: string }> = {
  BLOCK: { label: "Blocked", tone: "bg-red-500/10 text-red-300 border-red-500/30" },
  REQUEST_CHANGES: {
    label: "Changes requested",
    tone: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  },
  APPROVE_WITH_NITS: {
    label: "Approved with nits",
    tone: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  },
  APPROVE: {
    label: "Approved",
    tone: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  },
  INSUFFICIENT_INFO: {
    label: "Insufficient info",
    tone: "bg-bg-elevated text-ink-dim border-border",
  },
};

const SEVERITY_META: Record<
  CodeReviewFinding["severity"],
  { label: string; icon: React.ElementType; tone: string }
> = {
  blocking: { label: "Blocking", icon: AlertOctagon, tone: "text-red-400" },
  warning: { label: "Warning", icon: AlertTriangle, tone: "text-amber-400" },
  nit: { label: "Nit", icon: Info, tone: "text-ink-dim" },
  info: { label: "Info", icon: Info, tone: "text-ink-faint" },
};

export function CodeReview({ artifact }: { artifact: CodeReviewArtifact }) {
  const verdict = VERDICT_LABELS[artifact.verdict];
  const groups = SEVERITY_ORDER.map((sev) => ({
    sev,
    findings: artifact.findings.filter((f) => f.severity === sev && f.status !== "pass"),
  })).filter((g) => g.findings.length > 0);

  const passed = artifact.findings.filter((f) => f.status === "pass").length;

  return (
    <div className="flex h-full flex-col">
      <div className="px-8 pt-8 pb-6">
        <div className="flex items-center gap-2 text-kicker">
          <span>✦ Code Review</span>
          <span className="text-ink-ghost">·</span>
          <span>{artifact.classification}</span>
        </div>
        <h2 className="mt-2 font-display text-h1 text-ink-cream tracking-tight2 leading-tight">
          {artifact.repo}
          <span className="text-ink-faint"> · </span>
          <span className="font-mono text-[28px]">#{artifact.pr_number}</span>
        </h2>
        <p className="text-body-lg text-ink-dim mt-1.5">{artifact.pr_title}</p>
        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-caption font-display italic ${verdict.tone}`}
          >
            {verdict.label}
          </span>
          {artifact.pr_url ? (
            <a
              href={artifact.pr_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-caption text-ink-faint hover:text-accent transition-colors"
            >
              View on GitHub
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
          {artifact.posted_url ? (
            <a
              href={artifact.posted_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-caption text-emerald-300 hover:underline"
            >
              <Check className="h-3 w-3" /> Posted
            </a>
          ) : null}
        </div>
        {artifact.summary ? (
          <p className="mt-4 font-display italic text-body-lg text-ink-dim leading-relaxed">
            {artifact.summary}
          </p>
        ) : null}
      </div>
      <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-5">
        {groups.length === 0 ? (
          <div className="text-center py-16">
            <Check className="h-6 w-6 mx-auto mb-3 text-emerald-300" />
            <p className="font-display italic text-body-lg text-ink-dim">
              No issues found. {passed} checks passed.
            </p>
          </div>
        ) : (
          groups.map(({ sev, findings }) => {
            const meta = SEVERITY_META[sev];
            const Icon = meta.icon;
            return (
              <div key={sev}>
                <h3 className="text-kicker mb-3 flex items-center gap-1.5">
                  <Icon className={`h-3.5 w-3.5 ${meta.tone}`} />
                  <span>
                    ✦ {meta.label} ({findings.length})
                  </span>
                </h3>
                <ul className="space-y-2.5">
                  {findings.map((f, i) => (
                    <FindingItem
                      key={`${f.ruleId}-${i}`}
                      finding={f}
                      repo={artifact.repo}
                      prNumber={artifact.pr_number}
                      prUrl={artifact.pr_url}
                      prTitle={artifact.pr_title}
                    />
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Per-finding action: post inline GH comment + create Jira ticket ──

type GhSuccess = { url: string; mode: "inline" | "general" };
type SideError = { error: string };
type JiraSuccess = { key: string; url: string | null; mocked: boolean };

type ActionResp = {
  comment: GhSuccess | SideError | null;
  jira: JiraSuccess | SideError | null;
};

function isErr(x: GhSuccess | JiraSuccess | SideError | null | undefined): x is SideError {
  return !!x && "error" in x;
}

function FindingItem({
  finding,
  repo,
  prNumber,
  prUrl,
  prTitle,
}: {
  finding: CodeReviewFinding;
  repo: string;
  prNumber: number;
  prUrl?: string;
  prTitle?: string;
}) {
  const [pending, setPending] = useState<"all" | "github" | "jira" | null>(null);
  const [comment, setComment] = useState<GhSuccess | SideError | null>(null);
  const [jira, setJira] = useState<JiraSuccess | SideError | null>(null);

  async function fire(opts?: { skipGithub?: boolean; skipJira?: boolean }) {
    setPending(opts?.skipGithub ? "jira" : opts?.skipJira ? "github" : "all");
    try {
      const res = await fetch("/api/code-review/comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo,
          pr_number: prNumber,
          pr_url: prUrl,
          pr_title: prTitle,
          finding,
          skip_github: opts?.skipGithub,
          skip_jira: opts?.skipJira,
        }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        if (!opts?.skipGithub) setComment({ error: errText.slice(0, 300) });
        if (!opts?.skipJira) setJira({ error: errText.slice(0, 300) });
        return;
      }
      const data = (await res.json()) as ActionResp;
      if (!opts?.skipGithub && data.comment) setComment(data.comment);
      if (!opts?.skipJira && data.jira) setJira(data.jira);
    } catch (e) {
      const err = { error: (e as Error).message };
      if (!opts?.skipGithub) setComment(err);
      if (!opts?.skipJira) setJira(err);
    } finally {
      setPending(null);
    }
  }

  const hasFired = comment != null || jira != null;
  const ghOk = comment != null && !isErr(comment);
  const jiraOk = jira != null && !isErr(jira);

  return (
    <li className="rounded-xl bg-surface p-4 surface-card">
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <span className="font-mono text-caption text-ink-faint">
          {finding.ruleId}
          {finding.workflowId ? ` · W${finding.workflowId}` : ""}
        </span>
        {finding.location ? (
          <span className="font-mono text-caption text-ink-faint truncate max-w-[60%]">
            {finding.location}
          </span>
        ) : null}
      </div>
      <p className="text-body-md text-ink leading-snug mb-2">{finding.issue}</p>
      {finding.fix ? (
        <p className="text-body-md text-ink-dim leading-snug">
          <span className="text-accent font-display italic">Fix:</span>{" "}
          {finding.fix}
        </p>
      ) : null}
      {finding.evidence ? (
        <pre className="mt-2.5 text-caption text-ink-faint bg-bg-deep/40 rounded-md p-2.5 overflow-x-auto whitespace-pre-wrap surface-hairline">
          {finding.evidence}
        </pre>
      ) : null}

      {/* Action row */}
      <div className="mt-3 pt-3 flex flex-wrap items-center gap-2 border-t border-white/[0.04]">
        {!hasFired ? (
          <button
            onClick={() => void fire()}
            disabled={pending === "all"}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent/[0.08] hover:bg-accent/[0.14] px-3 py-1.5 text-caption font-medium text-accent surface-hairline transition-colors disabled:opacity-60 disabled:cursor-wait"
          >
            {pending === "all" ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                <span className="font-display italic">Posting…</span>
              </>
            ) : (
              <>
                <MessageSquarePlus className="h-3.5 w-3.5" />
                <span className="font-display italic">
                  Add comment &amp; ticket
                </span>
              </>
            )}
          </button>
        ) : (
          <>
            {ghOk ? (
              <a
                href={(comment as GhSuccess).url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/[0.08] px-2.5 py-1 text-caption text-emerald-300 surface-hairline hover:bg-emerald-500/[0.14] transition-colors"
                title={
                  (comment as GhSuccess).mode === "inline"
                    ? "Posted as inline comment at file:line"
                    : "Posted as general PR comment (location wasn't part of the diff)"
                }
              >
                <Check className="h-3 w-3" />
                <span className="font-display italic">
                  {(comment as GhSuccess).mode === "inline"
                    ? "Comment posted"
                    : "Comment posted (general)"}
                </span>
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : isErr(comment) ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/[0.06] px-2.5 py-1 text-caption text-red-300 surface-hairline">
                <AlertCircle className="h-3 w-3" />
                <span
                  className="font-display italic max-w-[280px] truncate"
                  title={comment.error}
                >
                  GitHub: {comment.error}
                </span>
                <button
                  onClick={() => void fire({ skipJira: true })}
                  disabled={pending === "github"}
                  className="ml-1 inline-flex items-center gap-0.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] px-1.5 py-0.5 text-[10.5px] text-ink-dim disabled:opacity-60 disabled:cursor-wait"
                  title="Retry GitHub comment"
                >
                  {pending === "github" ? (
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  ) : (
                    <RotateCw className="h-2.5 w-2.5" />
                  )}
                  retry
                </button>
              </span>
            ) : null}
            {jiraOk ? (
              (() => {
                const j = jira as JiraSuccess;
                const inner = (
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-caption surface-hairline transition-colors ${
                      j.mocked
                        ? "bg-amber-500/[0.06] text-amber-300"
                        : "bg-emerald-500/[0.08] text-emerald-300 hover:bg-emerald-500/[0.14]"
                    }`}
                    title={
                      j.mocked
                        ? "Jira not configured — this key is a stub. Set JIRA_BASE_URL / JIRA_EMAIL / JIRA_PAT / JIRA_PROJECT to file real tickets."
                        : "Jira ticket created"
                    }
                  >
                    <Ticket className="h-3 w-3" />
                    <span className="font-display italic">
                      {j.mocked ? "Stub:" : "Filed:"}
                    </span>
                    <span className="font-mono text-[11px]">{j.key}</span>
                    {j.url ? <ExternalLink className="h-3 w-3" /> : null}
                  </span>
                );
                return j.url ? (
                  <a
                    href={j.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="no-underline"
                  >
                    {inner}
                  </a>
                ) : (
                  inner
                );
              })()
            ) : isErr(jira) ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/[0.06] px-2.5 py-1 text-caption text-red-300 surface-hairline">
                <AlertCircle className="h-3 w-3" />
                <span
                  className="font-display italic max-w-[280px] truncate"
                  title={jira.error}
                >
                  Jira: {jira.error}
                </span>
                <button
                  onClick={() => void fire({ skipGithub: true })}
                  disabled={pending === "jira"}
                  className="ml-1 inline-flex items-center gap-0.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] px-1.5 py-0.5 text-[10.5px] text-ink-dim disabled:opacity-60 disabled:cursor-wait"
                  title="Retry Jira ticket"
                >
                  {pending === "jira" ? (
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  ) : (
                    <RotateCw className="h-2.5 w-2.5" />
                  )}
                  retry
                </button>
              </span>
            ) : null}
          </>
        )}
      </div>
    </li>
  );
}
