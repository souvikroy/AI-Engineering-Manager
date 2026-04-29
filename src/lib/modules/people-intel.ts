import { jira, slack } from "@/lib/adapters";
import { complete } from "@/lib/anthropic";
import { prisma } from "@/lib/prisma";

export type EngineerProfile = {
  id: string;
  name: string;
  team: string;
  level: string;
  oneOnOnes: { date: string; topics: string; commitments: string; sentiment: string; notes: string }[];
  recentTickets: { key: string; title: string; status: string; lastMovedDays: number }[];
  slackTone: { engineerId: string; signal: string; detail: string }[];
  flags: { kind: string; detail: string }[];
};

export async function getEngineerProfile(engineerId: string): Promise<EngineerProfile | null> {
  const eng = await prisma.engineer.findUnique({ where: { id: engineerId }, include: { team: true, oneOnOnes: { orderBy: { date: "desc" }, take: 6 } } });
  if (!eng) return null;
  const tickets = await jira.tickets({ assigneeId: engineerId });
  const hesitation = (await slack.hesitationSignals()).filter((s) => s.engineerId === engineerId);

  const flags: { kind: string; detail: string }[] = [];
  if (tickets.some((t) => t.lastMovedDays >= 5 && t.status !== "Done")) flags.push({ kind: "stalled_ticket", detail: "One or more tickets have not moved in 5+ days." });
  if (hesitation.length > 0) flags.push({ kind: "hesitation_signal", detail: hesitation.map((h) => h.signal).join(", ") });

  return {
    id: eng.id,
    name: eng.name,
    team: eng.team.name,
    level: eng.level,
    oneOnOnes: eng.oneOnOnes.map((o) => ({ date: o.date.toISOString().slice(0, 10), topics: o.topics, commitments: o.commitments, sentiment: o.sentiment, notes: o.notes })),
    recentTickets: tickets.map((t) => ({ key: t.key, title: t.title, status: t.status, lastMovedDays: t.lastMovedDays })),
    slackTone: hesitation,
    flags,
  };
}

export async function generateOneOnOneAgenda(engineerId: string): Promise<{ agenda: string[]; questions: string[]; growthOpportunities: string[]; concerns: string[] }> {
  const profile = await getEngineerProfile(engineerId);
  if (!profile) throw new Error(`Engineer ${engineerId} not found`);

  const system = `You are an experienced engineering manager preparing a 1:1 with one of your reports.
Generate a focused 25-minute agenda based on the profile data.
Be specific to this person — don't produce generic items. Reference open commitments and recent signals.
Output STRICT JSON only:
{ "agenda": ["..."], "questions": ["..."], "growthOpportunities": ["..."], "concerns": ["..."] }`;

  const user = JSON.stringify(profile, null, 2);

  const out = await complete({
    model: "reasoning",
    system,
    messages: [{ role: "user", content: user }],
    maxTokens: 1500,
    temperature: 0.3,
  });

  const j = parseJSON(out);
  return {
    agenda: j.agenda ?? [],
    questions: j.questions ?? [],
    growthOpportunities: j.growthOpportunities ?? [],
    concerns: j.concerns ?? [],
  };
}

export async function listEngineers(): Promise<{ id: string; name: string; team: string; flags: number }[]> {
  const engineers = await prisma.engineer.findMany({ include: { team: true } });
  const hesitation = await slack.hesitationSignals();
  return engineers.map((e) => ({
    id: e.id,
    name: e.name,
    team: e.team.name,
    flags: hesitation.filter((h) => h.engineerId === e.id).length,
  }));
}

function parseJSON(text: string): { agenda?: string[]; questions?: string[]; growthOpportunities?: string[]; concerns?: string[] } {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return {};
  try {
    return JSON.parse(m[0]);
  } catch {
    return {};
  }
}
