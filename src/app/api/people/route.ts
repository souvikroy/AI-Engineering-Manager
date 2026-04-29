import { NextResponse } from "next/server";
import { listEngineers } from "@/lib/modules/people-intel";

export async function GET() {
  return NextResponse.json({ engineers: await listEngineers() });
}
