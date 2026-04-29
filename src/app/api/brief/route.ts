import { NextResponse } from "next/server";
import { generateBrief, getLatestBrief } from "@/lib/modules/daily-brief";

export const dynamic = "force-dynamic";

export async function GET() {
  const brief = await getLatestBrief();
  return NextResponse.json({ brief });
}

export async function POST(req: Request) {
  const { date } = (await req.json().catch(() => ({}))) as { date?: string };
  const today = date ?? new Date().toISOString().slice(0, 10);
  const brief = await generateBrief(today);
  return NextResponse.json({ brief });
}
