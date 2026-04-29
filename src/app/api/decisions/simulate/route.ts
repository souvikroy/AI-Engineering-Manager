import { NextResponse } from "next/server";
import { simulate } from "@/lib/modules/decision-engine";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { optionA, optionB, context } = (await req.json()) as { optionA: string; optionB: string; context: string };
  if (!optionA || !optionB) return NextResponse.json({ error: "Both options required" }, { status: 400 });
  const result = await simulate(optionA, optionB, context ?? "");
  return NextResponse.json(result);
}
