import fs from "node:fs";
import path from "node:path";
import { jira } from "@/lib/adapters";
import { complete } from "@/lib/anthropic";
import { prisma } from "@/lib/prisma";

export type OKRView = {
  id: string;
  teamId: string;
  teamName: string;
  objective: string;
  keyResults: string[];
  progress: number;
  status: string;
  quarter: string;
};

export async function listOKRs(): Promise<OKRView[]> {
  const okrs = await prisma.oKR.findMany({ include: { team: true } });
  return okrs.map((k) => ({
    id: k.id,
    teamId: k.teamId,
    teamName: k.team.name,
    objective: k.objective,
    keyResults: JSON.parse(k.keyResults) as string[],
    progress: k.progress,
    status: k.status,
    quarter: k.quarter,
  }));
}

export async function uncoveredWork(): Promise<{ ticket: string; reason: string }[]> {
  const file = path.resolve(process.cwd(), "data/okrs.json");
  if (!fs.existsSync(file)) return [];
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { uncovered_work?: { ticket: string; reason: string }[] };
  return raw.uncovered_work ?? [];
}

export async function generateStatusReport(): Promise<{ headline: string; progress: string[]; risks: string[]; decisionsNeeded: string[] }> {
  const okrs = await listOKRs();
  const tickets = await jira.tickets();
  const uncovered = await uncoveredWork();

  const system = `You write a leadership status update for an engineering org.
Be specific, ground every statement in the data provided. No fluff.
Voice: senior leader briefing the CEO.
Output STRICT JSON only:
{ "headline": "<one sentence>", "progress": ["..."], "risks": ["..."], "decisionsNeeded": ["..."] }`;

  const user = JSON.stringify({ okrs, tickets, uncovered }, null, 2);

  const out = await complete({
    model: "reasoning",
    system,
    messages: [{ role: "user", content: user }],
    maxTokens: 1500,
    temperature: 0.2,
  });

  const j = parseJSON(out);
  return {
    headline: j.headline ?? "",
    progress: j.progress ?? [],
    risks: j.risks ?? [],
    decisionsNeeded: j.decisionsNeeded ?? [],
  };
}

export async function rebalancePriorities(): Promise<{ delay: { item: string; reason: string }[]; accelerate: { item: string; reason: string }[] }> {
  const okrs = await listOKRs();
  const tickets = await jira.tickets();
  const system = `You are an engineering chief of staff proposing priority adjustments based on OKR coverage and current sprint state.
Be honest about trade-offs. Reference specific Jira keys and OKR IDs.
Output STRICT JSON: { "delay": [ { "item": "...", "reason": "..." } ], "accelerate": [ { "item": "...", "reason": "..." } ] }`;
  const user = JSON.stringify({ okrs, tickets }, null, 2);
  const out = await complete({
    model: "reasoning",
    system,
    messages: [{ role: "user", content: user }],
    maxTokens: 1500,
    temperature: 0.2,
  });
  const j = parseJSON(out);
  return { delay: j.delay ?? [], accelerate: j.accelerate ?? [] };
}

function parseJSON(text: string): { headline?: string; progress?: string[]; risks?: string[]; decisionsNeeded?: string[]; delay?: { item: string; reason: string }[]; accelerate?: { item: string; reason: string }[] } {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return {};
  try {
    return JSON.parse(m[0]);
  } catch {
    return {};
  }
}
