import { NextResponse } from "next/server";
import { listOKRs, uncoveredWork } from "@/lib/modules/execution-tower";

export async function GET() {
  const [okrs, uncovered] = await Promise.all([listOKRs(), uncoveredWork()]);
  return NextResponse.json({ okrs, uncovered });
}
