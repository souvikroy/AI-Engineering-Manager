/**
 * Tool definitions + executors for the CTO Brain chat loop.
 *
 * Tools split between:
 *  - **Python proxies** (RAG-backed): search_corpus, search_slack, get_entity_summary,
 *    get_doc, compose_brief — fan out to the context engine over HTTP.
 *  - **Local** (Prisma + live adapters): get_engineer_profile, get_okr_status,
 *    list_incidents, get_ticket, get_pr — structured app data, no RAG needed.
 *
 * Each tool returns a JSON-serializable payload. The wrapping chat loop is
 * responsible for budget enforcement, citation collection, and the post-
 * generation provenance verifier.
 */
import { jira, monitoring } from "@/lib/adapters";
import { listIncidents } from "@/lib/modules/interrupt-memory";
import { getEngineerProfile } from "@/lib/modules/people-intel";
import { listOKRs } from "@/lib/modules/execution-tower";
import {
  getDoc,
  getSummary,
  searchCorpus,
  type Citation,
  type SearchInput,
} from "@/lib/python";
import type { ArtifactPayload } from "@/lib/chat/events";
import { produceCodeReview } from "@/lib/chat/artifacts/code-review";
import { produceDoc } from "@/lib/chat/artifacts/doc";
import { produceLeaderboard } from "@/lib/chat/artifacts/leaderboard";

export type ToolDef = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type ToolResult = {
  content: string; // JSON-serialized payload sent back as tool_result
  citations: Citation[]; // collected for the provenance verifier
  artifact?: ArtifactPayload; // optional UI artifact emitted alongside the tool result
};

