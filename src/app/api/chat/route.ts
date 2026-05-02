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
import type { ChatEvent, ArtifactPayload } from "@/lib/chat/events";
import type { StatusPillState } from "@/components/StatusPill";
import type { StoredMsg, ChatArtifact } from "@/lib/chat/store";
import { prisma } from "@/lib/prisma";
import { autoTitle, fallbackTitle } from "@/lib/chat/title";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_TURNS = 6;

const PERSONA_BASE = `You are CTO Brain, an engineering-management copilot for a CEO.
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

/**
 * Build the time-sensitive part of the system prompt. Rebuilt per request so
 * the model always sees the current clock + a precise rolling-24h window for
 * "today". Tool calls are then expected to scope `since`/`until` to this
 * window when the user asks about today / latest / current state.
 */
function buildFreshnessContext(): string {
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const local = (d: Date) =>
    d.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hour12: false,
    });
  return `## Time and freshness context

Right now (server local clock): **${local(now)}**.
"Today" / "latest" / "what's new" → rolling 24h window:
  since = ${since.toISOString()}
  until = ${now.toISOString()}
"This week" → past 7 days:
  since = ${lastWeek.toISOString()}
  until = ${now.toISOString()}

When the user uses time-relative phrasing — "today", "yesterday", "latest",
"what's new", "since this morning", "anything fresh" — pass these timestamps
to the matching tool's \`since\` / \`until\` parameters so retrieval is scoped
to the right window. Do NOT scope when the user asks an open-ended question
(e.g. "describe the sprint") that doesn't reference time.

