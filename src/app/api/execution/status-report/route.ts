import { NextResponse } from "next/server";
import { generateStatusReport } from "@/lib/modules/execution-tower";

export const dynamic = "force-dynamic";

export async function POST() {
  const report = await generateStatusReport();
  return NextResponse.json({ report });
}