/** All tool definitions sent to Claude on each turn. */
export const TOOL_DEFS: ToolDef[] = [
  {
    name: "search_corpus",
    description:
      "Hybrid search (BM25 + vector + rerank) over Slack/Jira/Sentry/Confluence/Notion/GitHub. Use this when you need recent or topical context. Returns top hits with source URLs and freshness.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        since: { type: "string", description: "ISO timestamp lower bound" },
        until: { type: "string", description: "ISO timestamp upper bound" },
        sources: {
          type: "array",
          items: {
            enum: [
              "slack",
              "jira",
              "linear",
              "sentry",
              "confluence",
              "notion",
              "gsheet",
              "github",
              "standup",
            ],
          },
        },
        entities: {
          type: "array",
          items: { type: "string" },
          description:
            "Entity refs to filter on, e.g. ['engineer:eng_priya','sprint:S-42'].",
        },
        k: { type: "integer", minimum: 1, maximum: 25, default: 10 },
      },
      required: ["query"],
    },
  },
  {
    name: "search_slack",
    description: "Convenience wrapper over search_corpus with sources=['slack'].",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        since: { type: "string" },
        until: { type: "string" },
        person: {
          type: "string",
          description: "Engineer entity ref like 'engineer:eng_priya' to filter by.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_entity_summary",
    description:
      "Fetch a precomputed L1/L2/L3 summary for an engineer / team / service / sprint. Cheaper than search_corpus when the question is about a known entity.",
    input_schema: {
      type: "object",
      properties: {
        entity_type: { enum: ["engineer", "team", "service", "sprint"] },
        entity_id: { type: "string" },
        window: { enum: ["day", "week", "sprint", "quarter"], default: "week" },
        layer: { type: "integer", enum: [1, 2, 3], default: 2 },
      },
      required: ["entity_type", "entity_id"],
    },
  },
  {
    name: "get_doc",
    description:
      "Fetch a single Document (design doc, ticket, Slack thread, Sentry issue) by id, optionally narrowed to an anchor heading.",
    input_schema: {
      type: "object",
      properties: {
        doc_id: { type: "string" },
        anchor: { type: "string" },
      },
      required: ["doc_id"],
    },
  },
  {
    name: "get_engineer_profile",
    description:
      "Structured profile for an engineer (recent tickets, 1:1s, slack hesitation flags). Use when the user asks about a specific person.",
    input_schema: {
      type: "object",
      properties: { engineer_id: { type: "string" } },
      required: ["engineer_id"],
    },
  },
  {
    name: "get_okr_status",
    description:
      "Returns OKRs and KR progress for the workspace. Optionally filter by team_id or quarter.",
    input_schema: {
      type: "object",
      properties: {
        team_id: { type: "string" },
        quarter: { type: "string" },
      },
    },
  },
  {
    name: "list_incidents",
    description: "List incidents with optional status / severity / since filter.",
    input_schema: {
      type: "object",
      properties: {
        status: { enum: ["open", "resolved", "all"], default: "open" },
        severity: { enum: ["p1", "p2", "p3"] },
        since: { type: "string" },
      },
    },
  },
  {
    name: "get_ticket",
    description:
      "Fetch a single Jira/Linear ticket by key, with last 10 comments and linked PRs/incidents.",
    input_schema: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
    },
  },
  {
    name: "search_standups",
    description:
      "RAG search restricted to standup-meeting transcripts. Use this when the user asks about what someone said in standup, recent commitments, or recurring blockers.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        since: { type: "string", description: "ISO timestamp lower bound" },
        until: { type: "string", description: "ISO timestamp upper bound" },
        engineer_id: {
          type: "string",
          description: "Optional engineer filter, e.g. 'eng_priya'.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "produce_doc",
    description:
      "Produce a markdown REPORT artifact. Use this for sprint-health reports, incident summaries/postmortems, OKR status, the daily brief, or a standup digest. Returns the full report rendered as markdown plus a 'doc' artifact for the side panel. Pick the right `topic` based on the user's question.",
    input_schema: {
      type: "object",
      properties: {
        topic: {
          enum: ["brief", "okr", "incident", "sprint", "standup"],
        },
        scope: {
          type: "string",
          description:
            "Optional id — incident_id for 'incident' topic, sprint_id for 'sprint' topic.",
        },
        window: {
          enum: ["day", "week", "sprint", "quarter"],
          description: "For 'standup' topic.",
        },
        postmortem: {
          type: "boolean",
          description:
            "For 'incident' topic: produce a full postmortem (timeline + root cause) instead of just a situation summary. Defaults to false.",
        },
      },
      required: ["topic"],
    },
  },
  {
    name: "produce_leaderboard",
    description:
      "Produce a LEADERBOARD artifact ranking engineers by composite performance score. Pulls tickets shipped (Jira), PRs merged (GitHub), incidents resolved (Sentry), and standup participation (DB) over the chosen window. Score = weighted z-score, rescaled to 0–100.",
    input_schema: {
      type: "object",
      properties: {
        window: { enum: ["week", "sprint", "quarter"], default: "sprint" },
        team_id: { type: "string", description: "Optional team filter." },
      },
    },
  },
  {
    name: "produce_code_review",
    description:
      "Produce a CODE REVIEW artifact for a GitHub PR. Runs the full review pipeline (classification, workflows, verdict, findings) and returns a code_review artifact with verdict + findings grouped by severity. If pr_number is omitted, defaults to the highest-numbered open PR on the configured repo.",
    input_schema: {
      type: "object",
      properties: {
        pr_number: { type: "integer" },
        repo: {
          type: "string",
          description: "owner/name format, e.g. 'vercel/next.js'. Defaults to GITHUB_REPO env.",
        },
        post_to_github: {
          type: "boolean",
          description: "Post the review back to the PR as a GitHub comment. Defaults to false.",
        },
      },
    },
  },
];

const TRUNCATE = (s: string, n: number) =>
  s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…";

