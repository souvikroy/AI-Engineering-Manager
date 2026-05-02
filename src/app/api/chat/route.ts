/**
 * Chat — Anthropic tool-use loop.
 *
 * Replaces the previous "JSON.stringify everything into the system prompt"
 * approach. The model is given ~10 tools (RAG-backed Python proxies + local
 * Prisma + live adapters). It composes answers by calling the tools it needs.
 *
 * Budgets:
 *   - max 6 tool turns per query
 *   - per-tool result is already truncated by tools.ts
 *   - the streaming Final response is whatever the model emits
 *
 * Provenance:
 *   - every tool result includes citations
 *   - the system prompt instructs the model to inline source markers
 *   - we surface a freshness footer in the streamed response so the user
 *     can see how stale each source is
 */
import Anthropic from "@anthropic-ai/sdk";
import { resolveModel } from "@/lib/anthropic";
import { TOOL_DEFS, executeTool } from "@/lib/chat/tools";
import { verifyAnswer } from "@/lib/chat/verify";
import { getFreshness, pythonHealth, type Citation } from "@/lib/python";
import type { ChatEvent } from "@/lib/chat/events";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_TURNS = 6;

const PERSONA = `You are CTO Brain, an engineering-management copilot for a CEO.
Be direct, specific, and quantitative. Cite sources every time you reference a fact: \
use the source URL or id from a tool result, formatted as [source-id]. Never invent \
data. If a tool returns nothing, say so and propose a different tool to call.

The UI renders artifacts in a side panel. When the user asks for any of the
following, call the matching produce_* tool — do NOT inline-summarize the result
in chat text since the artifact carries the full content:
  - "report", "summary", "brief", "sprint health", "incident review",
    "OKR status", "postmortem", "standup digest"  → produce_doc(topic=…)
  - "leaderboard", "ranking", "performance", "who's shipping the most" → produce_leaderboard
  - "review the PR", "code review", "review pull request"               → produce_code_review

Routing rules for non-artifact tools:
  - When asked about people, fetch get_engineer_profile before searching.
  - When asked about a specific ticket, prefer get_ticket over search.
  - When asked about Slack discussions, prefer search_slack.
  - When asked what someone said in standup, use search_standups.
  - When asked about a known entity (engineer/team/service/sprint), prefer get_entity_summary.

After calling a produce_* tool, write 1–2 sentences in chat introducing the
artifact ("I've put together a sprint health report — top three risks are…").
Don't repeat the artifact's full body. End with a one-line "Sources & freshness" footer.`;

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  return new Anthropic({ apiKey });
}

type Msg = { role: "user" | "assistant"; content: string };

