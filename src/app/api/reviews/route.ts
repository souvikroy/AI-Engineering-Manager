import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const reviews = await prisma.pRReview.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { findings: true },
  });
  return NextResponse.json({ reviews });
}
