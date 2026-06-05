/**
 * `produce_doc` — single tool that generates one of several markdown reports
 * and returns it as a `doc` artifact.
 *
 * Topic dispatcher:
 *   - "brief"     → daily intelligence brief (reuses generateBrief)
 *   - "okr"       → OKR status report
 *   - "incident"  → per-incident situation summary or postmortem
 *   - "sprint"    → sprint health derived from Jira sprints + tickets
 *   - "standup"   → standup digest from StandupView
 */
import { complete } from "@/lib/anthropic";
import { prisma } from "@/lib/prisma";
import { jira } from "@/lib/adapters";
import { getLatestBrief, generateBrief, type Brief } from "@/lib/modules/daily-brief";
import {
  generateStatusReport,
  listOKRs,
} from "@/lib/modules/execution-tower";
import {
  listIncidents,
  summarizeIncident,
  generatePostmortem,
} from "@/lib/modules/interrupt-memory";
import type { DocArtifact } from "@/lib/chat/events";
import type { Citation } from "@/lib/python";

export type ProduceDocInput = {
  topic: "brief" | "okr" | "incident" | "sprint" | "standup";
  scope?: string; // e.g. incident_id for incident topic; sprint_id for sprint
  window?: "day" | "week" | "sprint" | "quarter";
  postmortem?: boolean;
};

export type ProduceDocOutput = {
  artifact: DocArtifact;
  citations: Citation[];
  summary: string; // compact JSON for the model context
};

const ISO_DATE = (d: Date) => d.toISOString().slice(0, 10);

export async function produceDoc(input: ProduceDocInput): Promise<ProduceDocOutput> {
  switch (input.topic) {
    case "brief":
      return await briefDoc();
    case "okr":
      return await okrDoc();
    case "incident":
      return await incidentDoc(input.scope, input.postmortem ?? false);
    case "sprint":
      return await sprintDoc(input.scope);
    case "standup":
      return await standupDoc(input.window ?? "week");
    default:
      throw new Error(`Unknown doc topic: ${input.topic}`);
  }
}

async function briefDoc(): Promise<ProduceDocOutput> {
  let brief: Brief | null = await getLatestBrief();
  if (!brief) {
    brief = await generateBrief(ISO_DATE(new Date()));
  }
  const md = renderBrief(brief);
  return {
    artifact: { title: `Daily brief — ${brief.date}`, markdown: md, freshness_seconds: 0 },
    citations: [],
    summary: JSON.stringify({
      topic: "brief",
      date: brief.date,
      blockers: brief.blockers.length,
      sprint_risks: brief.sprintRisk.length,
    }),
  };
}

function renderBrief(b: Brief): string {
  const lines: string[] = [];
  lines.push(`# Daily intelligence brief`);
  lines.push(`_${b.date} · generated ${new Date(b.asOfISO).toLocaleString()}_`);
  lines.push(``);
  lines.push(b.narrative);
  lines.push(``);
  if (b.sprintRisk.length > 0) {
    lines.push(`## Sprint risk`);
    for (const r of b.sprintRisk) {
      lines.push(`- **${r.team}** — _${r.level}_ — ${r.reason}`);
    }
    lines.push(``);
  }
  if (b.blockers.length > 0) {
    lines.push(`## Blockers`);
    for (const x of b.blockers) {
      lines.push(`- **${x.engineerId}** (${x.team}) — ${x.reason}`);
    }
    lines.push(``);
  }
  if (b.productivityAnomalies.length > 0) {
    lines.push(`## Productivity anomalies`);
    for (const a of b.productivityAnomalies) {
      lines.push(`- _${a.kind}_${a.engineerId ? ` (${a.engineerId})` : ""} — ${a.detail}`);
    }
    lines.push(``);
  }
  if (b.incidentDigest) {
    lines.push(`## Incidents`);
    lines.push(b.incidentDigest);
  }
  return lines.join("\n");
}

