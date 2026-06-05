/**
 * In-process daily scheduler.
 *
 * On Next.js boot, hydrates active Schedule rows from Prisma and sets
 * setTimeout timers for each. When a timer fires, it:
 *
 *   1. Looks up (or creates) the rolling pinned ChatSession bound to the schedule.
 *   2. Constructs a stamped user message ("[Auto-fired 2026-05-03 09:00] …").
 *   3. POSTs to /api/chat internally so the existing tool-use loop runs and
 *      persistence (pills, citations, verdict, sources_checked, artifact)
 *      writes back into the same rolling thread.
 *   4. Computes the next fire time and re-arms the timer.
 *
 * A second timer per schedule pre-warms data (regenerate today's brief +
 * pythonHealth()/getFreshness()) `prewarmOffsetMin` minutes before each fire,
 * so the scheduled answer reads fresh sources without paying the regen cost
 * during the user-visible turn.
 *
 * Caveats: in-process means restarts kill the timers; the next boot rehydrates
 * but no catch-up. (User explicitly chose this trade-off.)
 */
import type { Schedule } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateBrief } from "@/lib/modules/daily-brief";
import { getFreshness, pythonHealth } from "@/lib/python";
import { sendScheduleEmail } from "@/lib/email/schedule-email";
import type { ChatArtifact, StoredMsg } from "@/lib/chat/store";

export type Cadence =
  | { kind: "daily"; time: string }
  | { kind: "weekdays"; time: string }
  | { kind: "weekly"; time: string; weekday: number /* 0=Sun..6=Sat */ };

export function parseCadence(json: string): Cadence | null {
  try {
    const c = JSON.parse(json) as Cadence;
    if (typeof c !== "object" || c === null) return null;
    if (!isHHMM(c.time)) return null;
    if (c.kind === "daily" || c.kind === "weekdays") return c;
    if (
      c.kind === "weekly" &&
      typeof c.weekday === "number" &&
      c.weekday >= 0 &&
      c.weekday <= 6
    )
      return c;
    return null;
  } catch {
    return null;
  }
}

function isHHMM(s: unknown): s is string {
  return typeof s === "string" && /^\d{2}:\d{2}$/.test(s);
}

/**
 * Compute the next fire date for a cadence, strictly after `after`.
 * Uses local server time — for the laptop demo the server TZ matches the
 * user's browser TZ, so HH:MM lines up with what the user expects.
 */
export function nextFireDate(cadence: Cadence, after: Date): Date {
  const [h, m] = cadence.time.split(":").map(Number);
  const next = new Date(after);
  next.setSeconds(0, 0);
  next.setHours(h, m, 0, 0);
  if (next.getTime() <= after.getTime()) next.setDate(next.getDate() + 1);
  if (cadence.kind === "weekdays") {
    // Skip Saturday (6) and Sunday (0) — advance to Monday.
    while (next.getDay() === 0 || next.getDay() === 6) {
      next.setDate(next.getDate() + 1);
    }
  } else if (cadence.kind === "weekly") {
    while (next.getDay() !== cadence.weekday) {
      next.setDate(next.getDate() + 1);
    }
  }
  return next;
}

// ── Runtime registry ────────────────────────────────────────────────

const fireTimers = new Map<string, NodeJS.Timeout>();
const warmTimers = new Map<string, NodeJS.Timeout>();
let initialized = false;

export async function initScheduler(): Promise<void> {
  if (initialized) return;
  initialized = true;
  const active = await prisma.schedule
    .findMany({ where: { paused: false } })
    .catch(() => []);
  for (const s of active) registerSchedule(s);
  console.log(
    `[scheduler] initialized with ${active.length} active schedule(s)`,
  );
}

export function registerSchedule(s: Schedule): void {
  unregisterSchedule(s.id);
  const cadence = parseCadence(s.cadence);
  if (!cadence) {
    console.warn(`[scheduler] skipping ${s.id}: invalid cadence`);
    return;
  }
  const now = new Date();
  const fireAt = nextFireDate(cadence, now);
  const fireMs = fireAt.getTime() - now.getTime();
  const offset = Math.max(0, s.prewarmOffsetMin ?? 0);
  const warmMs = fireMs - offset * 60_000;

  // Persist nextFireAt so the UI can show "Next fire in 4h 12m".
  void prisma.schedule
    .update({ where: { id: s.id }, data: { nextFireAt: fireAt } })
    .catch(() => {});

  if (warmMs > 0 && offset > 0) {
    warmTimers.set(
      s.id,
      setTimeout(() => {
        void warmSchedule(s.id);
      }, warmMs),
    );
  }
  fireTimers.set(
    s.id,
    setTimeout(() => {
      void fireSchedule(s.id);
    }, fireMs),
  );
}

export function unregisterSchedule(id: string): void {
  const ft = fireTimers.get(id);
  if (ft) clearTimeout(ft);
  fireTimers.delete(id);
  const wt = warmTimers.get(id);
  if (wt) clearTimeout(wt);
  warmTimers.delete(id);
}

// ── Pre-warm ────────────────────────────────────────────────────────

async function warmSchedule(id: string): Promise<void> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    // Brief regen — quietly. If it fails (e.g. no model key), the on-demand
    // path still scopes to today's window.
    void generateBrief(today).catch(() => {});
    if (await pythonHealth()) {
      void getFreshness().catch(() => {});
    }
    console.log(`[scheduler] pre-warmed for ${id}`);
  } catch (e) {
    console.warn(
      `[scheduler] pre-warm failed for ${id}:`,
      (e as Error).message,
    );
  }
}

