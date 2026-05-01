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
import { verdictFooter, verifyAnswer } from "@/lib/chat/verify";
import { getFreshness, pythonHealth, type Citation } from "@/lib/python";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_TURNS = 6;

const PERSONA = `You are CTO Brain, an engineering-management copilot for a CEO.
Be direct, specific, and quantitative. Cite sources every time you reference a fact: \
use the source URL or id from a tool result, formatted as [source-id]. Never invent \
data. If a tool returns nothing, say so and propose a different tool to call.

When asked about people, fetch their profile (get_engineer_profile) before searching.
When asked about tickets, prefer get_ticket over search.
When asked about Slack discussions, prefer search_slack.
When asked about a known entity (engineer/team/service/sprint), prefer get_entity_summary.
When asked about a design doc or RFC, search_corpus first, then get_doc on the top hit.

Always end with a one-line "Sources & freshness" footer summarizing which sources you used and how fresh.`;

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

  // Heads-up footer when Python isn't reachable — the chat still runs via local tools.
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
      try {
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
                controller.enqueue(encoder.encode(event.delta.text));
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
            } catch (err) {
              toolResults.push({
                type: "tool_result",
                tool_use_id: tu.id,
                content: JSON.stringify({ error: (err as Error).message }),
                is_error: true,
              });
            }
          }
          turns.push({ role: "user", content: toolResults });
        }

        // Provenance verifier (Haiku) → footer if anything looks unsupported.
        const verdict = await verifyAnswer(finalAnswerText, allCitations);
        const verifyLine = verdictFooter(verdict);
        if (verifyLine) controller.enqueue(encoder.encode("\n\n" + verifyLine));

        // Citations + freshness footer
        const footer = renderFooter(allCitations, freshnessLine);
        if (footer) controller.enqueue(encoder.encode("\n\n" + footer));
        controller.close();
      } catch (err) {
        controller.enqueue(
          encoder.encode(`\n\n[chat error: ${(err as Error).message}]`),
        );
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
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

function renderFooter(citations: Citation[], freshness: string): string {
  if (citations.length === 0 && !freshness) return "";
  const lines: string[] = [];
  if (citations.length > 0) {
    const dedup = new Map<string, Citation>();
    for (const c of citations) {
      const k = `${c.kind}:${c.id}`;
      if (!dedup.has(k)) dedup.set(k, c);
    }
    const top = Array.from(dedup.values()).slice(0, 8);
    const list = top
      .map((c) =>
        c.url ? `[${c.kind}/${c.id}](${c.url})` : `${c.kind}/${c.id}`,
      )
      .join(" · ");
    lines.push(`_Sources: ${list}_`);
  }
  if (freshness) lines.push(`_${freshness}_`);
  return lines.join("\n");
}
