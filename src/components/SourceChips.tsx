"use client";

import {
  Layers,
  Hash,
  AlertTriangle,
  GitBranch,
  MessagesSquare,
  FileText,
  Database,
  Boxes,
} from "lucide-react";

const SOURCE_META: Record<
  string,
  { label: string; icon: React.ElementType; color: string }
> = {
  jira: { label: "Jira", icon: Layers, color: "text-blue-300" },
  linear: { label: "Linear", icon: Layers, color: "text-indigo-300" },
  sentry: { label: "Sentry", icon: AlertTriangle, color: "text-purple-300" },
  github: { label: "GitHub", icon: GitBranch, color: "text-ink-dim" },
  slack: { label: "Slack", icon: MessagesSquare, color: "text-pink-300" },
  standup: { label: "Standups", icon: FileText, color: "text-emerald-300" },
  confluence: { label: "Confluence", icon: FileText, color: "text-cyan-300" },
  notion: { label: "Notion", icon: FileText, color: "text-ink-dim" },
  gsheet: { label: "Sheets", icon: Database, color: "text-emerald-300" },
  rag: { label: "Context engine", icon: Boxes, color: "text-amber-300" },
  prisma: { label: "App DB", icon: Database, color: "text-ink-dim" },
};

const ALL_LIKELY = [
  "jira",
  "sentry",
  "github",
  "standup",
  "slack",
  "rag",
  "prisma",
];

/**
 * Compact source-breakdown chip row. Renders ✓ for sources actually checked
 * during this turn, and a faint dash for plausible-but-skipped sources, so the
 * CEO can see at a glance "what data went into this answer".
 */
export function SourceChips({
  sources,
  className,
}: {
  sources: string[];
  className?: string;
}) {
  const checked = new Set(sources);
  const visible = Array.from(
    new Set([...ALL_LIKELY, ...sources]),
  ).filter((s) => SOURCE_META[s]);

  if (sources.length === 0) return null;

  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] ${className ?? ""}`}>
      <span className="text-[10px] uppercase tracking-kicker text-ink-faint font-semibold">
        Checked
      </span>
      {visible.map((s) => {
        const meta = SOURCE_META[s];
        const Icon = meta.icon;
        const on = checked.has(s);
        return (
          <span
            key={s}
            className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 transition-opacity ${
              on
                ? `border-border bg-bg-elevated/70 ${meta.color}`
                : "border-border/40 bg-transparent text-ink-ghost opacity-50"
            }`}
            title={on ? `${meta.label} consulted` : `${meta.label} not consulted`}
          >
            <Icon className="h-2.5 w-2.5" />
            <span>{meta.label}</span>
            <span className="text-[9px]">{on ? "✓" : "—"}</span>
          </span>
        );
      })}
    </div>
  );
}

/**
 * Tiny inline citation chip for use in message footers.
 */
export function CitationChip({
  kind,
  id,
  url,
}: {
  kind: string;
  id: string;
  url?: string | null;
}) {
  const meta = SOURCE_META[kind] ?? { label: kind, icon: Hash, color: "text-ink-dim" };
  const Icon = meta.icon;
  const inner = (
    <span
      className={`inline-flex items-center gap-1 rounded-md border border-border bg-surface px-1.5 py-0.5 text-[11px] font-mono ${meta.color} hover:bg-surface-hover transition-colors`}
    >
      <Icon className="h-2.5 w-2.5" />
      <span>{kind}/{id}</span>
    </span>
  );
  if (url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="no-underline">
        {inner}
      </a>
    );
  }
  return inner;
}
