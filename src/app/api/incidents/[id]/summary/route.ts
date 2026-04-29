import { NextResponse } from "next/server";
import { summarizeIncident } from "@/lib/modules/interrupt-memory";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return NextResponse.json({ summary: await summarizeIncident(id) });
}
