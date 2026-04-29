import { NextResponse } from "next/server";
import { rebalancePriorities } from "@/lib/modules/execution-tower";

export const dynamic = "force-dynamic";

export async function POST() {
  const out = await rebalancePriorities();
  return NextResponse.json(out);
}
