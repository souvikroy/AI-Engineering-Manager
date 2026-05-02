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

  // Actions
  loadSessions: () => Promise<void>;
  selectSession: (id: string | null) => Promise<void>;
  newSession: () => void; // local-only; persists on first send
  renameSession: (id: string, title: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
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
          }
        : {}),
    }));
  },

  setSelectedArtifact: (id) => set({ selectedArtifactId: id }),

  abortStreaming: () => {
    const ac = get().abortController;
    if (ac) ac.abort();
    set({ streaming: false, abortController: null });
  },

  sendMessage: async (text) => {
    if (!text.trim() || get().streaming) return;

    // Optimistically append user msg + empty assistant msg.
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
          // Server created or confirmed a session id for this turn.
          set({ activeSessionId: ev.id });
          // Refresh sidebar so the new thread shows up.
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

      // Refresh sessions so updatedAt re-orders the sidebar.
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
      set({ streaming: false, abortController: null });
    }
  },
}));
