import { NextResponse } from "next/server";
import { generateOneOnOneAgenda } from "@/lib/modules/people-intel";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const agenda = await generateOneOnOneAgenda(id);
  return NextResponse.json({ agenda });
}
