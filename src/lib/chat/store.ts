/**
 * Zustand store for the chat surface. Single source of truth for:
 *   - the sessions list (sidebar)
 *   - the currently selected session's messages + artifacts
 *   - streaming state
 *
 * Server is authoritative for persistence. Every mutation that touches the DB
 * (create/rename/delete/send) writes through to /api/sessions or /api/chat
 * and then reflects the response into local state. We do NOT optimistically
 * update title/order — the server returns the canonical row.
 */
"use client";

import { create } from "zustand";
import type { ArtifactPayload, ChatEvent, ArtifactKind } from "@/lib/chat/events";
import type { Citation } from "@/lib/python";
import type { StatusPillState } from "@/components/StatusPill";

export type Verdict = "ok" | "weak" | "unsupported" | "skip";

export type StoredMsg = {
  role: "user" | "assistant";
  content: string;
  pills?: StatusPillState[];
  artifact_id?: string | null;
  citations?: Citation[];
  verdict?: Verdict;
  sources_checked?: string[];
  freshness?: string;
};

export type ChatArtifact = ArtifactPayload & { id: string; citations: Citation[] };

export type SessionSummary = {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
};

export type SessionDetail = SessionSummary & {
  messages: StoredMsg[];
  artifacts: Record<string, ChatArtifact>;
};

