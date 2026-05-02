"use client";

import { useEffect, useState } from "react";
import { Calendar, Clock, X, Sparkles, Loader2, Mail } from "lucide-react";
import { useChatStore, type ScheduleCadence } from "@/lib/chat/store";

const CADENCE_OPTIONS: { value: ScheduleCadence["kind"]; label: string }[] = [
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Weekdays (Mon–Fri)" },
  { value: "weekly", label: "Weekly" },
];

const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

export function ScheduleModal({
  open,
  onClose,
  initialPrompt,
}: {
  open: boolean;
  onClose: () => void;
  initialPrompt: string;
}) {
  const createSchedule = useChatStore((s) => s.createSchedule);
  const selectSession = useChatStore((s) => s.selectSession);

  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState(initialPrompt);
  const [kind, setKind] = useState<ScheduleCadence["kind"]>("daily");
  const [time, setTime] = useState("09:00");
  const [weekday, setWeekday] = useState(1);
  const [notifyEmail, setNotifyEmail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPrompt(initialPrompt);
      setName("");
      setKind("daily");
      setTime("09:00");
      setWeekday(1);
      setNotifyEmail(false);
      setErr(null);
    }
  }, [open, initialPrompt]);

  if (!open) return null;

  const cadence: ScheduleCadence =
    kind === "weekly"
      ? { kind: "weekly", time, weekday }
      : { kind, time };

  async function submit() {
    if (!prompt.trim()) {
      setErr("Prompt can't be empty.");
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const result = await createSchedule({
        name: name.trim() || undefined,
        prompt: prompt.trim(),
        cadence,
        notifyEmail,
      });
      if (!result) {
        setErr("Couldn't create schedule. Check the server logs.");
        return;
      }
      // Open the newly created pinned thread so the user lands on it.
      await selectSession(result.sessionId);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  // Preview line: human-readable cadence summary.
  const preview = (() => {
    const fmtTime = (t: string) => {
      const [h, m] = t.split(":").map(Number);
      const ap = h >= 12 ? "PM" : "AM";
      const hh = ((h + 11) % 12) + 1;
      return `${hh}:${m.toString().padStart(2, "0")} ${ap}`;
    };
    if (kind === "daily") return `Every day at ${fmtTime(time)}`;
    if (kind === "weekdays") return `Mon–Fri at ${fmtTime(time)}`;
    const dayLabel =
      WEEKDAYS.find((d) => d.value === weekday)?.label ?? "Mon";
    return `Every ${dayLabel} at ${fmtTime(time)}`;
  })();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md mx-4 rounded-2xl bg-bg-elevated/98 backdrop-blur-xl surface-lift animate-enter"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-3 top-3 w-8 h-8 rounded-full bg-surface hover:bg-surface-hover text-ink-faint hover:text-ink flex items-center justify-center surface-hairline"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="px-6 pt-7 pb-5">
          <div className="flex items-center gap-2 text-kicker mb-2">
            <Sparkles className="h-3 w-3" />
            <span>✦ Schedule a chat</span>
          </div>
          <h2 className="font-display text-h2 text-ink-cream tracking-tight2">
            When should I run this?
          </h2>
          <p className="font-display italic text-body-md text-ink-dim mt-1.5">
            Each fire appends to a pinned rolling thread. {preview}.
          </p>
        </div>

        <div className="px-6 pb-2 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-kicker mb-1.5">Name (optional)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Morning brief"
              className="w-full px-3 py-2 rounded-lg bg-bg-elevated text-body-md text-ink placeholder:text-ink-ghost surface-hairline focus:outline-none focus:ring-1 focus:ring-accent/50"
            />
          </div>

          {/* Prompt */}
          <div>
            <label className="block text-kicker mb-1.5">Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-lg bg-bg-elevated text-body-md text-ink placeholder:text-ink-ghost surface-hairline focus:outline-none focus:ring-1 focus:ring-accent/50 resize-none"
            />
          </div>

          {/* Cadence */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-kicker mb-1.5">Cadence</label>
              <div className="relative">
                <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint pointer-events-none" />
                <select
                  value={kind}
                  onChange={(e) =>
                    setKind(e.target.value as ScheduleCadence["kind"])
                  }
                  className="w-full pl-8 pr-3 py-2 rounded-lg bg-bg-elevated text-body-md text-ink surface-hairline focus:outline-none focus:ring-1 focus:ring-accent/50 appearance-none"
                >
                  {CADENCE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-kicker mb-1.5">Time</label>
              <div className="relative">
                <Clock className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint pointer-events-none" />
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 rounded-lg bg-bg-elevated text-body-md text-ink surface-hairline focus:outline-none focus:ring-1 focus:ring-accent/50"
                />
              </div>
            </div>
          </div>

          {kind === "weekly" ? (
            <div>
              <label className="block text-kicker mb-1.5">Day of week</label>
              <div className="flex gap-1">
                {WEEKDAYS.map((d) => (
                  <button
                    key={d.value}
                    onClick={() => setWeekday(d.value)}
                    className={`flex-1 px-2 py-1.5 rounded-md text-caption transition-colors ${
                      weekday === d.value
                        ? "bg-accent/[0.12] text-accent surface-hairline"
                        : "bg-bg-elevated/50 text-ink-faint hover:bg-surface hover:text-ink"
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="rounded-lg bg-bg-elevated/40 px-3.5 py-3 surface-hairline">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={notifyEmail}
                onChange={(e) => setNotifyEmail(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded accent-accent cursor-pointer"
              />
              <span className="flex-1">
                <span className="flex items-center gap-1.5 text-body-md text-ink font-medium">
                  <Mail className="h-3.5 w-3.5 text-ink-faint" />
                  Email me when this fires
                </span>
                <span className="block mt-0.5 text-caption text-ink-faint font-display italic">
                  {process.env.NEXT_PUBLIC_USER_EMAIL
                    ? `Sends inline summary + artifact attachment to ${process.env.NEXT_PUBLIC_USER_EMAIL}.`
                    : "Sends inline summary + artifact attachment to USER_EMAIL (set this env var to enable real delivery; otherwise mocked)."}
                </span>
              </span>
            </label>
          </div>

          {err ? (
            <div className="text-caption text-red-300">{err}</div>
          ) : null}
        </div>

        <div className="px-6 py-5 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 rounded-lg bg-surface hover:bg-surface-hover text-body-md text-ink-dim hover:text-ink surface-hairline disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={submitting || !prompt.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-ink text-bg-deep text-body-md font-medium hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Scheduling…
              </>
            ) : (
              <>Schedule</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
