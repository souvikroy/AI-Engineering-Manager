"use client";

import { useEffect, useState } from "react";
import {
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Check,
  X,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useChatStore, type SessionSummary } from "@/lib/chat/store";
import { BrandWordmark, BrandMark } from "@/components/BrandLogo";

// Width breakpoints — also encoded as Tailwind classes on the <aside>.
//   collapsed desktop: 64px  · expanded desktop: 288px  · mobile overlay: 280px
// (Kept here as a single source of truth comment; classes do the work.)

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

// Stable color-dot per session id — visible in collapsed rail mode.
function dotColor(id: string): string {
  // Editorial-warm palette — kept low-saturation so the rail stays calm.
  const palette = [
    "#fbbf24", // amber
    "#fb923c", // orange (brand accent)
    "#fdba74", // peach
    "#f4ead9", // cream
    "#fca5a5", // rose
    "#e9d5ff", // lilac
    "#bef264", // lime
    "#67e8f9", // cyan
  ];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length];
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
  const collapsed = useChatStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useChatStore((s) => s.toggleSidebar);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

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
    <aside
      className={`fixed md:relative inset-y-0 left-0 z-30 md:z-auto flex h-full flex-col bg-bg/95 md:bg-bg/80 backdrop-blur-xl shrink-0 transition-[transform,width] duration-[300ms] ease-[cubic-bezier(0.32,0.72,0.32,1)] ${
        collapsed
          ? "-translate-x-full md:translate-x-0 w-[280px] md:w-[64px]"
          : "translate-x-0 w-[280px] md:w-[288px]"
      }`}
    >
      {/* Brand row */}
      <div
        className={`flex items-center pt-5 pb-4 transition-[padding] duration-300 ${
          collapsed ? "justify-center px-0" : "justify-between px-4"
        }`}
      >
        {collapsed ? (
          <BrandMark size={28} glow={false} />
        ) : (
          <BrandWordmark size={28} />
        )}
      </div>

      {/* New chat */}
      <div className={collapsed ? "px-3 pb-3" : "px-3 pb-4"}>
        <button
          onClick={() => newSession()}
          disabled={streaming}
          title={collapsed ? "New chat" : undefined}
          className={`group flex items-center justify-center gap-2 transition-all surface-hairline disabled:opacity-50 disabled:cursor-not-allowed text-ink hover:text-ink ${
            collapsed
              ? "w-10 h-10 mx-auto rounded-xl bg-bg-elevated/60 hover:bg-surface"
              : "w-full px-3 py-2.5 rounded-xl bg-bg-elevated/60 hover:bg-surface text-[13px] font-medium"
          }`}
        >
          <Plus className={collapsed ? "w-4 h-4" : "w-3.5 h-3.5"} />
          {!collapsed && <span>New chat</span>}
        </button>
      </div>

      {/* Threads */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden">
        {loading && sessions.length === 0 ? (
          collapsed ? null : (
            <div className="px-4 py-2 text-caption text-ink-faint">Loading…</div>
          )
        ) : sessions.length === 0 ? (
          collapsed ? null : (
            <div className="px-4 py-4 text-caption text-ink-faint italic font-display">
              No chats yet.<br />Ask anything to start.
            </div>
          )
        ) : collapsed ? (
          // ── Collapsed rail: color dots only, vertical stack ────────
          <ul className="flex flex-col items-center gap-1 px-2 pt-1">
            {sessions.slice(0, 24).map((s) => {
              const isActive = s.id === activeId;
              return (
                <li key={s.id}>
                  <button
                    onClick={() => void selectSession(s.id)}
                    className="group relative flex items-center justify-center w-10 h-10 rounded-lg hover:bg-surface transition-colors"
                    title={`${s.title} · ${formatTime(s.updatedAt)}`}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-accent shadow-[0_0_8px_rgba(251,146,60,0.7)]" />
                    )}
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{
                        background: dotColor(s.id),
                        boxShadow: isActive
                          ? `0 0 10px ${dotColor(s.id)}55`
                          : "none",
                      }}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          // ── Expanded: editorial group headers + thread rows ────────
          <div className="px-2 pb-3">
            {order
              .filter((b) => groups.has(b))
              .map((b) => (
                <div key={b} className="mb-3">
                  <div className="text-kicker px-3 mb-1.5 select-none">{b}</div>
                  <ul className="space-y-0.5">
                    {groups.get(b)!.map((s) => {
                      const isActive = s.id === activeId;
                      const isRenaming = s.id === renamingId;
                      return (
                        <li key={s.id}>
                          {isRenaming ? (
                            <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-surface-strong">
                              <input
                                autoFocus
                                value={renameDraft}
                                onChange={(e) => setRenameDraft(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") void commitRename();
                                  if (e.key === "Escape") setRenamingId(null);
                                }}
                                className="flex-1 bg-transparent text-body-md text-ink outline-none"
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
                            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/[0.06]">
                              <span className="flex-1 text-[11.5px] text-red-300/90 italic font-display truncate">
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
                              className={`group relative flex items-center gap-2.5 pl-3 pr-2 py-1.5 rounded-lg cursor-pointer transition-colors text-body-md ${
                                isActive
                                  ? "bg-surface-strong text-ink"
                                  : "text-ink-dim hover:bg-surface hover:text-ink"
                              }`}
                              onClick={() => void selectSession(s.id)}
                            >
                              {isActive && (
                                <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-accent shadow-[0_0_8px_rgba(251,146,60,0.7)]" />
                              )}
                              <span
                                className="w-1.5 h-1.5 rounded-full shrink-0"
                                style={{ background: dotColor(s.id) }}
                              />
                              <span className="flex-1 truncate">
                                {s.title}
                              </span>
                              <span className="opacity-0 group-hover:opacity-100 transition-opacity text-caption text-ink-faint tabular-nums shrink-0">
                                {formatTime(s.updatedAt)}
                              </span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenMenuId(
                                    openMenuId === s.id ? null : s.id,
                                  );
                                }}
                                className="opacity-0 group-hover:opacity-100 transition-opacity text-ink-faint hover:text-ink p-0.5 rounded shrink-0"
                                aria-label="Menu"
                              >
                                <MoreHorizontal className="w-3.5 h-3.5" />
                              </button>
                              {openMenuId === s.id && (
                                <div
                                  className="absolute right-2 top-full mt-1 z-30 w-32 rounded-md bg-bg-elevated/95 backdrop-blur-xl surface-card py-1"
                                  onMouseLeave={() => setOpenMenuId(null)}
                                >
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      startRename(s);
                                    }}
                                    className="w-full px-3 py-1.5 flex items-center gap-2 text-caption text-ink-dim hover:bg-surface hover:text-ink text-left"
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
                                    className="w-full px-3 py-1.5 flex items-center gap-2 text-caption text-red-300 hover:bg-red-500/[0.08] text-left"
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
              ))}
          </div>
        )}
      </nav>

      {/* Profile / footer */}
      <div className={collapsed ? "px-2 pb-3 pt-2" : "px-3 pb-4 pt-2"}>
        <div
          className={`flex items-center transition-all ${
            collapsed ? "justify-center" : "gap-2.5 p-2 rounded-lg"
          }`}
        >
          <div
            className="w-7 h-7 rounded-full bg-accent-gradient flex items-center justify-center text-[10px] font-semibold text-bg-deep shrink-0"
            title={collapsed ? "Souvik Roy · CEO" : undefined}
          >
            SR
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium tracking-tight2 truncate">
                Souvik Roy
              </div>
              <div className="text-[10px] text-ink-faint truncate italic font-display">
                CEO · Q2 2026
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Edge toggle — always visible, sits on the rail's right edge */}
      <button
        onClick={toggleSidebar}
        title={collapsed ? "Expand sidebar (⌘B)" : "Collapse sidebar (⌘B)"}
        className="absolute top-6 -right-3 z-20 w-6 h-6 flex items-center justify-center rounded-full bg-bg-elevated text-ink-faint hover:text-ink surface-card transition-colors"
      >
        {collapsed ? (
          <PanelLeftOpen className="w-3.5 h-3.5" />
        ) : (
          <PanelLeftClose className="w-3.5 h-3.5" />
        )}
      </button>
    </aside>
  );
}
