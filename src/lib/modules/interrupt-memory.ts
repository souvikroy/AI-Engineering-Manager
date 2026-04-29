import { complete } from "@/lib/anthropic";
import { prisma } from "@/lib/prisma";
import { monitoring } from "@/lib/adapters";

export type IncidentView = {
  id: string;
  title: string;
  severity: string;
  status: string;
  openedAt: string;
  resolvedAt: string | null;
  ownerId: string | null;
  summary: string;
};

export async function listIncidents(): Promise<IncidentView[]> {
  const rows = await prisma.incident.findMany({ orderBy: { openedAt: "desc" } });
  return rows.map((i) => ({
    id: i.id,
    title: i.title,
    severity: i.severity,
    status: i.status,
    openedAt: i.openedAt.toISOString(),
    resolvedAt: i.resolvedAt?.toISOString() ?? null,
    ownerId: i.ownerId,
    summary: i.summary,
  }));
}

export async function summarizeIncident(incidentId: string): Promise<{ situation: string; suggestedActions: string[]; suggestedOwner: string | null }> {
  const incident = await prisma.incident.findUnique({ where: { id: incidentId }, include: { owner: { include: { team: true } } } });
  if (!incident) throw new Error(`Incident ${incidentId} not found`);
  const services = await monitoring.services();
  const service = services.find((s) => s.name === (JSON.parse(incident.alerts) as { service: string }).service);

  const system = `You are an on-call coordinator. Given an incident, write a 1-2 sentence situation summary, suggest 3-5 next actions, and suggest an owner if not assigned.
Be specific to the service and severity. Don't invent runbooks not implied by the data.
Output STRICT JSON: { "situation": "...", "suggestedActions": ["..."], "suggestedOwner": "<engineerId or null>" }`;
  const user = JSON.stringify({ incident, service }, null, 2);
  const out = await complete({
    model: "reasoning",
    system,
    messages: [{ role: "user", content: user }],
    maxTokens: 1000,
    temperature: 0.2,
  });
  const j = parseJSON(out);
  return { situation: j.situation ?? "", suggestedActions: j.suggestedActions ?? [], suggestedOwner: j.suggestedOwner ?? incident.ownerId };
}

export async function generatePostmortem(incidentId: string): Promise<{ id: string; timeline: string; rootCause: string; actionItems: string[] }> {
  const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
  if (!incident) throw new Error(`Incident ${incidentId} not found`);

  const system = `You write a post-incident review (post-mortem). Be blameless, specific, and operational.
Output STRICT JSON: { "timeline": "<bullet markdown timeline>", "rootCause": "...", "actionItems": ["..."] }`;
  const user = JSON.stringify(incident, null, 2);
  const out = await complete({
    model: "reasoning",
    system,
    messages: [{ role: "user", content: user }],
    maxTokens: 1500,
    temperature: 0.2,
  });
  const j = parseJSON(out);

  const created = await prisma.postmortem.create({
    data: {
      incidentId,
      timeline: j.timeline ?? "",
      rootCause: j.rootCause ?? "",
      actionItems: JSON.stringify(j.actionItems ?? []),
    },
  });

  return { id: created.id, timeline: created.timeline, rootCause: created.rootCause, actionItems: j.actionItems ?? [] };
}

function parseJSON(text: string): { situation?: string; suggestedActions?: string[]; suggestedOwner?: string | null; timeline?: string; rootCause?: string; actionItems?: string[] } {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return {};
  try {
    return JSON.parse(m[0]);
  } catch {
    return {};
  }
}
