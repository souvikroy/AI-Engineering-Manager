"use client";

import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, Loader2, Target, Brain, BarChart3, Siren } from "lucide-react";
import { Kbd } from "@/components/Card";
import { BrandMark, MascotHero } from "@/components/BrandLogo";
import { StatusPill, type StatusPillState } from "@/components/StatusPill";
import { ArtifactPanel } from "@/components/ArtifactPanel";
import type { ArtifactPayload, ChatEvent } from "@/lib/chat/events";
import type { Citation } from "@/lib/python";

type Verdict = "ok" | "weak" | "unsupported" | "skip";

type Msg = {
  role: "user" | "assistant";
  content: string;
  pills?: StatusPillState[];
  artifactId?: string | null;
  citations?: Citation[];
  verdict?: Verdict;
};

export type ChatArtifact = ArtifactPayload & { id: string; citations: Citation[] };

const SUGGESTIONS = [
  {
    icon: <Target className="w-4 h-4" />,
    title: "Sprint risk this week",
    text: "What's the biggest sprint risk this week and why?",
  },
  {
    icon: <Brain className="w-4 h-4" />,
    title: "Burnout signals",
    text: "Which engineers are stuck or showing burnout signals?",
  },
  {
    icon: <BarChart3 className="w-4 h-4" />,
    title: "OKR progress",
    text: "Summarize OKR progress and the two riskiest items.",
  },
  {
    icon: <Siren className="w-4 h-4" />,
    title: "Pre-leadership escalations",
    text: "Anything I should escalate before the leadership sync?",
  },
];

