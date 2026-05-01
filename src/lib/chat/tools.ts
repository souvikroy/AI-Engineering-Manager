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

export type ToolDef = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type ToolResult = {
  content: string; // JSON-serialized payload sent back as tool_result
  citations: Citation[]; // collected for the provenance verifier
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
    default:
      return pack({ error: `unknown_tool:${name}` }, []);
  }
}