// ── Fire ────────────────────────────────────────────────────────────

type StoredPayload = {
  messages: { role: "user" | "assistant"; content: string }[];
  artifacts: Record<string, unknown>;
};

async function fireSchedule(id: string): Promise<void> {
  let s: Schedule | null = null;
  try {
    s = await prisma.schedule.findUnique({ where: { id } });
    if (!s || s.paused) return;

    // Find or create the rolling thread bound to this schedule.
    let session = await prisma.chatSession.findUnique({
      where: { scheduleId: id },
    });
    if (!session) {
      session = await prisma.chatSession.create({
        data: {
          title: s.name,
          messages: JSON.stringify({ messages: [], artifacts: {} }),
          pinned: true,
          scheduleId: id,
        },
      });
    }

    // Build the auto-fire-stamped user prompt. The stamp doubles as the
    // dated separator the user sees when scrolling back through the thread.
    const stamp = formatLocalStamp(new Date());
    const taggedPrompt = `[Auto-fired ${stamp} local]\n\n${s.prompt}`;

    // Read existing turns so we can send the chat history. Without this the
    // model loses prior context across days, defeating the rolling-thread point.
    let payload: StoredPayload;
    try {
      const parsed = JSON.parse(session.messages) as Partial<StoredPayload>;
      payload = {
        messages: Array.isArray(parsed.messages) ? parsed.messages : [],
        artifacts:
          parsed.artifacts && typeof parsed.artifacts === "object"
            ? parsed.artifacts
            : {},
      };
    } catch {
      payload = { messages: [], artifacts: {} };
    }

    const history = payload.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const allMessages = [
      ...history,
      { role: "user" as const, content: taggedPrompt },
    ];

    // POST to /api/chat internally — reuses tool-use loop, NDJSON streaming,
    // and the persistTurn write-back into this same session.
    const port = process.env.PORT ?? "3000";
    const url = `http://127.0.0.1:${port}/api/chat`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: allMessages,
        session_id: session.id,
      }),
    });
    if (res.body) {
      // Drain the NDJSON stream so persistTurn has run by the time we exit.
      const reader = res.body.getReader();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    }

    await prisma.schedule.update({
      where: { id },
      data: { lastFiredAt: new Date() },
    });
    console.log(`[scheduler] fired ${id}`);

    // ── Optional email notification ────────────────────────────────
    // Re-read the session to find the assistant message + linked artifact
    // that the chat route just persisted. Send is best-effort: failures
    // log a warning, never throw.
    if (s.notifyEmail) {
      try {
        await emailLatestTurn(s, session.id, new Date());
      } catch (e) {
        console.warn(
          `[scheduler] email notify failed for ${id}:`,
          (e as Error).message,
        );
      }
    }
  } catch (e) {
    console.warn(
      `[scheduler] fire failed for ${id}:`,
      (e as Error).message,
    );
  } finally {
    // Always re-arm — a failure today shouldn't kill tomorrow's fire.
    const fresh = await prisma.schedule
      .findUnique({ where: { id } })
      .catch(() => null);
    if (fresh && !fresh.paused) registerSchedule(fresh);
  }
}

// ── Email notification ─────────────────────────────────────────────

/**
 * Read the most-recently-appended assistant message + linked artifact
 * from the schedule's pinned thread, then ship as an email via Resend.
 */
async function emailLatestTurn(
  schedule: Schedule,
  sessionId: string,
  firedAt: Date,
): Promise<void> {
  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
  });
  if (!session) return;
  let payload: { messages: StoredMsg[]; artifacts: Record<string, ChatArtifact> };
  try {
    const parsed = JSON.parse(session.messages) as Partial<{
      messages: StoredMsg[];
      artifacts: Record<string, ChatArtifact>;
    }>;
    payload = {
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      artifacts:
        parsed.artifacts && typeof parsed.artifacts === "object"
          ? parsed.artifacts
          : {},
    };
  } catch {
    return;
  }
  // The latest assistant message is the one we just persisted.
  const lastAssistant = [...payload.messages]
    .reverse()
    .find((m) => m.role === "assistant");
  if (!lastAssistant) return;

  const artifact =
    lastAssistant.artifact_id && payload.artifacts[lastAssistant.artifact_id]
      ? payload.artifacts[lastAssistant.artifact_id]
      : null;

  const result = await sendScheduleEmail({
    schedule,
    assistant: lastAssistant,
    artifact,
    sessionId,
    firedAt,
  });
  if (result.ok) {
    console.log(
      `[scheduler] emailed schedule ${schedule.id} → ${result.id}${result.mocked ? " (mocked)" : ""}`,
    );
  } else if (result.reason === "no_recipient") {
    console.warn(
      `[scheduler] email skipped for ${schedule.id}: USER_EMAIL not set`,
    );
  } else {
    console.warn(
      `[scheduler] email failed for ${schedule.id}:`,
      result.error ?? "unknown",
    );
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function formatLocalStamp(d: Date): string {
  // YYYY-MM-DD HH:MM (no TZ suffix — local clock)
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${dd} ${h}:${m}`;
}

/** Force a schedule to fire now. Used by the API for manual "run now". */
export async function fireScheduleNow(id: string): Promise<void> {
  await fireSchedule(id);
}