function artifactLabel(a: ChatArtifact): string {
  if (a.kind === "doc") return `Open report — ${a.payload.title}`;
  if (a.kind === "leaderboard") return `Open leaderboard — ${a.payload.title}`;
  return `Open code review — PR #${a.payload.pr_number}`;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [artifacts, setArtifacts] = useState<Record<string, ChatArtifact>>({});
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  function applyEvent(ev: ChatEvent) {
    setMessages((m) => {
      const copy = [...m];
      const last = copy[copy.length - 1];
      if (!last || last.role !== "assistant") return m;

      switch (ev.type) {
        case "text":
          copy[copy.length - 1] = { ...last, content: last.content + ev.delta };
          return copy;
        case "tool_status": {
          const pills = [...(last.pills ?? [])];
          if (ev.phase === "start") {
            pills.push({
              tool: ev.tool,
              phase: "running",
              input_summary: ev.input_summary,
            });
          } else {
            // mark the most recent matching running pill as done
            for (let i = pills.length - 1; i >= 0; i--) {
              if (pills[i].tool === ev.tool && pills[i].phase === "running") {
                pills[i] = {
                  ...pills[i],
                  phase: ev.error ? "error" : "done",
                  duration_ms: ev.duration_ms,
                  error: ev.error,
                };
                break;
              }
            }
          }
          copy[copy.length - 1] = { ...last, pills };
          return copy;
        }
        case "artifact": {
          const { type: _t, id, citations, ...artifact } = ev;
          void _t;
          setArtifacts((prev) => ({
            ...prev,
            [id]: { ...(artifact as ArtifactPayload), id, citations },
          }));
          setSelectedArtifactId(id);
          copy[copy.length - 1] = { ...last, artifactId: id };
          return copy;
        }
        case "done":
          copy[copy.length - 1] = {
            ...last,
            verdict: ev.verdict,
            citations: ev.citations,
          };
          return copy;
        case "error":
          copy[copy.length - 1] = {
            ...last,
            content: last.content + `\n\n_Error: ${ev.message}_`,
          };
          return copy;
        default:
          return m;
      }
    });
  }

  async function send(text: string) {
    if (!text.trim() || streaming) return;
    const userMsg: Msg = { role: "user", content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setStreaming(true);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
        signal: ac.signal,
      });
      if (!res.body) throw new Error("No stream body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      setMessages((m) => [...m, { role: "assistant", content: "", pills: [] }]);
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl = buffer.indexOf("\n");
        while (nl !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line) {
            try {
              applyEvent(JSON.parse(line) as ChatEvent);
            } catch {
              // tolerate the occasional partial / malformed line
            }
          }
          nl = buffer.indexOf("\n");
        }
      }
      // flush any trailing line
      const tail = buffer.trim();
      if (tail) {
        try {
          applyEvent(JSON.parse(tail) as ChatEvent);
        } catch {
          // ignore
        }
      }
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `_Error: ${(e as Error).message}_` },
      ]);
    } finally {
      setStreaming(false);
      inputRef.current?.focus();
    }
  }

  const activeArtifact =
    selectedArtifactId && artifacts[selectedArtifactId]
      ? artifacts[selectedArtifactId]
      : null;

  return (
    <div className="flex h-screen animate-fade-in gap-0">
      <div
        className={`flex flex-col h-full overflow-hidden transition-all duration-300 ${
          activeArtifact ? "w-1/2 min-w-[420px] px-6 py-6" : "w-full max-w-4xl mx-auto px-8 py-8"
        }`}
      >
      {messages.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center pb-24">
          {/* Hero */}
          <div className="text-center max-w-2xl mx-auto mb-10 animate-rise">
            <div className="inline-flex relative mb-6">
              <MascotHero size={140} />
              <div className="absolute inset-0 blur-3xl opacity-40 -z-10 bg-accent" />
            </div>
            <h1 className="text-[40px] font-semibold tracking-display leading-[1.05] mb-3 text-balance">
              <span className="text-gradient-ink">What's on your mind,</span>
              <br />
              <span className="text-gradient-accent">Souvik?</span>
            </h1>
            <p className="text-[14px] text-ink-dim max-w-md mx-auto text-pretty">
              Grounded on the latest brief, OKRs, incidents, and 1:1 history.
              Ask anything an EM would.
            </p>
          </div>

          {/* Suggestions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-w-2xl w-full">
            {SUGGESTIONS.map((s, i) => (
              <button
                key={s.text}
                onClick={() => send(s.text)}
                style={{ animationDelay: `${i * 60}ms` }}
                className="group relative text-left p-4 rounded-xl border border-border bg-surface hover:bg-surface-hover hover:border-accent/30 transition-all hairline animate-rise"
              >
                <div className="flex items-start gap-3">
                  <div className="shrink-0 w-8 h-8 rounded-lg bg-bg-elevated/80 ring-1 ring-inset ring-white/[0.06] flex items-center justify-center text-ink-dim group-hover:text-accent group-hover:ring-accent/30 transition-colors">
                    {s.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-medium text-ink mb-0.5 tracking-tight2">
                      {s.title}
                    </div>
                    <div className="text-[12px] text-ink-faint leading-snug">
                      {s.text}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <header className="mb-6">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] uppercase tracking-kicker text-ink-faint font-semibold">
                Copilot
              </span>
              <span className="w-1 h-1 rounded-full bg-ink-ghost" />
              <span className="text-[11px] text-ink-faint">
                grounded on brief, OKRs, incidents
              </span>
            </div>
            <h1 className="text-[26px] font-semibold tracking-tight2">
              Ask anything.
            </h1>
          </header>

          <div className="flex-1 overflow-y-auto -mx-2 px-2 pb-4">
            <div className="space-y-5 max-w-3xl mx-auto">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`animate-slide-up ${
                    m.role === "user" ? "ml-12" : "mr-12"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    {m.role === "user" ? (
                      <div className="w-5 h-5 rounded-full bg-accent-gradient flex items-center justify-center text-[9px] font-semibold text-bg-deep">
                        SR
                      </div>
                    ) : (
                      <BrandMark size={20} glow={false} />
                    )}
                    <span className="text-[11px] text-ink-faint font-medium">
                      {m.role === "user" ? "You" : "CTO Brain"}
                    </span>
                  </div>
                  <div
                    className={`rounded-2xl border px-4 py-3 ${
                      m.role === "user"
                        ? "bg-accent/[0.06] border-accent/[0.18]"
                        : "bg-surface border-border hairline"
                    }`}
                  >
                    {m.pills && m.pills.length > 0 ? (
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {m.pills.map((p, j) => (
                          <StatusPill key={j} state={p} />
                        ))}
                      </div>
                    ) : null}
                    <div className="prose-thin">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {m.content ||
                          (streaming && i === messages.length - 1 ? "…" : "")}
                      </ReactMarkdown>
                    </div>
                    {m.artifactId && artifacts[m.artifactId] ? (
                      <button
                        onClick={() => setSelectedArtifactId(m.artifactId!)}
                        className="mt-3 inline-flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/[0.06] px-3 py-1.5 text-[11.5px] font-medium text-accent hover:bg-accent/[0.10] transition-colors"
                      >
                        <span>
                          {artifactLabel(artifacts[m.artifactId]!)}
                        </span>
                        <span className="text-ink-faint">→</span>
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
          </div>
        </>
      )}

      {/* Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="sticky bottom-4 max-w-3xl w-full mx-auto"
      >
        <div className="relative gradient-border rounded-2xl bg-bg-elevated/95 backdrop-blur-xl shadow-soft-lift p-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Ask about the engineering org…"
            rows={1}
            className="w-full bg-transparent resize-none text-[14px] px-3 py-2.5 placeholder:text-ink-ghost focus:outline-none"
            disabled={streaming}
          />
          <div className="flex items-center justify-between px-2 pt-1">
            <div className="flex items-center gap-2 text-[10.5px] text-ink-faint">
              <Kbd>↵</Kbd>
              <span>send</span>
              <span className="text-ink-ghost">·</span>
              <Kbd>⇧</Kbd>
              <Kbd>↵</Kbd>
              <span>newline</span>
            </div>
            <button
              type="submit"
              disabled={streaming || !input.trim()}
              className="w-8 h-8 rounded-lg bg-ink hover:bg-white text-bg-deep flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-95"
            >
              {streaming ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ArrowUp className="w-4 h-4" strokeWidth={2.6} />
              )}
            </button>
          </div>
        </div>
      </form>
      </div>
      {activeArtifact ? (
        <div className="flex-1 h-full">
          <ArtifactPanel
            artifact={activeArtifact}
            onClose={() => setSelectedArtifactId(null)}
          />
        </div>
      ) : null}
    </div>
  );
}
