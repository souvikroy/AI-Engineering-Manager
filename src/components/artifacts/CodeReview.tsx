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
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-kicker text-ink-faint font-semibold">
          <span>Code review</span>
          <span className="text-ink-ghost">·</span>
          <span className="normal-case tracking-normal">{artifact.classification}</span>
        </div>
        <h2 className="mt-1 text-[18px] font-semibold tracking-tight2 text-ink">
          {artifact.repo} #{artifact.pr_number}
        </h2>
        <p className="text-[13px] text-ink-dim mt-0.5">{artifact.pr_title}</p>
        <div className="mt-3 flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${verdict.tone}`}
          >
            {verdict.label}
          </span>
          {artifact.pr_url ? (
            <a
              href={artifact.pr_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-ink-faint hover:text-accent"
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
              className="inline-flex items-center gap-1 text-[11px] text-emerald-300 hover:underline"
            >
              <Check className="h-3 w-3" /> Posted
            </a>
          ) : null}
        </div>
        {artifact.summary ? (
          <p className="mt-3 text-[13px] text-ink-dim leading-relaxed">{artifact.summary}</p>
        ) : null}
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {groups.length === 0 ? (
          <div className="text-center py-12 text-[13px] text-ink-faint">
            <Check className="h-5 w-5 mx-auto mb-2 text-emerald-300" />
            No issues found. {passed} checks passed.
          </div>
        ) : (
          groups.map(({ sev, findings }) => {
            const meta = SEVERITY_META[sev];
            const Icon = meta.icon;
            return (
              <div key={sev}>
                <h3 className="text-[10px] uppercase tracking-kicker text-ink-faint font-semibold mb-2 flex items-center gap-1.5">
                  <Icon className={`h-3.5 w-3.5 ${meta.tone}`} />
                  {meta.label} ({findings.length})
                </h3>
                <ul className="space-y-2">
                  {findings.map((f, i) => (
                    <li
                      key={`${f.ruleId}-${i}`}
                      className="rounded-lg border border-border bg-surface p-3"
                    >
                      <div className="flex items-start justify-between gap-3 mb-1">
                        <span className="font-mono text-[11px] text-ink-faint">
                          {f.ruleId}
                          {f.workflowId ? ` · W${f.workflowId}` : ""}
                        </span>
                        {f.location ? (
                          <span className="font-mono text-[11px] text-ink-faint truncate max-w-[60%]">
                            {f.location}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-[12.5px] text-ink leading-snug mb-1.5">{f.issue}</p>
                      {f.fix ? (
                        <p className="text-[12px] text-ink-dim leading-snug">
                          <span className="text-accent font-medium">Fix:</span> {f.fix}
                        </p>
                      ) : null}
                      {f.evidence ? (
                        <pre className="mt-2 text-[11px] text-ink-faint bg-bg-deep/40 rounded p-2 overflow-x-auto whitespace-pre-wrap">
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