Quantify staleness in your final answer when relevant: prefer "from a Jira
update 4 minutes ago" over "from Jira". If a tool returns data older than
24h while the user asked about today, say so explicitly.`;
}

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  return new Anthropic({ apiKey });
}

type Msg = { role: "user" | "assistant"; content: string };
type ChatRequestBody = { messages: Msg[]; session_id?: string | null };

export async function POST(req: Request) {
  const { messages, session_id } = (await req.json()) as ChatRequestBody;
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
  // Persistence-side: track the last user message + the assistant pills,
  // sources_checked, and any artifact emitted, so we can write to DB at end.
  const lastUserText =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const assistantPills: StatusPillState[] = [];
  const sourcesChecked = new Set<string>();
  let assistantArtifact: ChatArtifact | null = null;
  const readable = new ReadableStream({
    async start(controller) {
      const emit = (event: ChatEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      // ── Resolve session id (create on first turn) ──────────────────
      let sessionId = session_id ?? null;
      const isNewSession = !sessionId;
      if (isNewSession) {
        const provisionalTitle = fallbackTitle(lastUserText) || "New chat";
        const created = await prisma.chatSession.create({
          data: { title: provisionalTitle, messages: JSON.stringify([]) },
        });
        sessionId = created.id;
      }
      emit({ type: "session", id: sessionId! });
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
          { type: "text" as const, text: PERSONA_BASE },
          {
            type: "text" as const,
            // Cache breakpoint after the static persona — persona changes ~never.
            // Below this point everything is volatile (clock + freshness footer)
            // and recomputed per request so "today" stays accurate.
            text: `${buildFreshnessContext()}\n\n${freshnessLine}`,
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
            assistantPills.push({
              tool: tu.name,
              phase: "running",
              input_summary: inputSummary,
            });
            // Track which sources the model checked (for trust signals).
            recordSourcesChecked(tu.name, tu.input, sourcesChecked);
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
              const dur = Date.now() - t0;
              emit({
                type: "tool_status",
                tool: tu.name,
                phase: "end",
                duration_ms: dur,
              });
              // Update the matching running pill in the persisted snapshot.
              const idx = lastRunningIndex(assistantPills, tu.name);
              if (idx >= 0) {
                assistantPills[idx] = {
                  ...assistantPills[idx],
                  phase: "done",
                  duration_ms: dur,
                };
              }
              if (out.artifact) {
                emit({
                  type: "artifact",
                  id: tu.id,
                  citations: out.citations,
                  ...out.artifact,
                });
                assistantArtifact = {
                  id: tu.id,
                  citations: out.citations,
                  ...(out.artifact as ArtifactPayload),
                };
              }
            } catch (err) {
              const message = (err as Error).message;
              toolResults.push({
                type: "tool_result",
                tool_use_id: tu.id,
                content: JSON.stringify({ error: message }),
                is_error: true,
              });
              const dur = Date.now() - t0;
              emit({
                type: "tool_status",
                tool: tu.name,
                phase: "end",
                duration_ms: dur,
                error: message,
              });
              const idx = lastRunningIndex(assistantPills, tu.name);
              if (idx >= 0) {
                assistantPills[idx] = {
                  ...assistantPills[idx],
                  phase: "error",
                  duration_ms: dur,
                  error: message,
                };
              }
            }
          }
          turns.push({ role: "user", content: toolResults });
        }

        // Provenance verifier (Haiku) — verdict drops into the done event.
        const verdict = await verifyAnswer(finalAnswerText, allCitations);
        const dedupCitations = dedupeCitations(allCitations);
        const sourcesCheckedArr = Array.from(sourcesChecked);

        emit({
          type: "done",
          verdict: verdict.verdict,
          citations: dedupCitations,
          freshness: freshnessLine || undefined,
          sources_checked: sourcesCheckedArr,
          unsupported_claims: verdict.unsupported_claims,
        });

        // ── Persist to DB (don't block stream close on this) ─────────
        await persistTurn(sessionId!, {
          isNewSession,
          userMessage: lastUserText,
          assistantText: finalAnswerText,
          pills: assistantPills,
          citations: dedupCitations,
          verdict: verdict.verdict,
          sourcesChecked: sourcesCheckedArr,
          freshness: freshnessLine || undefined,
          artifact: assistantArtifact,
        }).catch((e) => {
          console.warn("[chat] persist failed:", (e as Error).message);
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

// Map a tool call to the source kinds it touched. Surfaces in the
// trust-signal "Sources checked" chip row.
function recordSourcesChecked(
  toolName: string,
  input: unknown,
  sink: Set<string>,
): void {
  const i = (input ?? {}) as Record<string, unknown>;
  switch (toolName) {
    case "search_corpus": {
      const sources = Array.isArray(i.sources) ? (i.sources as string[]) : null;
      if (sources && sources.length > 0) {
        for (const s of sources) sink.add(s);
      } else {
        // search_corpus with no sources arg = "all"; record nothing specific.
        sink.add("rag");
      }
      return;
    }
    case "search_slack":
      sink.add("slack");
      return;
    case "search_standups":
      sink.add("standup");
      return;
    case "get_doc":
    case "get_entity_summary":
      sink.add("rag");
      return;
    case "get_engineer_profile":
      sink.add("prisma");
      return;
    case "get_okr_status":
      sink.add("prisma");
      return;
    case "list_incidents":
      sink.add("sentry");
      return;
    case "get_ticket":
      sink.add("jira");
      return;
    case "produce_doc":
      sink.add("prisma");
      sink.add("jira");
      sink.add("sentry");
      return;
    case "produce_leaderboard":
      sink.add("jira");
      sink.add("github");
      sink.add("sentry");
      sink.add("standup");
      return;
    case "produce_code_review":
      sink.add("github");
      return;
  }
}

function lastRunningIndex(pills: StatusPillState[], tool: string): number {
  for (let i = pills.length - 1; i >= 0; i--) {
    if (pills[i].tool === tool && pills[i].phase === "running") return i;
  }
  return -1;
}

type PersistTurnArgs = {
  isNewSession: boolean;
  userMessage: string; // latest user turn (the one this assistant turn is replying to)
  assistantText: string;
  pills: StatusPillState[];
  citations: Citation[];
  verdict?: "ok" | "weak" | "unsupported" | "skip";
  sourcesChecked: string[];
  freshness?: string;
  artifact: ChatArtifact | null;
};

async function persistTurn(
  sessionId: string,
  args: PersistTurnArgs,
): Promise<void> {
  const row = await prisma.chatSession.findUnique({ where: { id: sessionId } });
  if (!row) return;
  // The DB column is JSON-as-string; parse defensively.
  let payload: { messages: StoredMsg[]; artifacts: Record<string, ChatArtifact> };
  try {
    const p = JSON.parse(row.messages) as Partial<{
      messages: StoredMsg[];
      artifacts: Record<string, ChatArtifact>;
    }>;
    payload = {
      messages: Array.isArray(p.messages) ? p.messages : [],
      artifacts:
        p.artifacts && typeof p.artifacts === "object" ? p.artifacts : {},
    };
  } catch {
    payload = { messages: [], artifacts: {} };
  }

  // Append the new user + assistant pair from this turn.
  if (args.userMessage) {
    payload.messages.push({ role: "user", content: args.userMessage });
  }
  payload.messages.push({
    role: "assistant",
    content: args.assistantText,
    pills: args.pills,
    citations: args.citations,
    verdict: args.verdict,
    sources_checked: args.sourcesChecked,
    freshness: args.freshness,
    artifact_id: args.artifact?.id ?? null,
  });
  if (args.artifact) {
    payload.artifacts[args.artifact.id] = args.artifact;
  }

  // Title: only generate via Haiku on the FIRST turn of a new session.
  let nextTitle: string | undefined;
  if (args.isNewSession && args.userMessage) {
    nextTitle = await autoTitle(args.userMessage);
  }

  await prisma.chatSession.update({
    where: { id: sessionId },
    data: {
      messages: JSON.stringify(payload),
      ...(nextTitle ? { title: nextTitle } : {}),
    },
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

