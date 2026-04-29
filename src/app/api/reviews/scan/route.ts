import { NextResponse } from "next/server";
import { github } from "@/lib/adapters";
import { reviewPR } from "@/lib/modules/pr-review";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { repo?: string; prNumber?: number; postToGitHub?: boolean };
  const repo = body.repo ?? process.env.GITHUB_REPO;
  if (!repo) return NextResponse.json({ error: "GITHUB_REPO not set and no repo in request" }, { status: 400 });

  if (body.prNumber) {
    try {
      const review = await reviewPR({ repo, prNumber: body.prNumber, postToGitHub: body.postToGitHub ?? false });
      return NextResponse.json({ reviewed: [review], errors: [] });
    } catch (err) {
      return NextResponse.json({ reviewed: [], errors: [{ pr: body.prNumber, message: (err as Error).message }] }, { status: 500 });
    }
  }

  const open = await github.listOpenPRs(repo);
  const reviewed: unknown[] = [];
  const errors: { pr: number; message: string }[] = [];
  for (const pr of open.slice(0, 5)) {
    try {
      const review = await reviewPR({ repo, prNumber: pr.number, postToGitHub: body.postToGitHub ?? false });
      reviewed.push({ prNumber: pr.number, prTitle: pr.title, ...review });
    } catch (err) {
      errors.push({ pr: pr.number, message: (err as Error).message });
    }
  }
  return NextResponse.json({ reviewed, errors });
}