function pack(payload: unknown, citations: Citation[]): ToolResult {
  return { content: JSON.stringify(payload), citations };
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  switch (name) {
    case "search_corpus": {
      const res = await searchCorpus(input as unknown as SearchInput);
      return pack(
        {
          routing: res.routing,
          truncated: res.truncated,
          overflow_summary: res.overflow_summary,
          results: res.results.map((r) => ({
            id: r.id,
            source: r.source,
            url: r.source_url,
            entity_refs: r.entity_refs,
            score: Number(r.score.toFixed(3)),
            freshness_seconds: r.freshness_seconds,
            text: TRUNCATE(r.text, 600),
          })),
        },
        res.citations,
      );
    }
    case "search_slack": {
      const i = input as { query: string; since?: string; until?: string; person?: string };
      const res = await searchCorpus({
        query: i.query,
        since: i.since,
        until: i.until,
        sources: ["slack"],
        entities: i.person ? [i.person] : undefined,
        k: 10,
      });
      return pack(
        res.results.map((r) => ({
          id: r.id,
          permalink: r.source_url,
          freshness_seconds: r.freshness_seconds,
          text: TRUNCATE(r.text, 600),
        })),
        res.citations,
      );
    }
    case "get_entity_summary": {
      const i = input as {
        entity_type: string;
        entity_id: string;
        window?: "day" | "week" | "sprint" | "quarter";
        layer?: 1 | 2 | 3;
      };
      try {
        const s = await getSummary({
          entityType: i.entity_type,
          entityId: i.entity_id,
          window: i.window ?? "week",
          layer: i.layer ?? 2,
        });
        return pack(
          {
            window: s.window,
            window_end: s.window_end,
            text: s.text,
            freshness_seconds: s.freshness_seconds,
          },
          s.citations,
        );
      } catch {
        return pack({ text: null, reason: "summary_not_found" }, []);
      }
    }
    case "get_doc": {
      const i = input as { doc_id: string; anchor?: string };
      const d = await getDoc(i.doc_id, i.anchor);
      return pack(
        {
          id: d.id,
          source: d.source,
          url: d.source_url,
          title: d.title,
          anchor: d.anchor,
          freshness_seconds: d.freshness_seconds,
          text: TRUNCATE(d.text, 4000),
        },
        [
          {
            kind: d.source,
            id: d.id,
            url: d.source_url ?? null,
            freshness_seconds: d.freshness_seconds,
          },
        ],
      );
    }
    case "get_engineer_profile": {
      const i = input as { engineer_id: string };
      const p = await getEngineerProfile(i.engineer_id);
      return pack(p ?? { error: "engineer_not_found" }, []);
    }
    case "get_okr_status": {
      const all = await listOKRs();
      const i = input as { team_id?: string; quarter?: string };
      const filtered = all.filter(
        (o) =>
          (!i.team_id || o.teamId === i.team_id) &&
          (!i.quarter || o.quarter === i.quarter),
      );
      return pack(filtered, []);
    }
    case "list_incidents": {
      const all = await listIncidents();
      const i = input as { status?: string; severity?: string; since?: string };
      const filtered = all.filter(
        (x) =>
          (!i.status || i.status === "all" || x.status === i.status) &&
          (!i.severity || x.severity === i.severity) &&
          (!i.since || new Date(x.openedAt) >= new Date(i.since)),
      );
      return pack(filtered, []);
    }
    case "get_ticket": {
      const i = input as { key: string };
      const tickets = await jira.tickets();
      const t = tickets.find((x) => x.key === i.key);
      if (!t) return pack({ error: "not_found", key: i.key }, []);
      const services = await monitoring.services();
      return pack({ ...t, related_services: services.filter((s) => s.team === t.team) }, []);
    }
    case "search_standups": {
      const i = input as {
        query: string;
        since?: string;
        until?: string;
        engineer_id?: string;
      };
      const res = await searchCorpus({
        query: i.query,
        since: i.since,
        until: i.until,
        sources: ["standup"],
        entities: i.engineer_id ? [`engineer:${i.engineer_id}`] : undefined,
        k: 10,
      });
      return pack(
        res.results.map((r) => ({
          id: r.id,
          url: r.source_url,
          freshness_seconds: r.freshness_seconds,
          entity_refs: r.entity_refs,
          text: TRUNCATE(r.text, 600),
        })),
        res.citations,
      );
    }
    case "produce_doc": {
      const i = input as {
        topic: "brief" | "okr" | "incident" | "sprint" | "standup";
        scope?: string;
        window?: "day" | "week" | "sprint" | "quarter";
        postmortem?: boolean;
      };
      const out = await produceDoc(i);
      return {
        content: out.summary,
        citations: out.citations,
        artifact: { kind: "doc", payload: out.artifact },
      };
    }
    case "produce_leaderboard": {
      const i = input as { window?: "week" | "sprint" | "quarter"; team_id?: string };
      const out = await produceLeaderboard(i);
      return {
        content: out.summary,
        citations: out.citations,
        artifact: { kind: "leaderboard", payload: out.artifact },
      };
    }
    case "produce_code_review": {
      const i = input as { pr_number?: number; repo?: string; post_to_github?: boolean };
      const out = await produceCodeReview(i);
      return {
        content: out.summary,
        citations: out.citations,
        artifact: { kind: "code_review", payload: out.artifact },
      };
    }
    default:
      return pack({ error: `unknown_tool:${name}` }, []);
  }
}