export async function POST(req: Request) {
  const { messages } = (await req.json()) as { messages: Msg[] };
  const client = getClient();
  const model = resolveModel("reasoning");

  // Convert chat messages to Anthropic content blocks.
  const turns: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Tool-use loop, collecting citations + accumulating the final answer text.
  const allCitations: Citation[] = [];
  let finalAnswerText = "";
  let turnsLeft = MAX_TURNS;
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const emit = (event: ChatEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      try {
        // Heads-up footer when Python isn't reachable. Run inside the stream
        // so the browser receives Response headers immediately rather than
        // waiting on the health check + freshness query.
        const pythonUp = await pythonHealth();
        let freshnessLine = "";
        if (pythonUp) {
          try {
            const f = await getFreshness();
            const parts = Object.entries(f.sources)
              .filter(([, age]) => age != null)
              .sort((a, b) => (a[1] as number) - (b[1] as number))
              .slice(0, 4)
              .map(([src, age]) => `${src} ${formatAge(age as number)}`);
            if (parts.length > 0) freshnessLine = `Source freshness: ${parts.join(" · ")}.`;
          } catch {
            // ignore
          }
        } else {
          freshnessLine =
            "Note: context engine offline — answers limited to local Prisma + live adapters.";
        }

        const systemBlocks = [
          { type: "text" as const, text: PERSONA },
          {
            type: "text" as const,
            // Cache breakpoint after the persona — persona changes ~never;
            // freshness footer is volatile and lands after the breakpoint.
            text: freshnessLine,
            cache_control: { type: "ephemeral" as const },
          },
        ];

        let finalAssistantStream = false;
        while (turnsLeft-- > 0) {
          const pendingToolUse = lastPendingToolUses(turns);
          if (pendingToolUse.length === 0 && !finalAssistantStream) {
            finalAssistantStream = true;
            const stream = await client.messages.stream({
              model,
              system: systemBlocks,
              tools: TOOL_DEFS as unknown as Anthropic.Tool[],
              max_tokens: 1500,
              temperature: 0.4,
              messages: turns,
            });
            let needsAnotherRound = false;
            for await (const event of stream) {
              if (
                event.type === "content_block_delta" &&
                event.delta.type === "text_delta"
              ) {
                emit({ type: "text", delta: event.delta.text });
                finalAnswerText += event.delta.text;
              } else if (event.type === "message_stop") {
                const final = await stream.finalMessage();
                turns.push({ role: "assistant", content: final.content });
                if (final.stop_reason === "tool_use") {
                  needsAnotherRound = true;
                  finalAssistantStream = false;
                  // model issued more tool calls — wipe the accumulated text
                  // so we only verify the truly final assistant message.
                  finalAnswerText = "";
                }
              }
            }
            if (!needsAnotherRound) break;
            continue;
          }

          // Resolve pending tool_use blocks → tool_result content
          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const tu of pendingToolUse) {
            const inputSummary = summarizeToolInput(tu.input);
            emit({
              type: "tool_status",
              tool: tu.name,
              phase: "start",
              input_summary: inputSummary,
            });
            const t0 = Date.now();
            try {
              const out = await executeTool(
                tu.name,
                (tu.input as Record<string, unknown>) ?? {},
              );
              allCitations.push(...out.citations);
              toolResults.push({
                type: "tool_result",
                tool_use_id: tu.id,
                content: out.content,
              });
              emit({
                type: "tool_status",
                tool: tu.name,
                phase: "end",
                duration_ms: Date.now() - t0,
              });
              if (out.artifact) {
                emit({
                  type: "artifact",
                  id: tu.id,
                  citations: out.citations,
                  ...out.artifact,
                });
              }
            } catch (err) {
              const message = (err as Error).message;
              toolResults.push({
                type: "tool_result",
                tool_use_id: tu.id,
                content: JSON.stringify({ error: message }),
                is_error: true,
              });
              emit({
                type: "tool_status",
                tool: tu.name,
                phase: "end",
                duration_ms: Date.now() - t0,
                error: message,
              });
            }
          }
          turns.push({ role: "user", content: toolResults });
        }

        // Provenance verifier (Haiku) — verdict drops into the done event.
        const verdict = await verifyAnswer(finalAnswerText, allCitations);
        const dedupCitations = dedupeCitations(allCitations);

        emit({
          type: "done",
          verdict: verdict.verdict,
          citations: dedupCitations,
          freshness: freshnessLine || undefined,
        });
        controller.close();
      } catch (err) {
        emit({ type: "error", message: (err as Error).message });
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

function summarizeToolInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;
  // Surface the most useful single field for the status pill.
  const candidate =
    obj.query ?? obj.engineer_id ?? obj.entity_id ?? obj.key ?? obj.doc_id ?? obj.topic ?? obj.pr_number;
  if (candidate == null) return "";
  const s = String(candidate);
  return s.length > 60 ? s.slice(0, 57) + "…" : s;
}

function dedupeCitations(citations: Citation[]): Citation[] {
  const dedup = new Map<string, Citation>();
  for (const c of citations) {
    const k = `${c.kind}:${c.id}`;
    if (!dedup.has(k)) dedup.set(k, c);
  }
  return Array.from(dedup.values()).slice(0, 12);
}

function lastPendingToolUses(
  turns: Anthropic.MessageParam[],
): Anthropic.ToolUseBlock[] {
  const last = turns[turns.length - 1];
  if (!last || last.role !== "assistant" || typeof last.content === "string") return [];
  return last.content.filter(
    (c): c is Anthropic.ToolUseBlock => c.type === "tool_use",
  );
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

