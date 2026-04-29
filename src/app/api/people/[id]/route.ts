import { NextResponse } from "next/server";
import { getEngineerProfile } from "@/lib/modules/people-intel";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const profile = await getEngineerProfile(id);
  if (!profile) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ profile });
}
