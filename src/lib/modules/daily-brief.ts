import { jira, monitoring, slack, standups } from "@/lib/adapters";
import { complete } from "@/lib/anthropic";
import { prisma } from "@/lib/prisma";

export type Signal = { kind: string; engineerId?: string; team?: string; detail: string };

export type Brief = {
  date: string;
  asOfISO: string;
  signals: Signal[];
  narrative: string;
  blockers: { engineerId: string; team: string; reason: string }[];
  sprintRisk: { team: string; level: "low" | "medium" | "high"; reason: string }[];
  productivityAnomalies: Signal[];
  incidentDigest: string;
};

export async function generateBrief(date: string): Promise<Brief> {
  const [updates, tickets, sprints, alerts, services, hesitation, slackMessages] = await Promise.all([
    standups.forDate(date),
    jira.tickets(),
    jira.sprints(),
    monitoring.alerts({ open: true }),
    monitoring.services(),
    slack.hesitationSignals(),
    slack.recentMessages(),
  ]);

  const signals: Signal[] = [];
  for (const t of tickets) {
    if (t.lastMovedDays >= 4 && t.status !== "Done") {
      signals.push({ kind: "stalled_ticket", engineerId: t.assigneeId, team: t.team, detail: `${t.key} "${t.title}" — no movement in ${t.lastMovedDays}d, status: ${t.status}` });
    }
  }
  for (const u of updates) {
    if (u.blockers && u.blockers.toLowerCase() !== "none." && u.blockers.toLowerCase() !== "none") {
      signals.push({ kind: "explicit_blocker", engineerId: u.engineerId, detail: u.blockers });
    }
  }
  for (const h of hesitation) {
    signals.push({ kind: `hesitation_${h.signal}`, engineerId: h.engineerId, detail: h.detail });
  }
  for (const s of services) {
    if (s.sli_latency_p99_ms != null && s.sli_latency_p99_target_ms != null && s.sli_latency_p99_ms > s.sli_latency_p99_target_ms) {
      signals.push({ kind: "slo_breach", team: s.team, detail: `${s.name} p99 latency ${s.sli_latency_p99_ms}ms > target ${s.sli_latency_p99_target_ms}ms` });
    }
    if (s.sli_crash_free_pct != null && s.sli_crash_free_target_pct != null && s.sli_crash_free_pct < s.sli_crash_free_target_pct) {
      signals.push({ kind: "crash_free_below_target", team: s.team, detail: `${s.name} crash-free ${s.sli_crash_free_pct}% < target ${s.sli_crash_free_target_pct}%` });
    }
  }
  for (const a of alerts) {
    signals.push({ kind: "open_incident", team: services.find((s) => s.name === a.service)?.team, detail: `[${a.severity.toUpperCase()}] ${a.title} (owner: ${a.ownerId})` });
  }

  const sprintProgress = sprints.map((sp) => {
    const t = tickets.filter((x) => x.sprintId === sp.id);
    const total = t.length;
    const done = t.filter((x) => x.status === "Done").length;
    return { sprint: sp, total, done, pct: total ? done / total : 0 };
  });

  const system = `You are a calm, senior engineering chief of staff. Produce structured insight from the signals provided.
Cite engineers and tickets by ID. Do not invent facts beyond the input. Prefer specific over generic.
Output STRICT JSON of this shape:
{
  "narrative": "<2-4 sentence cross-team status, in plain English>",
  "blockers": [ { "engineerId": "...", "team": "...", "reason": "..." } ],
  "sprintRisk": [ { "team": "team-platform|team-mobile|team-growth", "level": "low|medium|high", "reason": "..." } ],
  "productivityAnomalies": [ { "kind": "...", "engineerId": "...", "detail": "..." } ],
  "incidentDigest": "<one paragraph summarizing the open alerts>"
}
Reply with the JSON object only, no surrounding text.`;

  const user = JSON.stringify({ date, signals, sprintProgress, slackMessages: slackMessages.slice(-25), updates }, null, 2);

  const text = await complete({
    model: "reasoning",
    system,
    messages: [{ role: "user", content: user }],
    maxTokens: 1500,
    temperature: 0.2,
  });

  const json = parseJSON(text);

  const brief: Brief = {
    date,
    asOfISO: new Date().toISOString(),
    signals,
    narrative: json.narrative ?? "Brief unavailable.",
    blockers: json.blockers ?? [],
    sprintRisk: json.sprintRisk ?? [],
    productivityAnomalies: json.productivityAnomalies ?? [],
    incidentDigest: json.incidentDigest ?? "",
  };

  await prisma.briefSnapshot.create({
    data: { date: new Date(date), content: JSON.stringify(brief) },
  });

  return brief;
}

export async function getLatestBrief(): Promise<Brief | null> {
  const row = await prisma.briefSnapshot.findFirst({ orderBy: { createdAt: "desc" } });
  if (!row) return null;
  return JSON.parse(row.content) as Brief;
}

function parseJSON(text: string): {
  narrative?: string;
  blockers?: Brief["blockers"];
  sprintRisk?: Brief["sprintRisk"];
  productivityAnomalies?: Signal[];
  incidentDigest?: string;
} {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    return JSON.parse(match[0]);
  } catch {
    return {};
  }
}