type ChatState = {
  // Sidebar list
  sessions: SessionSummary[];
  loadingSessions: boolean;

  // Active session
  activeSessionId: string | null;
  messages: StoredMsg[];
  artifacts: Record<string, ChatArtifact>;
  selectedArtifactId: string | null;

  // Streaming
  streaming: boolean;
  abortController: AbortController | null;

  // Cursor-style message queue (FIFO). Items added while streaming; drained
  // automatically when the current turn ends. Cleared on Stop / switch / new.
  messageQueue: string[];

  // Actions
  loadSessions: () => Promise<void>;
  selectSession: (id: string | null) => Promise<void>;
  newSession: () => void; // local-only; persists on first send
  renameSession: (id: string, title: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  submitMessage: (text: string) => void; // unified entry: send-now or enqueue
  removeQueued: (index: number) => void;
  setSelectedArtifact: (id: string | null) => void;
  abortStreaming: () => void;
};

function applyEvent(
  ev: ChatEvent,
  state: { messages: StoredMsg[]; artifacts: Record<string, ChatArtifact> },
): { messages: StoredMsg[]; artifacts: Record<string, ChatArtifact> } {
  // applies one streamed event to the LAST assistant message; returns
  // a new state object (immutable patches, suitable for set()).
  const { messages, artifacts } = state;
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return state;
  const head = messages.slice(0, -1);

  switch (ev.type) {
    case "text":
      return {
        messages: [...head, { ...last, content: last.content + ev.delta }],
        artifacts,
      };
    case "tool_status": {
      const pills = [...(last.pills ?? [])];
      if (ev.phase === "start") {
        pills.push({
          tool: ev.tool,
          phase: "running",
          input_summary: ev.input_summary,
        });
      } else {
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
      return { messages: [...head, { ...last, pills }], artifacts };
    }
    case "artifact": {
      // strip the discriminator so the rest is the payload+citations
      const { type: _t, id, citations, ...artifact } = ev as ChatEvent & {
        type: "artifact";
      } & { id: string; citations: Citation[]; kind: ArtifactKind };
      void _t;
      const next: ChatArtifact = {
        ...(artifact as ArtifactPayload),
        id,
        citations,
      };
      return {
        messages: [...head, { ...last, artifact_id: id }],
        artifacts: { ...artifacts, [id]: next },
      };
    }
    case "done":
      return {
        messages: [
          ...head,
          {
            ...last,
            verdict: ev.verdict,
            citations: ev.citations,
            sources_checked: (ev as { sources_checked?: string[] }).sources_checked,
            freshness: ev.freshness,
          },
        ],
        artifacts,
      };
    case "error":
      return {
        messages: [
          ...head,
          { ...last, content: last.content + `\n\n_Error: ${ev.message}_` },
        ],
        artifacts,
      };
    default:
      return state;
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  loadingSessions: false,
  activeSessionId: null,
  messages: [],
  artifacts: {},
  selectedArtifactId: null,
  streaming: false,
  abortController: null,
  messageQueue: [],

  loadSessions: async () => {
    set({ loadingSessions: true });
    try {
      const res = await fetch("/api/sessions");
      const data = (await res.json()) as { sessions: SessionSummary[] };
      set({ sessions: data.sessions, loadingSessions: false });
    } catch {
      set({ loadingSessions: false });
    }
  },

  selectSession: async (id) => {
    // Switching sessions clears any pending queue — those queued intents
    // belonged to the previous conversation.
    set({ messageQueue: [] });
    if (id == null) {
      set({
        activeSessionId: null,
        messages: [],
        artifacts: {},
        selectedArtifactId: null,
      });
      return;
    }
    const res = await fetch(`/api/sessions/${id}`);
    if (!res.ok) {
      set({
        activeSessionId: null,
        messages: [],
        artifacts: {},
        selectedArtifactId: null,
      });
      return;
    }
    const detail = (await res.json()) as SessionDetail;
    set({
      activeSessionId: detail.id,
      messages: detail.messages ?? [],
      artifacts: detail.artifacts ?? {},
      selectedArtifactId: null,
    });
  },

  newSession: () => {
    set({
      activeSessionId: null,
      messages: [],
      artifacts: {},
      selectedArtifactId: null,
      messageQueue: [],
    });
  },

  renameSession: async (id, title) => {
    const res = await fetch(`/api/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) return;
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === id ? { ...x, title, updatedAt: new Date().toISOString() } : x,
      ),
    }));
  },

  deleteSession: async (id) => {
    await fetch(`/api/sessions/${id}`, { method: "DELETE" });
    set((s) => ({
      sessions: s.sessions.filter((x) => x.id !== id),
      // If we deleted the active session, drop into a fresh state.
      ...(s.activeSessionId === id
        ? {
            activeSessionId: null,
            messages: [],
            artifacts: {},
            selectedArtifactId: null,
            messageQueue: [],
          }
        : {}),
    }));
  },

  setSelectedArtifact: (id) => set({ selectedArtifactId: id }),

  abortStreaming: () => {
    const ac = get().abortController;
    if (ac) ac.abort();
    // Stop = stop everything: abort current + clear queue. The queue continues
    // to drain on regular completion or error, but explicit Stop is "halt all".
    set({ streaming: false, abortController: null, messageQueue: [] });
  },

  removeQueued: (index) => {
    set((s) => ({
      messageQueue: s.messageQueue.filter((_, i) => i !== index),
    }));
  },

  // Unified entry point. If the agent is busy, queue the message; otherwise
  // dispatch immediately. Returns synchronously — the actual send is fire-
  // and-forget so callers can keep typing.
  submitMessage: (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (get().streaming) {
      set((s) => ({ messageQueue: [...s.messageQueue, trimmed] }));
      return;
    }
    void runSend(trimmed, get, set);
  },
}));

// ── Private: actual stream-and-persist for one user turn ─────────────
async function runSend(
  text: string,
  get: () => ChatState,
  set: (
    partial:
      | Partial<ChatState>
      | ((s: ChatState) => Partial<ChatState>),
  ) => void,
): Promise<void> {
  // Optimistically append user msg + empty assistant placeholder.
  set((s) => ({
    messages: [
      ...s.messages,
      { role: "user", content: text },
      { role: "assistant", content: "", pills: [] },
    ],
    streaming: true,
  }));

  const ac = new AbortController();
  set({ abortController: ac });

  const body = {
    messages: get()
      .messages.filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content })),
    session_id: get().activeSessionId,
  };

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.body) throw new Error("No stream body");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const dispatch = (line: string) => {
      if (!line.trim()) return;
      let ev: ChatEvent | { type: "session"; id: string };
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      if (ev.type === "session") {
        set({ activeSessionId: ev.id });
        void get().loadSessions();
        return;
      }
      if (ev.type === "artifact") {
        set((s) => {
          const next = applyEvent(ev as ChatEvent, {
            messages: s.messages,
            artifacts: s.artifacts,
          });
          return { ...next, selectedArtifactId: (ev as { id: string }).id };
        });
        return;
      }
      set((s) =>
        applyEvent(ev as ChatEvent, {
          messages: s.messages,
          artifacts: s.artifacts,
        }),
      );
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf("\n");
      while (nl !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        dispatch(line);
        nl = buffer.indexOf("\n");
      }
    }
    const tail = buffer.trim();
    if (tail) dispatch(tail);
    void get().loadSessions();
  } catch (e) {
    const isAbort = (e as { name?: string }).name === "AbortError";
    if (!isAbort) {
      set((s) => {
        const head = s.messages.slice(0, -1);
        const last = s.messages[s.messages.length - 1];
        return {
          messages: [
            ...head,
            { ...last, content: last.content + `\n\n_Error: ${(e as Error).message}_` },
          ],
        };
      });
    }
  } finally {
    // Only own the streaming flag if we're still the active runSend.
    // If Stop was clicked AND a new turn fired before this finally ran, a
    // newer runSend will have replaced abortController — leave its state alone.
    if (get().abortController === ac) {
      set({ streaming: false, abortController: null });
      // ── Drain the queue: dequeue the head and recursively send. If abort
      // cleared the queue, this is a no-op. If a real error happened, we
      // still drain — queued intents are independent.
      const queue = get().messageQueue;
      if (queue.length > 0) {
        const [next, ...rest] = queue;
        set({ messageQueue: rest });
        // Microtask so the previous turn's state writes settle visually.
        queueMicrotask(() => {
          void runSend(next, get, set);
        });
      }
    }
  }
}
