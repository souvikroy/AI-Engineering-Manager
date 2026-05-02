"use client";

import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, Loader2, Target, Brain, BarChart3, Siren, Square, X, ChevronUp, Menu } from "lucide-react";
import { Kbd } from "@/components/Card";
import { BrandMark, MascotHero } from "@/components/BrandLogo";
import { StatusPill } from "@/components/StatusPill";
import { ArtifactPanel } from "@/components/ArtifactPanel";
import { ChatHistorySidebar } from "@/components/ChatHistorySidebar";
import { SourceChips, CitationChip } from "@/components/SourceChips";
import { VerdictBadge } from "@/components/VerdictBadge";
import { useChatStore, type ChatArtifact, type StoredMsg } from "@/lib/chat/store";
import { useKeyboardShortcut } from "@/lib/hooks/useKeyboardShortcut";

type Suggestion = { icon: React.ReactNode; title: string; text: string };

const ALL_SUGGESTIONS: Record<"morning" | "afternoon" | "evening" | "late", Suggestion[]> = {
  morning: [
    { icon: <BarChart3 className="w-4 h-4" />, title: "Today's brief", text: "Give me today's intelligence brief — what changed overnight?" },
    { icon: <Target className="w-4 h-4" />, title: "Sprint risk this week", text: "What's the biggest sprint risk this week and why?" },
    { icon: <Brain className="w-4 h-4" />, title: "Burnout signals", text: "Which engineers are stuck or showing burnout signals?" },
    { icon: <Siren className="w-4 h-4" />, title: "Open incidents", text: "Anything new on the open incidents from yesterday?" },
  ],
  afternoon: [
    { icon: <Target className="w-4 h-4" />, title: "Sprint health", text: "How is the current sprint tracking? Top three risks." },
    { icon: <BarChart3 className="w-4 h-4" />, title: "Engineering leaderboard", text: "Show me the engineering leaderboard for this sprint." },
    { icon: <Brain className="w-4 h-4" />, title: "Standup digest", text: "Summarize the last week of standups by team." },
    { icon: <Siren className="w-4 h-4" />, title: "PR review", text: "Review the latest open PR." },
  ],
  evening: [
    { icon: <Siren className="w-4 h-4" />, title: "Pre-leadership escalations", text: "Anything I should escalate before the leadership sync?" },
    { icon: <Target className="w-4 h-4" />, title: "Today's slips", text: "What slipped today? Which tickets stalled and why?" },
    { icon: <BarChart3 className="w-4 h-4" />, title: "OKR progress", text: "Summarize OKR progress and the two riskiest items." },
    { icon: <Brain className="w-4 h-4" />, title: "End-of-day signals", text: "Any standout signals from the day worth flagging?" },
  ],
  late: [
    { icon: <Brain className="w-4 h-4" />, title: "Tomorrow's prep", text: "What do I need to look at first thing tomorrow morning?" },
    { icon: <Target className="w-4 h-4" />, title: "Open blockers", text: "Which engineers are blocked heading into tomorrow?" },
    { icon: <BarChart3 className="w-4 h-4" />, title: "OKR snapshot", text: "Quick snapshot of OKR progress as of right now." },
    { icon: <Siren className="w-4 h-4" />, title: "Anything on fire?", text: "Anything on fire I should know about before signing off?" },
  ],
};

function timeOfDay(now: Date): "morning" | "afternoon" | "evening" | "late" {
  const h = now.getHours();
  if (h < 5) return "late";
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  if (h < 22) return "evening";
  return "late";
}