async function okrDoc(): Promise<ProduceDocOutput> {
  const [report, okrs] = await Promise.all([generateStatusReport(), listOKRs()]);
  const lines: string[] = [];
  lines.push(`# OKR status — Q${currentQuarter()}`);
  lines.push(``);
  lines.push(`> ${report.headline}`);
  lines.push(``);
  if (report.progress.length > 0) {
    lines.push(`## Progress`);
    report.progress.forEach((p) => lines.push(`- ${p}`));
    lines.push(``);
  }
  if (report.risks.length > 0) {
    lines.push(`## Risks`);
    report.risks.forEach((r) => lines.push(`- ${r}`));
    lines.push(``);
  }
  if (report.decisionsNeeded.length > 0) {
    lines.push(`## Decisions needed`);
    report.decisionsNeeded.forEach((d) => lines.push(`- ${d}`));
    lines.push(``);
  }
  lines.push(`## OKR roster`);
  lines.push(`| Team | Objective | Progress | Status |`);
  lines.push(`| --- | --- | --: | :-: |`);
  for (const o of okrs) {
    lines.push(
      `| ${o.teamName} | ${o.objective} | ${(o.progress * 100).toFixed(0)}% | ${o.status} |`,
    );
  }
  return {
    artifact: { title: "OKR status report", markdown: lines.join("\n") },
    citations: [],
    summary: JSON.stringify({
      topic: "okr",
      headline: report.headline,
      okr_count: okrs.length,
      risks: report.risks.length,
    }),
  };
}

async function incidentDoc(
  incidentId: string | undefined,
  asPostmortem: boolean,
): Promise<ProduceDocOutput> {
  // Default to most-recent incident if no id given.
  const all = await listIncidents();
  if (all.length === 0) {
    return {
      artifact: { title: "Incident review", markdown: "_No incidents on record._" },
      citations: [],
      summary: JSON.stringify({ topic: "incident", note: "no_incidents" }),
    };
  }
  const id = incidentId ?? all[0].id;
  const inc = all.find((x) => x.id === id) ?? all[0];

  const lines: string[] = [];
  lines.push(`# Incident — ${inc.title}`);
  lines.push(
    `_severity ${inc.severity.toUpperCase()} · status ${inc.status} · opened ${inc.openedAt}${inc.resolvedAt ? ` · resolved ${inc.resolvedAt}` : ""}_`,
  );
  lines.push(``);
  if (inc.summary) {
    lines.push(`## Summary`);
    lines.push(inc.summary);
    lines.push(``);
  }

  if (asPostmortem) {
    const pm = await generatePostmortem(inc.id);
    lines.push(`## Timeline`);
    lines.push(pm.timeline);
    lines.push(``);
    lines.push(`## Root cause`);
    lines.push(pm.rootCause);
    lines.push(``);
    if (pm.actionItems.length > 0) {
      lines.push(`## Action items`);
      pm.actionItems.forEach((a) => lines.push(`- ${a}`));
    }
  } else {
    const sit = await summarizeIncident(inc.id);
    lines.push(`## Situation`);
    lines.push(sit.situation);
    lines.push(``);
    if (sit.suggestedActions.length > 0) {
      lines.push(`## Suggested actions`);
      sit.suggestedActions.forEach((a) => lines.push(`- ${a}`));
      lines.push(``);
    }
    if (sit.suggestedOwner) {
      lines.push(`_Suggested owner: ${sit.suggestedOwner}_`);
    }
  }

  const citations: Citation[] = [
    { kind: "sentry", id: inc.id, url: null, freshness_seconds: 0 },
  ];
  return {
    artifact: { title: `Incident — ${inc.title}`, markdown: lines.join("\n") },
    citations,
    summary: JSON.stringify({
      topic: "incident",
      id: inc.id,
      severity: inc.severity,
      status: inc.status,
      postmortem: asPostmortem,
    }),
  };
}

