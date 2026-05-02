/**
 * /api/schedules/[id] — pause/resume, edit, delete, run-now.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  initScheduler,
  parseCadence,
  registerSchedule,
  unregisterSchedule,
  fireScheduleNow,
  type Cadence,
} from "@/lib/schedule/scheduler";

export const dynamic = "force-dynamic";

async function ensureBoot() {
  await initScheduler().catch(() => {});
}

type PatchBody = {
  name?: string;
  prompt?: string;
  cadence?: Cadence;
  paused?: boolean;
  prewarmOffsetMin?: number;
  notifyEmail?: boolean;
  /** Pass `run_now: true` to fire immediately (bypassing the scheduled time). */
  run_now?: boolean;
};

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await ensureBoot();
  const { id } = await ctx.params;
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (body.run_now) {
    void fireScheduleNow(id).catch((e) =>
      console.warn("[schedules] run_now failed:", (e as Error).message),
    );
    return NextResponse.json({ ok: true, kicked: true });
  }

  const data: Record<string, unknown> = {};
  if (body.name) data.name = body.name.slice(0, 80);
  if (body.prompt) data.prompt = body.prompt;
  if (body.cadence) {
    const cj = JSON.stringify(body.cadence);
    if (!parseCadence(cj)) {
      return NextResponse.json({ error: "invalid_cadence" }, { status: 400 });
    }
    data.cadence = cj;
  }
  if (typeof body.paused === "boolean") data.paused = body.paused;
  if (typeof body.prewarmOffsetMin === "number")
    data.prewarmOffsetMin = body.prewarmOffsetMin;
  if (typeof body.notifyEmail === "boolean") data.notifyEmail = body.notifyEmail;

  const updated = await prisma.schedule
    .update({ where: { id }, data })
    .catch(() => null);
  if (!updated)
    return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Re-arm timers based on the new state.
  if (updated.paused) {
    unregisterSchedule(updated.id);
  } else {
    registerSchedule(updated);
  }

  return NextResponse.json({
    id: updated.id,
    name: updated.name,
    prompt: updated.prompt,
    cadence: updated.cadence,
    paused: updated.paused,
    prewarmOffsetMin: updated.prewarmOffsetMin,
    lastFiredAt: updated.lastFiredAt?.toISOString() ?? null,
    nextFireAt: updated.nextFireAt?.toISOString() ?? null,
    updatedAt: updated.updatedAt.toISOString(),
  });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await ensureBoot();
  const { id } = await ctx.params;
  unregisterSchedule(id);
  await prisma.schedule.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