export default function ChatPage() {
  const messages = useChatStore((s) => s.messages);
  const artifacts = useChatStore((s) => s.artifacts);
  const selectedArtifactId = useChatStore((s) => s.selectedArtifactId);
  const setSelectedArtifact = useChatStore((s) => s.setSelectedArtifact);
  const streaming = useChatStore((s) => s.streaming);
  const submitMessage = useChatStore((s) => s.submitMessage);
  const abortStreaming = useChatStore((s) => s.abortStreaming);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const messageQueue = useChatStore((s) => s.messageQueue);
  const removeQueued = useChatStore((s) => s.removeQueued);
  const toggleSidebar = useChatStore((s) => s.toggleSidebar);
  const hydrateUiPrefs = useChatStore((s) => s.hydrateUiPrefs);

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputValueRef = useRef<string>("");

  // Hydrate sidebar collapse state from localStorage on first mount.
  useEffect(() => {
    hydrateUiPrefs();
  }, [hydrateUiPrefs]);

  // Cmd/Ctrl+B toggles the sidebar — works even when focus is in the textarea.
  useKeyboardShortcut(
    { key: "b", meta: true },
    (e) => {
      e.preventDefault();
      toggleSidebar();
    },
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, messageQueue]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [activeSessionId]);

  function send(text: string) {
    if (!text.trim()) return;
    inputValueRef.current = "";
    if (inputRef.current) inputRef.current.value = "";
    // submitMessage routes to send-now or enqueue based on streaming state.
    submitMessage(text);
  }

  const activeArtifact: ChatArtifact | null =
    selectedArtifactId && artifacts[selectedArtifactId]
      ? artifacts[selectedArtifactId]
      : null;

  const showHero = messages.length === 0;

  // Mobile backdrop visibility — show when sidebar is expanded on small screens.
  const sidebarOpen = !useChatStore((s) => s.sidebarCollapsed);

  return (
    <div className="flex h-[100dvh] w-screen overflow-hidden bg-bg">
      <ChatHistorySidebar />

      {/* Mobile-only backdrop that dims the chat when the sidebar is open. */}
      {sidebarOpen ? (
        <button
          onClick={toggleSidebar}
          aria-label="Close sidebar"
          className="md:hidden fixed inset-0 z-20 bg-black/40 backdrop-blur-[2px] animate-fade-in"
        />
      ) : null}

      {/* Mobile-only hamburger to open the sidebar. Hidden on md+. */}
      <button
        onClick={toggleSidebar}
        className="md:hidden fixed top-3 left-3 z-40 w-9 h-9 rounded-full bg-bg-elevated/80 backdrop-blur surface-card text-ink-faint hover:text-ink flex items-center justify-center"
        title="Toggle sidebar"
        aria-label="Toggle sidebar"
      >
        <Menu className="w-4 h-4" />
      </button>

      <div
        className={`flex flex-col h-full overflow-hidden transition-all duration-300 ${
          activeArtifact ? "flex-1 md:min-w-[420px]" : "flex-1"
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
          queue={messageQueue}
          onRemoveQueued={removeQueued}
        />
      </div>

      {activeArtifact ? (
        <div className="fixed md:relative inset-0 md:inset-auto md:w-1/2 md:min-w-[420px] md:max-w-[820px] h-full z-30 md:z-auto animate-enter">
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
  const now = new Date();
  const greeting = greetingForNow(now);
  const tod = timeOfDay(now);
  const suggestions = ALL_SUGGESTIONS[tod];
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex flex-col items-center justify-center min-h-full px-8 py-20 max-w-3xl mx-auto">
        <div className="text-center mb-14 animate-rise">
          <div className="inline-flex relative mb-8">
            <MascotHero size={96} />
            <div className="absolute inset-0 blur-3xl opacity-30 -z-10 bg-accent" />
          </div>
          <h1
            className="font-display text-display text-ink-cream tracking-display leading-[1.05] mb-4 text-balance"
            style={{ fontWeight: 360 }}
          >
            <span className="block">
              <em className="not-italic font-display italic text-ink-cream/90">
                {greeting},
              </em>
            </span>
            <span className="block">Souvik.</span>
          </h1>
          <p className="font-display italic text-body-lg text-ink-dim max-w-md mx-auto text-pretty">
            Grounded on the latest brief, OKRs, incidents, and standup history.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-2xl">
          {suggestions.map((s, i) => (
            <button
              key={s.text}
              onClick={() => onPick(s.text)}
              style={{ animationDelay: `${i * 70}ms` }}
              className="group relative text-left p-5 rounded-2xl bg-surface surface-hairline hover:surface-card hover:bg-surface-hover transition-all duration-200 animate-rise"
            >
              <div className="flex items-start gap-3.5">
                <div className="shrink-0 w-9 h-9 rounded-full bg-bg-elevated/80 surface-hairline flex items-center justify-center text-ink-dim group-hover:text-accent transition-colors">
                  {s.icon}
                </div>
                <div className="min-w-0 pt-0.5">
                  <div className="font-display italic text-body-lg text-ink mb-1 leading-tight">
                    {s.title}
                  </div>
                  <div className="text-body-md text-ink-faint leading-snug">
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
    <div className={`animate-slide-up ${isUser ? "ml-16" : "mr-16"}`}>
      <div className="flex items-center gap-2.5 mb-2.5">
        {isUser ? (
          <div className="w-5 h-5 rounded-full bg-accent-gradient flex items-center justify-center text-[9px] font-semibold text-bg-deep">
            SR
          </div>
        ) : (
          <BrandMark size={20} glow={false} />
        )}
        <span className="text-caption text-ink-faint font-medium tracking-tight2">
          {isUser ? "You" : "CTO Brain"}
        </span>
        {!isUser && msg.verdict ? (
          <VerdictBadge verdict={msg.verdict} />
        ) : null}
      </div>

      <div
        className={`rounded-[18px] px-5 py-4 ${
          isUser
            ? "bg-accent/[0.04] surface-hairline"
            : "bg-surface surface-card"
        }`}
      >
        {!isUser && msg.pills && msg.pills.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {msg.pills.map((p, j) => (
              <StatusPill key={j} state={p} />
            ))}
          </div>
        ) : null}

        <div className="prose-thin text-body-lg leading-[1.6]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {msg.content || (streaming && isLast ? "…" : "")}
          </ReactMarkdown>
        </div>

        {!isUser && artifact ? (
          <button
            onClick={() => onOpenArtifact(artifact.id)}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-accent/[0.06] hover:bg-accent/[0.10] px-3.5 py-2 text-body-md font-medium text-accent surface-hairline transition-colors"
          >
            <span className="font-display italic">{artifactLabel(artifact)}</span>
            <span className="text-ink-faint">→</span>
          </button>
        ) : null}

        {!isUser &&
        ((msg.sources_checked && msg.sources_checked.length > 0) ||
          (msg.citations && msg.citations.length > 0) ||
          msg.freshness) ? (
          <div className="mt-4 pt-3.5 space-y-2.5 border-t border-white/[0.04]">
            {msg.sources_checked && msg.sources_checked.length > 0 ? (
              <SourceChips sources={msg.sources_checked} />
            ) : null}
            {msg.citations && msg.citations.length > 0 ? (
              <div className="stagger-citations flex flex-wrap items-center gap-1.5">
                <span className="text-kicker shrink-0 mr-1">
                  ✦ Sources
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
              <div className="font-display italic text-caption text-ink-faint">
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
  queue,
  onRemoveQueued,
}: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  inputValueRef: React.MutableRefObject<string>;
  streaming: boolean;
  onSend: (text: string) => void;
  onAbort: () => void;
  queue: string[];
  onRemoveQueued: (index: number) => void;
}) {
  return (
    <div className="px-6 pb-6 pt-2 max-w-3xl w-full mx-auto">
      {queue.length > 0 ? (
        <div className="mb-2 space-y-1.5">
          {queue.map((q, i) => (
            <div
              key={i}
              className="group flex items-center gap-2 rounded-lg border border-accent/25 bg-accent/[0.05] px-3 py-1.5 text-[12px] animate-rise"
            >
              <ChevronUp className="h-3 w-3 text-accent shrink-0" />
              <span className="text-[10px] uppercase tracking-kicker text-accent/80 font-semibold shrink-0">
                Queued
              </span>
              <span className="flex-1 truncate text-ink-dim">{q}</span>
              <button
                onClick={() => onRemoveQueued(i)}
                className="opacity-60 hover:opacity-100 text-ink-faint hover:text-ink transition-opacity"
                aria-label="Remove queued message"
                title="Remove from queue"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSend(inputValueRef.current);
        }}
      >
        <div
          className={`relative rounded-[20px] bg-bg-elevated/95 backdrop-blur-xl surface-lift p-3 transition-shadow duration-300 ${
            streaming ? "composer-breathing" : ""
          }`}
        >
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
            placeholder={
              streaming
                ? "Type to queue the next message…"
                : "Ask anything…"
            }
            rows={1}
            className="w-full bg-transparent resize-none px-3 py-2.5 text-body-lg leading-snug placeholder:text-ink-ghost placeholder:font-display placeholder:italic focus:outline-none"
          />
          <div className="flex items-center justify-between px-2 pt-1.5">
            <div className="flex items-center gap-2 text-caption text-ink-faint">
              <Kbd>↵</Kbd>
              <span className="font-display italic">
                {streaming ? "queue" : "send"}
              </span>
              <span className="text-ink-ghost">·</span>
              <Kbd>⇧</Kbd>
              <Kbd>↵</Kbd>
              <span className="font-display italic">newline</span>
              <span className="text-ink-ghost">·</span>
              <Kbd>⌘</Kbd>
              <Kbd>B</Kbd>
              <span className="font-display italic">sidebar</span>
            </div>
            {streaming ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="submit"
                  className="w-9 h-9 rounded-xl bg-accent/10 hover:bg-accent/20 text-accent flex items-center justify-center transition-all active:scale-95"
                  title="Queue (Enter)"
                >
                  <ChevronUp className="w-4 h-4" strokeWidth={2.6} />
                </button>
                <button
                  type="button"
                  onClick={onAbort}
                  className="w-9 h-9 rounded-xl bg-ink/15 hover:bg-ink/25 text-ink flex items-center justify-center transition-all active:scale-95"
                  title="Stop everything (clears queue too)"
                >
                  <Square
                    className="w-3.5 h-3.5"
                    strokeWidth={2.6}
                    fill="currentColor"
                  />
                </button>
              </div>
            ) : (
              <button
                type="submit"
                className="w-9 h-9 rounded-xl bg-ink hover:bg-white text-bg-deep flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-95"
              >
                <ArrowUp className="w-4 h-4" strokeWidth={2.6} />
              </button>
            )}
          </div>
          {streaming ? (
            <div className="absolute -top-2.5 left-4 px-2.5 py-0.5 text-caption text-accent bg-bg-elevated rounded-full flex items-center gap-1.5 surface-hairline">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              <span className="font-display italic tracking-tight">
                Thinking
              </span>
            </div>
          ) : null}
        </div>
      </form>
    </div>
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
