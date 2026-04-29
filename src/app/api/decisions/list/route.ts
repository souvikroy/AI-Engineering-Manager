import { NextResponse } from "next/server";
import { listDesignDocs } from "@/lib/modules/decision-engine";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const [docs, decisions] = await Promise.all([
    listDesignDocs(),
    prisma.decision.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  return NextResponse.json({ docs, decisions });
}
