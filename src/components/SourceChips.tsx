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
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1.5 ${className ?? ""}`}>
      <span className="text-kicker shrink-0 mr-1">
        ✦ Sources Consulted
      </span>
      {visible.map((s) => {
        const meta = SOURCE_META[s];
        const Icon = meta.icon;
        const on = checked.has(s);
        return (
          <span
            key={s}
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-caption transition-opacity surface-hairline ${
              on
                ? `bg-bg-elevated/60 ${meta.color}`
                : "bg-transparent text-ink-ghost opacity-50"
            }`}
            title={on ? `${meta.label} consulted` : `${meta.label} not consulted`}
          >
            <Icon className="h-2.5 w-2.5" />
            <span>{meta.label}</span>
            <span className="text-[9px] opacity-70">{on ? "✓" : "—"}</span>
          </span>
        );
      })}
    </div>
  );
}

/**
 * Inline citation chip used at the bottom of an assistant message.
 * Editorial mix: serif italic source kind + monospace id, separated by a slash.
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
      className={`inline-flex items-center gap-1.5 rounded-md bg-surface hover:bg-surface-hover px-2 py-0.5 text-caption transition-colors surface-hairline ${meta.color}`}
    >
      <Icon className="h-2.5 w-2.5" />
      <span className="font-display italic text-ink-dim">{meta.label}</span>
      <span className="text-ink-ghost">/</span>
      <span className="font-mono text-[10.5px] text-ink-dim">{id}</span>
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