async function sprintDoc(sprintId: string | undefined): Promise<ProduceDocOutput> {
  const [sprints, tickets] = await Promise.all([jira.sprints(), jira.tickets()]);
  if (sprints.length === 0) {
    return {
      artifact: { title: "Sprint health", markdown: "_No active sprints found._" },
      citations: [],
      summary: JSON.stringify({ topic: "sprint", note: "no_sprints" }),
    };
  }
  const target = sprintId
    ? sprints.find((s) => s.id === sprintId) ?? sprints[0]
    : sprints[0];
  const sprintTickets = tickets.filter((t) => t.sprintId === target.id);
  const done = sprintTickets.filter((t) => t.status === "Done").length;
  const stalled = sprintTickets.filter((t) => t.lastMovedDays >= 4 && t.status !== "Done");

  const lines: string[] = [];
  lines.push(`# Sprint health — ${target.name}`);
  lines.push(``);
  lines.push(
    `**${done}/${sprintTickets.length}** tickets complete (${
      sprintTickets.length ? Math.round((done / sprintTickets.length) * 100) : 0
    }%).`,
  );
  if (stalled.length > 0) {
    lines.push(``);
    lines.push(`## Stalled tickets (${stalled.length})`);
    for (const t of stalled) {
      lines.push(
        `- **${t.key}** — ${t.title} _(${t.team} · ${t.status} · no movement ${t.lastMovedDays}d)_`,
      );
    }
  }

  const text = await complete({
    model: "fast",
    system:
      "You are a senior EM. Write 2-3 sentence assessment of sprint health from the data. Direct, no fluff.",
    messages: [
      {
        role: "user",
        content: JSON.stringify({ sprint: target, tickets: sprintTickets }),
      },
    ],
    maxTokens: 200,
    temperature: 0.3,
  });
  lines.push(``);
  lines.push(`## Assessment`);
  lines.push(text);

  const citations: Citation[] = sprintTickets.slice(0, 8).map((t) => ({
    kind: "jira",
    id: t.key,
    url: null,
    freshness_seconds: 0,
  }));
  return {
    artifact: { title: `Sprint health — ${target.name}`, markdown: lines.join("\n") },
    citations,
    summary: JSON.stringify({
      topic: "sprint",
      sprint: target.name,
      total: sprintTickets.length,
      done,
      stalled: stalled.length,
    }),
  };
}

async function standupDoc(window: "day" | "week" | "sprint" | "quarter"): Promise<ProduceDocOutput> {
  const days = window === "day" ? 1 : window === "week" ? 7 : window === "sprint" ? 14 : 90;
  const since = new Date();
  since.setDate(since.getDate() - days);
  const rows = await prisma.standupView.findMany({
    where: { date: { gte: since } },
    orderBy: { date: "desc" },
    take: 50,
  });
  const lines: string[] = [];
  lines.push(`# Standup digest — last ${days}d`);
  lines.push(``);
  if (rows.length === 0) {
    lines.push(`_No standup transcripts ingested in this window._`);
  } else {
    const byEng = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = r.engineerId ?? "unassigned";
      if (!byEng.has(k)) byEng.set(k, []);
      byEng.get(k)!.push(r);
    }
    for (const [eng, items] of byEng) {
      lines.push(`## ${eng}`);
      for (const it of items.slice(0, 5)) {
        lines.push(`- **${it.date.toISOString().slice(0, 10)}**`);
        if (it.today) lines.push(`  - _Today:_ ${it.today}`);
        if (it.blockers && it.blockers.toLowerCase() !== "none.") {
          lines.push(`  - _Blockers:_ ${it.blockers}`);
        }
      }
      lines.push(``);
    }
  }
  const citations: Citation[] = [];
  return {
    artifact: { title: `Standup digest — last ${days}d`, markdown: lines.join("\n") },
    citations,
    summary: JSON.stringify({ topic: "standup", days, entries: rows.length }),
  };
}

function currentQuarter(): string {
  const m = new Date().getMonth();
  return String(Math.floor(m / 3) + 1);
}
