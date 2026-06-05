/**
 * /api/schedules — list + create scheduled chats.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  initScheduler,
  parseCadence,
  registerSchedule,
  type Cadence,
} from "@/lib/schedule/scheduler";

export const dynamic = "force-dynamic";

export async function GET() {
  // Lazy boot: first request that touches schedules hydrates timers from DB.
  // No-op on subsequent calls. Avoids the Next.js instrumentation/webpack
  // bundling pain of pulling node:fs into an Edge-runtime build.
  await initScheduler().catch(() => {});
  const rows = await prisma.schedule.findMany({
    orderBy: [{ paused: "asc" }, { nextFireAt: "asc" }],
    include: { session: { select: { id: true, title: true, updatedAt: true } } },
  });
  return NextResponse.json({
    schedules: rows.map((r) => ({
      id: r.id,
      name: r.name,
      prompt: r.prompt,
      cadence: r.cadence,
      tz: r.tz,
      paused: r.paused,
      prewarmOffsetMin: r.prewarmOffsetMin,
      notifyEmail: r.notifyEmail,
      lastFiredAt: r.lastFiredAt?.toISOString() ?? null,
      nextFireAt: r.nextFireAt?.toISOString() ?? null,
      sessionId: r.session?.id ?? null,
      sessionTitle: r.session?.title ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  });
}

type CreateBody = {
  name?: string;
  prompt: string;
  cadence: Cadence;
  tz?: string;
  prewarmOffsetMin?: number;
  notifyEmail?: boolean;
};

export async function POST(req: Request) {
  await initScheduler().catch(() => {});
  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.prompt?.trim()) {
    return NextResponse.json({ error: "prompt_required" }, { status: 400 });
  }
  const cadenceJson = JSON.stringify(body.cadence);
  if (!parseCadence(cadenceJson)) {
    return NextResponse.json(
      {
        error: "invalid_cadence",
        hint: "Expected { kind: 'daily'|'weekdays'|'weekly', time: 'HH:MM', weekday?: 0..6 }",
      },
      { status: 400 },
    );
  }
  const name =
    (body.name ?? body.prompt).trim().slice(0, 80) || "Scheduled chat";
  const created = await prisma.schedule.create({
    data: {
      name,
      prompt: body.prompt.trim(),
      cadence: cadenceJson,
      tz: body.tz ?? "local",
      prewarmOffsetMin: body.prewarmOffsetMin ?? 10,
      notifyEmail: body.notifyEmail ?? false,
    },
  });
  // Eagerly create the pinned rolling thread so the sidebar can show it
  // before the first fire happens. Subsequent fires append into this thread.
  const session = await prisma.chatSession.create({
    data: {
      title: created.name,
      messages: JSON.stringify({ messages: [], artifacts: {} }),
      pinned: true,
      scheduleId: created.id,
    },
  });
  // Arm the timer immediately — no need to wait for next boot.
  try {
    registerSchedule(created);
  } catch (e) {
    console.warn("[schedules] register failed:", (e as Error).message);
  }
  return NextResponse.json({
    id: created.id,
    name: created.name,
    prompt: created.prompt,
    cadence: created.cadence,
    tz: created.tz,
    paused: created.paused,
    prewarmOffsetMin: created.prewarmOffsetMin,
    lastFiredAt: null,
    nextFireAt: null, // registerSchedule writes asynchronously; client refetches
    sessionId: session.id,
    createdAt: created.createdAt.toISOString(),
  });
}
