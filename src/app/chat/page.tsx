"use client";

import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, Loader2, Target, Brain, BarChart3, Siren, Square } from "lucide-react";
import { Kbd } from "@/components/Card";
import { BrandMark, MascotHero } from "@/components/BrandLogo";
import { StatusPill } from "@/components/StatusPill";
import { ArtifactPanel } from "@/components/ArtifactPanel";
import { ChatHistorySidebar } from "@/components/ChatHistorySidebar";
import { SourceChips, CitationChip } from "@/components/SourceChips";
import { VerdictBadge } from "@/components/VerdictBadge";
import { useChatStore, type ChatArtifact, type StoredMsg } from "@/lib/chat/store";

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
  const messages = useChatStore((s) => s.messages);
  const artifacts = useChatStore((s) => s.artifacts);
  const selectedArtifactId = useChatStore((s) => s.selectedArtifactId);
  const setSelectedArtifact = useChatStore((s) => s.setSelectedArtifact);
  const streaming = useChatStore((s) => s.streaming);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const abortStreaming = useChatStore((s) => s.abortStreaming);
  const activeSessionId = useChatStore((s) => s.activeSessionId);

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputValueRef = useRef<string>("");

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [activeSessionId]);

  async function send(text: string) {
    if (!text.trim() || streaming) return;
    inputValueRef.current = "";
    if (inputRef.current) inputRef.current.value = "";
    await sendMessage(text);
  }

  const activeArtifact: ChatArtifact | null =
    selectedArtifactId && artifacts[selectedArtifactId]
      ? artifacts[selectedArtifactId]
      : null;

  const showHero = messages.length === 0;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg">
      <ChatHistorySidebar />

      <div
        className={`flex flex-col h-full overflow-hidden transition-all duration-300 ${
          activeArtifact ? "flex-1 min-w-[420px]" : "flex-1"
        }`}
      >
        {showHero ? (
          <HeroPane onPick={(text) => void send(text)} />
        ) : (
          <ChatThread messages={messages} streaming={streaming} artifacts={artifacts} onOpenArtifact={setSelectedArtifact} endRef={endRef} />
        )}

        <Composer
          inputRef={inputRef}
          inputValueRef={inputValueRef}
          streaming={streaming}
          onSend={send}
          onAbort={abortStreaming}
        />
      </div>

      {activeArtifact ? (
        <div className="w-1/2 min-w-[420px] max-w-[820px] h-full">
          <ArtifactPanel
            artifact={activeArtifact}
            onClose={() => setSelectedArtifact(null)}
          />
        </div>
      ) : null}
    </div>
  );
}

