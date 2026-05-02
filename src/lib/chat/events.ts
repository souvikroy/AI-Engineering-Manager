/**
 * Streamed event protocol between /api/chat and the chat UI.
 *
 * The route serializes one of these per line (NDJSON). The client
 * line-buffers the response body and dispatches based on `type`.
 */
import type { Citation } from "@/lib/python";

export type ArtifactKind = "doc" | "leaderboard" | "code_review";

export type DocArtifact = {
  title: string;
  markdown: string;
  freshness_seconds?: number | null;
};

export type LeaderboardColumn = {
  key: string;
  label: string;
  type: "number" | "percent" | "text";
};

export type LeaderboardRow = {
  engineer_id: string;
  engineer_name: string;
  values: Record<string, number | string | null>;
  score: number;
};

export type LeaderboardArtifact = {
  title: string;
  window: "sprint" | "week" | "quarter";
  columns: LeaderboardColumn[];
  rows: LeaderboardRow[];
  sort_by: string;
  formula?: string;
};

export type CodeReviewFinding = {
  ruleId: string;
  severity: "blocking" | "warning" | "nit" | "info";
  status: "pass" | "fail" | "na";
  workflowId?: number;
  location?: string;
  issue: string;
  fix?: string;
  evidence: string;
};

export type CodeReviewArtifact = {
  repo: string;
  pr_number: number;
  pr_title: string;
  pr_url?: string;
  classification: string;
  verdict:
    | "BLOCK"
    | "REQUEST_CHANGES"
    | "APPROVE_WITH_NITS"
    | "APPROVE"
    | "INSUFFICIENT_INFO";
  summary: string;
  findings: CodeReviewFinding[];
  posted_url?: string | null;
};

export type ArtifactPayload =
  | { kind: "doc"; payload: DocArtifact }
  | { kind: "leaderboard"; payload: LeaderboardArtifact }
  | { kind: "code_review"; payload: CodeReviewArtifact };

export type ChatEvent =
  | { type: "text"; delta: string }
  | {
      type: "tool_status";
      tool: string;
      phase: "start" | "end";
      duration_ms?: number;
      input_summary?: string;
      error?: string;
    }
  | ({
      type: "artifact";
      id: string;
      citations: Citation[];
    } & ArtifactPayload)
  | {
      type: "done";
      verdict?: "ok" | "weak" | "unsupported" | "skip";
      citations?: Citation[];
      freshness?: string;
    }
  | { type: "error"; message: string };
