"use client";

import { Loader2, Check, AlertCircle } from "lucide-react";

export type StatusPillState = {
  tool: string;
  phase: "running" | "done" | "error";
  input_summary?: string;
  duration_ms?: number;
  error?: string;
};

const TOOL_LABELS: Record<string, string> = {
  search_corpus: "Searching corpus",
  search_slack: "Searching Slack",
  search_standups: "Searching standups",
  get_entity_summary: "Fetching summary",
  get_doc: "Fetching doc",
  get_engineer_profile: "Fetching profile",
  get_okr_status: "Reading OKRs",
  list_incidents: "Listing incidents",
  get_ticket: "Fetching ticket",
  produce_doc: "Composing report",
  produce_leaderboard: "Computing leaderboard",
  produce_code_review: "Reviewing PR",
};

function fmtDuration(ms?: number): string {
  if (ms == null) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function StatusPill({ state }: { state: StatusPillState }) {
  const label = TOOL_LABELS[state.tool] ?? state.tool;
  const tone =
    state.phase === "error"
      ? "bg-red-500/[0.06] text-red-300"
      : state.phase === "done"
        ? "bg-bg-elevated/60 text-ink-dim"
        : "bg-accent/[0.06] text-accent";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-caption surface-hairline ${tone}`}
    >
      {state.phase === "running" ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : state.phase === "done" ? (
        <Check className="h-3 w-3" />
      ) : (
        <AlertCircle className="h-3 w-3" />
      )}
      <span className="font-medium">{label}</span>
      {state.input_summary ? (
        <span className="text-ink-faint font-display italic">
          · {state.input_summary}
        </span>
      ) : null}
      {state.duration_ms != null && state.phase !== "running" ? (
        <span className="text-ink-ghost tabular-nums">
          · {fmtDuration(state.duration_ms)}
        </span>
      ) : null}
    </span>
  );
}
