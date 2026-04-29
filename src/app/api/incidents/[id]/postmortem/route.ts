import { NextResponse } from "next/server";
import { generatePostmortem } from "@/lib/modules/interrupt-memory";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const pm = await generatePostmortem(id);
  return NextResponse.json({ postmortem: pm });
}
