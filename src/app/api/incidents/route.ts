import { NextResponse } from "next/server";
import { listIncidents } from "@/lib/modules/interrupt-memory";

export async function GET() {
  return NextResponse.json({ incidents: await listIncidents() });
}
