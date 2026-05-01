"use client";

import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, Loader2, Target, Brain, BarChart3, Siren } from "lucide-react";
import { Kbd } from "@/components/Card";
import { BrandMark } from "@/components/BrandLogo";

type Msg = { role: "user" | "assistant"; content: string };

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

export default function ChatPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

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
      let acc = "";
      setMessages((m) => [...m, { role: "assistant", content: "" }]);
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: acc };
          return copy;
        });
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

  return (
    <div className="flex flex-col h-[calc(100vh-96px)] animate-fade-in">
      {messages.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center pb-24">
          {/* Hero */}
          <div className="text-center max-w-2xl mx-auto mb-10 animate-rise">
            <div className="inline-flex relative mb-6">
              <BrandMark size={56} />
              <div className="absolute inset-0 blur-2xl opacity-30 -z-10 bg-[#d9f871]" />
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
                    <div className="prose-thin">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {m.content ||
                          (streaming && i === messages.length - 1 ? "…" : "")}
                      </ReactMarkdown>
                    </div>
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
  );
}
