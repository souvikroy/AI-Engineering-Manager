import { NextResponse } from "next/server";
import { analyzeDesignDoc, readDesignDoc } from "@/lib/modules/decision-engine";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json()) as { slug?: string; content?: string; title?: string };

  let title = body.title ?? "Untitled";
  let content = body.content ?? "";

  if (body.slug) {
    const doc = await readDesignDoc(body.slug);
    if (!doc) return NextResponse.json({ error: "Doc not found" }, { status: 404 });
    title = doc.title;
    content = doc.content;
  }

  if (!content) return NextResponse.json({ error: "No content or slug provided" }, { status: 400 });

  const analysis = await analyzeDesignDoc(content, title);
  return NextResponse.json({ analysis });
}
