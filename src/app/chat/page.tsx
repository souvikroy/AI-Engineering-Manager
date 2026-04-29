"use client";

import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, Sparkles, MessageSquare, Loader2 } from "lucide-react";

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  { icon: "🎯", text: "What's the biggest sprint risk this week and why?" },
  { icon: "🧠", text: "Which engineers are stuck or showing burnout signals?" },
  { icon: "📊", text: "Summarize OKR progress and the two riskiest items." },
  { icon: "🚨", text: "Anything I should escalate before the leadership sync?" },
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
      setMessages((m) => [...m, { role: "assistant", content: `_Error: ${(e as Error).message}_` }]);
    } finally {
      setStreaming(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] animate-fade-in">
      <header className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10.5px] uppercase tracking-[0.2em] text-ink-faint font-medium">Copilot</span>
          <span className="w-1 h-1 rounded-full bg-ink-ghost" />
          <span className="text-[10.5px] text-ink-faint">grounded on the latest brief, OKRs, incidents</span>
        </div>
        <h1 className="text-[28px] font-semibold tracking-tight">Ask anything.</h1>
      </header>

      <div className="flex-1 overflow-y-auto -mx-2 px-2 pb-4">
        {messages.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-w-2xl">
            {SUGGESTIONS.map((s) => (
              <button
                key={s.text}
                onClick={() => send(s.text)}
                className="group text-left p-4 rounded-xl border border-border bg-surface hover:bg-surface-hover hover:border-border-strong transition-all"
              >
                <div className="flex items-start gap-3">
                  <span className="text-[18px] leading-none mt-0.5">{s.icon}</span>
                  <span className="text-[13px] text-ink-dim group-hover:text-ink leading-snug">{s.text}</span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-4 max-w-3xl mx-auto">
            {messages.map((m, i) => (
              <div key={i} className={`animate-slide-up ${m.role === "user" ? "ml-12" : "mr-12"}`}>
                <div className="flex items-center gap-2 mb-1.5">
                  {m.role === "user" ? (
                    <div className="w-5 h-5 rounded-full bg-gradient-to-br from-accent/50 to-accent/20 flex items-center justify-center text-[9px] font-semibold">CEO</div>
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-gradient-to-br from-accent to-accent/50 flex items-center justify-center">
                      <Sparkles className="w-2.5 h-2.5 text-bg" strokeWidth={2.5} />
                    </div>
                  )}
                  <span className="text-[11px] text-ink-faint font-medium">
                    {m.role === "user" ? "You" : "AI EM Copilot"}
                  </span>
                </div>
                <div className={`rounded-xl border px-4 py-3 ${
                  m.role === "user"
                    ? "bg-accent/[0.06] border-accent/[0.18]"
                    : "bg-surface border-border"
                }`}>
                  <div className="prose-thin">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content || (streaming && i === messages.length - 1 ? "…" : "")}</ReactMarkdown>
                  </div>
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="sticky bottom-4 max-w-3xl w-full mx-auto"
      >
        <div className="rounded-2xl border border-border-strong bg-bg-elevated/95 backdrop-blur-xl shadow-2xl p-2">
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
            className="w-full bg-transparent resize-none text-[14px] px-3 py-2 placeholder:text-ink-ghost focus:outline-none"
            disabled={streaming}
          />
          <div className="flex items-center justify-between px-2 pt-1">
            <div className="flex items-center gap-1.5 text-[10.5px] text-ink-faint">
              <MessageSquare className="w-3 h-3" />
              <span>Enter to send · Shift+Enter for newline</span>
            </div>
            <button
              type="submit"
              disabled={streaming || !input.trim()}
              className="w-8 h-8 rounded-lg bg-accent hover:bg-accent/90 text-bg flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-95"
            >
              {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" strokeWidth={2.5} />}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
