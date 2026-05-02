/**
 * /api/sessions — list + create chat sessions.
 *
 * Backed by the existing ChatSession Prisma row. messages is a JSON column
 * (string-typed in SQLite); we never read/write the messages here — that's
 * scoped to /api/chat (write) and /api/sessions/[id] (read).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await prisma.chatSession.findMany({
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      title: true,
      updatedAt: true,
      createdAt: true,
      pinned: true,
      scheduleId: true,
    },
    take: 100,
  });
  return NextResponse.json({
    sessions: rows.map((r) => ({
      id: r.id,
      title: r.title,
      updatedAt: r.updatedAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
      pinned: r.pinned,
      scheduleId: r.scheduleId,
    })),
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { title?: string };
  const title = (body.title ?? "New chat").slice(0, 120);
  const created = await prisma.chatSession.create({
    data: { title, messages: JSON.stringify([]) },
  });
  return NextResponse.json({
    id: created.id,
    title: created.title,
    updatedAt: created.updatedAt.toISOString(),
    createdAt: created.createdAt.toISOString(),
    messages: [],
    artifacts: {},
  });
}
