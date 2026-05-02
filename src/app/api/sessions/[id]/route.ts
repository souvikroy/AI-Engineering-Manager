/**
 * /api/sessions/[id] — get a session's full message+artifact bundle, rename,
 * or delete.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { StoredMsg, ChatArtifact } from "@/lib/chat/store";

export const dynamic = "force-dynamic";

type SessionPayload = {
  messages: StoredMsg[];
  artifacts: Record<string, ChatArtifact>;
};

function safeParse(s: string): SessionPayload {
  try {
    const parsed = JSON.parse(s) as Partial<SessionPayload>;
    return {
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      artifacts:
        parsed.artifacts && typeof parsed.artifacts === "object"
          ? parsed.artifacts
          : {},
    };
  } catch {
    return { messages: [], artifacts: {} };
  }
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const row = await prisma.chatSession.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { messages, artifacts } = safeParse(row.messages);
  return NextResponse.json({
    id: row.id,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    messages,
    artifacts,
  });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { title?: string };
  if (!body.title || !body.title.trim()) {
    return NextResponse.json({ error: "title_required" }, { status: 400 });
  }
  const updated = await prisma.chatSession
    .update({
      where: { id },
      data: { title: body.title.slice(0, 120) },
    })
    .catch(() => null);
  if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({
    id: updated.id,
    title: updated.title,
    updatedAt: updated.updatedAt.toISOString(),
    createdAt: updated.createdAt.toISOString(),
  });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  await prisma.chatSession.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
