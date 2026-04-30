/**
 * Typed HTTP client for the Python context engine.
 *
 * The Python side is the only writer to the `rag.*` schema; Next.js never
 * touches those tables directly. Every retrieval / summary / doc tool that
 * the chat loop exposes proxies through this client.
 *
 * Responses are zod-validated so runtime drift between Python (Pydantic) and
 * TS surfaces as a clear error instead of silently bad data in a prompt.
 */
import { z } from "zod";

const BASE_URL = process.env.PYTHON_CONTEXT_URL ?? "http://localhost:8000";
const TIMEOUT_MS = 15_000;

export const SourceSchema = z.enum([
  "slack",
  "jira",
  "linear",
  "sentry",
  "confluence",
  "notion",
  "gsheet",
  "github",
]);
export type Source = z.infer<typeof SourceSchema>;

export const CitationSchema = z.object({
  kind: SourceSchema,
  id: z.string(),
  url: z.string().nullable().optional(),
  freshness_seconds: z.number().int().nullable().optional(),
});
export type Citation = z.infer<typeof CitationSchema>;

export const SearchHitSchema = z.object({
  id: z.string(),
  text: z.string(),
  source: SourceSchema,
  source_url: z.string().nullable(),
  entity_refs: z.array(z.string()),
  score: z.number(),
  freshness_seconds: z.number().int().nullable(),
});
export type SearchHit = z.infer<typeof SearchHitSchema>;

export const SearchResponseSchema = z.object({
  results: z.array(SearchHitSchema),
  citations: z.array(CitationSchema),
  truncated: z.boolean(),
  overflow_summary: z.string().nullable().optional(),
  routing: z.enum(["entity", "semantic", "structured", "mixed"]),
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

export const SummaryResponseSchema = z.object({
  layer: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  entity_type: z.string().nullable(),
  entity_id: z.string().nullable(),
  window: z.string().nullable(),
  window_start: z.string().nullable(),
  window_end: z.string().nullable(),
  text: z.string(),
  token_count: z.number().int(),
  citations: z.array(CitationSchema),
  freshness_seconds: z.number().int().nullable().optional(),
});
export type SummaryResponse = z.infer<typeof SummaryResponseSchema>;

export const DocResponseSchema = z.object({
  id: z.string(),
  source: SourceSchema,
  source_id: z.string(),
  source_url: z.string().nullable(),
  title: z.string(),
  text: z.string(),
  anchor: z.string().nullable().optional(),
  entity_refs: z.array(z.string()),
  updated_at: z.string(),
  freshness_seconds: z.number().int().nullable(),
});
export type DocResponse = z.infer<typeof DocResponseSchema>;

export const FreshnessMapSchema = z.object({
  sources: z.record(SourceSchema, z.number().int().nullable()),
  as_of: z.string(),
});
export type FreshnessMap = z.infer<typeof FreshnessMapSchema>;

export type SearchInput = {
  query: string;
  since?: string | null;
  until?: string | null;
  sources?: Source[];
  entities?: string[];
  k?: number;
  workspaceId?: string;
};

class PythonContextError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "PythonContextError";
  }
}

async function call<T>(
  path: string,
  init: RequestInit,
  schema: z.ZodSchema<T>,
): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, { ...init, signal: ac.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new PythonContextError(
        res.status,
        `Python ${init.method ?? "GET"} ${path} failed: ${res.status} ${body.slice(0, 300)}`,
      );
    }
    const json = await res.json();
    return schema.parse(json);
  } finally {
    clearTimeout(timer);
  }
}

export async function searchCorpus(input: SearchInput): Promise<SearchResponse> {
  return call(
    "/search",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: input.query,
        since: input.since ?? null,
        until: input.until ?? null,
        sources: input.sources ?? null,
        entities: input.entities ?? null,
        k: input.k ?? 10,
        workspace_id: input.workspaceId ?? process.env.WORKSPACE_ID ?? null,
      }),
    },
    SearchResponseSchema,
  );
}

export async function getSummary(args: {
  entityType?: string;
  entityId?: string;
  window?: "day" | "week" | "sprint" | "quarter";
  layer?: 1 | 2 | 3;
  workspaceId?: string;
}): Promise<SummaryResponse> {
  const qs = new URLSearchParams();
  if (args.entityType) qs.set("entity_type", args.entityType);
  if (args.entityId) qs.set("entity_id", args.entityId);
  if (args.window) qs.set("window", args.window);
  if (args.layer) qs.set("layer", String(args.layer));
  const ws = args.workspaceId ?? process.env.WORKSPACE_ID;
  if (ws) qs.set("workspace_id", ws);
  return call(`/summary?${qs.toString()}`, { method: "GET" }, SummaryResponseSchema);
}

export async function getDoc(docId: string, anchor?: string): Promise<DocResponse> {
  const qs = anchor ? `?anchor=${encodeURIComponent(anchor)}` : "";
  return call(`/doc/${encodeURIComponent(docId)}${qs}`, { method: "GET" }, DocResponseSchema);
}

export async function getFreshness(): Promise<FreshnessMap> {
  return call("/freshness", { method: "GET" }, FreshnessMapSchema);
}

export async function pythonHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/healthz`);
    return res.ok;
  } catch {
    return false;
  }
}

export { PythonContextError };
