"use client";

import { ExternalLink, AlertOctagon, AlertTriangle, Info, Check } from "lucide-react";
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
                    <li
                      key={`${f.ruleId}-${i}`}
                      className="rounded-xl bg-surface p-4 surface-card"
                    >
                      <div className="flex items-start justify-between gap-3 mb-1.5">
                        <span className="font-mono text-caption text-ink-faint">
                          {f.ruleId}
                          {f.workflowId ? ` · W${f.workflowId}` : ""}
                        </span>
                        {f.location ? (
                          <span className="font-mono text-caption text-ink-faint truncate max-w-[60%]">
                            {f.location}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-body-md text-ink leading-snug mb-2">
                        {f.issue}
                      </p>
                      {f.fix ? (
                        <p className="text-body-md text-ink-dim leading-snug">
                          <span className="text-accent font-display italic">
                            Fix:
                          </span>{" "}
                          {f.fix}
                        </p>
                      ) : null}
                      {f.evidence ? (
                        <pre className="mt-2.5 text-caption text-ink-faint bg-bg-deep/40 rounded-md p-2.5 overflow-x-auto whitespace-pre-wrap surface-hairline">
                          {f.evidence}
                        </pre>
                      ) : null}
                    </li>
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