function HeroPane({ onPick }: { onPick: (text: string) => void }) {
  const greeting = greetingForNow(new Date());
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex flex-col items-center justify-center min-h-full px-8 py-16 max-w-3xl mx-auto">
        <div className="text-center mb-10 animate-rise">
          <div className="inline-flex relative mb-6">
            <MascotHero size={120} />
            <div className="absolute inset-0 blur-3xl opacity-40 -z-10 bg-accent" />
          </div>
          <h1 className="text-[36px] font-semibold tracking-display leading-[1.05] mb-3 text-balance">
            <span className="text-gradient-ink">{greeting},</span>{" "}
            <span className="text-gradient-accent">Souvik</span>
          </h1>
          <p className="text-[14px] text-ink-dim max-w-md mx-auto text-pretty">
            Grounded on the latest brief, OKRs, incidents, and standup history. Ask anything an EM would.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 w-full max-w-2xl">
          {SUGGESTIONS.map((s, i) => (
            <button
              key={s.text}
              onClick={() => onPick(s.text)}
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
    </div>
  );
}

function ChatThread({
  messages,
  streaming,
  artifacts,
  onOpenArtifact,
  endRef,
}: {
  messages: StoredMsg[];
  streaming: boolean;
  artifacts: Record<string, ChatArtifact>;
  onOpenArtifact: (id: string | null) => void;
  endRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6 space-y-5">
        {messages.map((m, i) => (
          <MessageBubble
            key={i}
            msg={m}
            artifact={m.artifact_id ? artifacts[m.artifact_id] : undefined}
            isLast={i === messages.length - 1}
            streaming={streaming}
            onOpenArtifact={onOpenArtifact}
          />
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function MessageBubble({
  msg,
  artifact,
  isLast,
  streaming,
  onOpenArtifact,
}: {
  msg: StoredMsg;
  artifact?: ChatArtifact;
  isLast: boolean;
  streaming: boolean;
  onOpenArtifact: (id: string | null) => void;
}) {
  const isUser = msg.role === "user";
  return (
    <div className={`animate-slide-up ${isUser ? "ml-12" : "mr-12"}`}>
      <div className="flex items-center gap-2 mb-2">
        {isUser ? (
          <div className="w-5 h-5 rounded-full bg-accent-gradient flex items-center justify-center text-[9px] font-semibold text-bg-deep">
            SR
          </div>
        ) : (
          <BrandMark size={20} glow={false} />
        )}
        <span className="text-[11px] text-ink-faint font-medium">
          {isUser ? "You" : "CTO Brain"}
        </span>
        {!isUser && msg.verdict ? (
          <VerdictBadge verdict={msg.verdict} />
        ) : null}
      </div>

      <div
        className={`rounded-2xl border px-4 py-3 ${
          isUser
            ? "bg-accent/[0.06] border-accent/[0.18]"
            : "bg-surface border-border hairline"
        }`}
      >
        {!isUser && msg.pills && msg.pills.length > 0 ? (
          <div className="mb-2.5 flex flex-wrap gap-1.5">
            {msg.pills.map((p, j) => (
              <StatusPill key={j} state={p} />
            ))}
          </div>
        ) : null}

        <div className="prose-thin">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {msg.content || (streaming && isLast ? "…" : "")}
          </ReactMarkdown>
        </div>

        {!isUser && artifact ? (
          <button
            onClick={() => onOpenArtifact(artifact.id)}
            className="mt-3 inline-flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/[0.06] px-3 py-1.5 text-[11.5px] font-medium text-accent hover:bg-accent/[0.10] transition-colors"
          >
            <span>{artifactLabel(artifact)}</span>
            <span className="text-ink-faint">→</span>
          </button>
        ) : null}

        {!isUser &&
        ((msg.sources_checked && msg.sources_checked.length > 0) ||
          (msg.citations && msg.citations.length > 0) ||
          msg.freshness) ? (
          <div className="mt-3 pt-3 border-t border-border/60 space-y-2">
            {msg.sources_checked && msg.sources_checked.length > 0 ? (
              <SourceChips sources={msg.sources_checked} />
            ) : null}
            {msg.citations && msg.citations.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5 text-[10.5px]">
                <span className="text-[10px] uppercase tracking-kicker text-ink-faint font-semibold">
                  Sources
                </span>
                {msg.citations.slice(0, 8).map((c, k) => (
                  <CitationChip
                    key={`${c.kind}:${c.id}:${k}`}
                    kind={c.kind}
                    id={c.id}
                    url={c.url}
                  />
                ))}
              </div>
            ) : null}
            {msg.freshness ? (
              <div className="text-[10.5px] text-ink-faint italic">
                {msg.freshness}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Composer({
  inputRef,
  inputValueRef,
  streaming,
  onSend,
  onAbort,
}: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  inputValueRef: React.MutableRefObject<string>;
  streaming: boolean;
  onSend: (text: string) => void;
  onAbort: () => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSend(inputValueRef.current);
      }}
      className="px-6 pb-6 pt-2 max-w-3xl w-full mx-auto"
    >
      <div className="relative gradient-border rounded-2xl bg-bg-elevated/95 backdrop-blur-xl shadow-soft-lift p-2">
        <textarea
          ref={inputRef}
          onChange={(e) => {
            inputValueRef.current = e.target.value;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend(inputValueRef.current);
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
          {streaming ? (
            <button
              type="button"
              onClick={onAbort}
              className="w-8 h-8 rounded-lg bg-ink/20 hover:bg-ink/30 text-ink flex items-center justify-center transition-all active:scale-95"
              title="Stop"
            >
              <Square className="w-3.5 h-3.5" strokeWidth={2.6} fill="currentColor" />
            </button>
          ) : (
            <button
              type="submit"
              className="w-8 h-8 rounded-lg bg-ink hover:bg-white text-bg-deep flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-95"
            >
              <ArrowUp className="w-4 h-4" strokeWidth={2.6} />
            </button>
          )}
        </div>
        {streaming ? (
          <div className="absolute -top-2 left-3 px-2 text-[10px] text-ink-faint bg-bg-elevated rounded-full flex items-center gap-1.5">
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
            Thinking
          </div>
        ) : null}
      </div>
    </form>
  );
}

function artifactLabel(a: ChatArtifact): string {
  if (a.kind === "doc") return `Open report — ${a.payload.title}`;
  if (a.kind === "leaderboard") return `Open leaderboard — ${a.payload.title}`;
  return `Open code review — PR #${a.payload.pr_number}`;
}

function greetingForNow(now: Date): string {
  const h = now.getHours();
  if (h < 5) return "Burning the midnight oil";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Up late";
}
