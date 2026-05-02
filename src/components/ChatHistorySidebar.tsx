"use client";

import { useEffect, useState } from "react";
import { Plus, MoreHorizontal, Pencil, Trash2, Check, X } from "lucide-react";
import { useChatStore, type SessionSummary } from "@/lib/chat/store";
import { BrandWordmark } from "@/components/BrandLogo";

function bucketFor(updatedAt: string, now: Date): string {
  const t = new Date(updatedAt);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(t, now)) return "Today";
  if (sameDay(t, yesterday)) return "Yesterday";
  const diffDays = Math.floor((now.getTime() - t.getTime()) / 86_400_000);
  if (diffDays < 7) return "This week";
  if (diffDays < 30) return "This month";
  return "Older";
}

function formatTime(updatedAt: string): string {
  const d = new Date(updatedAt);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ap = h >= 12 ? "p" : "a";
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${m}${ap}`;
}

export function ChatHistorySidebar() {
  const sessions = useChatStore((s) => s.sessions);
  const activeId = useChatStore((s) => s.activeSessionId);
  const loading = useChatStore((s) => s.loadingSessions);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const selectSession = useChatStore((s) => s.selectSession);
  const newSession = useChatStore((s) => s.newSession);
  const renameSession = useChatStore((s) => s.renameSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const streaming = useChatStore((s) => s.streaming);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  // Group by bucket
  const now = new Date();
  const groups = new Map<string, SessionSummary[]>();
  const order = ["Today", "Yesterday", "This week", "This month", "Older"];
  for (const s of sessions) {
    const b = bucketFor(s.updatedAt, now);
    if (!groups.has(b)) groups.set(b, []);
    groups.get(b)!.push(s);
  }

  function startRename(s: SessionSummary) {
    setRenamingId(s.id);
    setRenameDraft(s.title);
    setOpenMenuId(null);
  }
  async function commitRename() {
    if (!renamingId || !renameDraft.trim()) {
      setRenamingId(null);
      return;
    }
    await renameSession(renamingId, renameDraft.trim());
    setRenamingId(null);
  }

  return (
    <aside className="flex h-full w-[244px] flex-col border-r border-border bg-bg/70 backdrop-blur-xl">
      <div className="px-4 pt-5 pb-4">
        <BrandWordmark size={28} />
      </div>

      <div className="px-3 pb-3">
        <button
          onClick={() => newSession()}
          disabled={streaming}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-border bg-bg-elevated/60 hover:bg-surface hover:border-border-strong transition-colors text-[12.5px] font-medium text-ink disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="w-3.5 h-3.5" />
          New chat
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-3">
        {loading && sessions.length === 0 ? (
          <div className="px-3 py-2 text-[11px] text-ink-faint">Loading…</div>
        ) : sessions.length === 0 ? (
          <div className="px-3 py-4 text-[11px] text-ink-faint">
            No chats yet. Ask anything to start.
          </div>
        ) : (
          order
            .filter((b) => groups.has(b))
            .map((b) => (
              <div key={b} className="mb-3">
                <div className="text-[10px] uppercase tracking-kicker text-ink-ghost font-semibold px-3 mb-1.5">
                  {b}
                </div>
                <ul className="space-y-0.5">
                  {groups.get(b)!.map((s) => {
                    const isActive = s.id === activeId;
                    const isRenaming = s.id === renamingId;
                    return (
                      <li key={s.id}>
                        {isRenaming ? (
                          <div className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-surface-strong">
                            <input
                              autoFocus
                              value={renameDraft}
                              onChange={(e) => setRenameDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void commitRename();
                                if (e.key === "Escape") setRenamingId(null);
                              }}
                              className="flex-1 bg-transparent text-[12.5px] text-ink outline-none"
                            />
                            <button
                              onClick={() => void commitRename()}
                              className="text-emerald-400 hover:text-emerald-300"
                              aria-label="Save"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setRenamingId(null)}
                              className="text-ink-faint hover:text-ink"
                              aria-label="Cancel"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : confirmDeleteId === s.id ? (
                          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-red-500/[0.06] border border-red-500/30">
                            <span className="flex-1 text-[11.5px] text-red-300 truncate">
                              Delete this chat?
                            </span>
                            <button
                              onClick={() => {
                                void deleteSession(s.id);
                                setConfirmDeleteId(null);
                              }}
                              className="text-[11px] font-medium text-red-300 hover:text-red-200"
                            >
                              Yes
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-[11px] font-medium text-ink-faint hover:text-ink"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <div
                            className={`group relative flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-md text-[12.5px] transition-colors cursor-pointer
                              ${isActive ? "bg-surface-strong text-ink" : "text-ink-dim hover:bg-surface hover:text-ink"}`}
                            onClick={() => void selectSession(s.id)}
                          >
                            {isActive && (
                              <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-accent shadow-[0_0_8px_rgba(251,146,60,0.7)]" />
                            )}
                            <span className="flex-1 truncate tracking-tight2">
                              {s.title}
                            </span>
                            <span className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-ink-faint tabular-nums">
                              {formatTime(s.updatedAt)}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMenuId(openMenuId === s.id ? null : s.id);
                              }}
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-ink-faint hover:text-ink p-0.5 rounded"
                              aria-label="Menu"
                            >
                              <MoreHorizontal className="w-3.5 h-3.5" />
                            </button>
                            {openMenuId === s.id && (
                              <div
                                className="absolute right-2 top-full mt-1 z-30 w-32 rounded-md border border-border bg-bg-elevated/95 backdrop-blur-xl shadow-soft-lift py-1"
                                onMouseLeave={() => setOpenMenuId(null)}
                              >
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    startRename(s);
                                  }}
                                  className="w-full px-3 py-1.5 flex items-center gap-2 text-[12px] text-ink-dim hover:bg-surface hover:text-ink text-left"
                                >
                                  <Pencil className="w-3 h-3" />
                                  Rename
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setConfirmDeleteId(s.id);
                                    setOpenMenuId(null);
                                  }}
                                  className="w-full px-3 py-1.5 flex items-center gap-2 text-[12px] text-red-300 hover:bg-red-500/[0.08] text-left"
                                >
                                  <Trash2 className="w-3 h-3" />
                                  Delete
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
        )}
      </nav>

      <div className="px-3 pb-4 pt-2 border-t border-border/60">
        <div className="flex items-center gap-2.5 p-2 rounded-lg">
          <div className="w-7 h-7 rounded-full bg-accent-gradient flex items-center justify-center text-[10px] font-semibold text-bg-deep">
            SR
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-medium tracking-tight2 truncate">
              Souvik Roy
            </div>
            <div className="text-[10px] text-ink-faint truncate">
              CEO · Q2 2026
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
