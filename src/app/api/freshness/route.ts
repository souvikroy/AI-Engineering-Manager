import { NextResponse } from "next/server";
import { getFreshness, pythonHealth } from "@/lib/python";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Thin proxy over the Python /freshness endpoint, with a useful
 * "context-engine offline" shape so the UI can render meaningfully even when
 * the Python service is down.
 */
export async function GET() {
  if (!(await pythonHealth())) {
    return NextResponse.json({
      ok: false,
      reason: "python_offline",
      sources: {},
      as_of: new Date().toISOString(),
    });
  }
  try {
    const f = await getFreshness();
    return NextResponse.json({ ok: true, ...f });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      reason: (err as Error).message,
      sources: {},
      as_of: new Date().toISOString(),
    });
  }
}
