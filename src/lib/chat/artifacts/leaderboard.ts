/**
 * `produce_leaderboard` — engineer performance leaderboard.
 *
 * Pulls structured per-engineer signals from the live data sources and computes
 * a composite score. Designed to fail soft: any individual data source can be
 * missing/empty and the leaderboard still renders with the columns it could fill.
 *
 * Default columns:
 *   - tickets_done   (Jira: tickets in window with status=Done)
 *   - prs_merged     (GitHub: merged PRs authored, in window)
 *   - incidents_resolved (Prisma Incident: resolved, ownerId=engineer, in window)
 *   - standups       (Prisma StandupView: count of entries in window)
 *   - score          (composite — sum of normalized columns, see formula below)
 */
import { prisma } from "@/lib/prisma";
import { jira } from "@/lib/adapters";
import { github } from "@/lib/adapters/github";
import type {
  LeaderboardArtifact,
  LeaderboardColumn,
  LeaderboardRow,
} from "@/lib/chat/events";
import type { Citation } from "@/lib/python";

export type ProduceLeaderboardInput = {
  window?: "week" | "sprint" | "quarter";
  team_id?: string;
};

export type ProduceLeaderboardOutput = {
  artifact: LeaderboardArtifact;
  citations: Citation[];
  summary: string;
};

const WINDOW_DAYS: Record<NonNullable<ProduceLeaderboardInput["window"]>, number> = {
  week: 7,
  sprint: 14,
  quarter: 90,
};

// Normalized weights (must sum to 1.0). Tweak to taste.
const WEIGHTS = {
  tickets_done: 0.35,
  prs_merged: 0.3,
  incidents_resolved: 0.15,
  standups: 0.2,
};

const FORMULA = `score = 0.35·z(tickets_done) + 0.30·z(prs_merged) + 0.15·z(incidents_resolved) + 0.20·z(standups), normalized to 0–100`;

const COLUMNS: LeaderboardColumn[] = [
  { key: "engineer_name", label: "Engineer", type: "text" },
  { key: "tickets_done", label: "Tickets shipped", type: "number" },
  { key: "prs_merged", label: "PRs merged", type: "number" },
  { key: "incidents_resolved", label: "Incidents resolved", type: "number" },
  { key: "standups", label: "Standups", type: "number" },
  { key: "score", label: "Score", type: "number" },
];

export async function produceLeaderboard(
  input: ProduceLeaderboardInput,
): Promise<ProduceLeaderboardOutput> {
  const window = input.window ?? "sprint";
  const days = WINDOW_DAYS[window];
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceISO = since.toISOString();

  // 1. Engineer roster — optionally filter by team.
  const engineers = await prisma.engineer.findMany({
    where: input.team_id ? { teamId: input.team_id } : {},
    include: { team: true },
  });

  // 2. Pull each signal in parallel; fail soft per source.
  const [tickets, mergedPRs, incidents, standups] = await Promise.all([
    safeCall(() => jira.tickets(), [] as Awaited<ReturnType<typeof jira.tickets>>),
    safeCall(
      async () => {
        const repo = process.env.GITHUB_REPO;
        if (!repo) return [];
        return github.listMergedPRs(repo, sinceISO);
      },
      [] as Awaited<ReturnType<typeof github.listMergedPRs>>,
    ),
    safeCall(
      () =>
        prisma.incident.findMany({
          where: {
            status: "resolved",
            resolvedAt: { gte: since },
          },
        }),
      [] as Awaited<ReturnType<typeof prisma.incident.findMany>>,
    ),
    safeCall(
      () =>
        prisma.standupView.findMany({
          where: { date: { gte: since } },
          select: { engineerId: true },
        }),
      [] as { engineerId: string | null }[],
    ),
  ]);

  // 3. Build per-engineer raw value record.
  const raw: { engineer: (typeof engineers)[number]; values: Record<string, number> }[] = [];
  for (const e of engineers) {
    const ticketsDone = tickets.filter(
      (t) => t.assigneeId === e.id && t.status === "Done",
    ).length;
    const prsMerged = e.githubHandle
      ? mergedPRs.filter((p) => p.author === e.githubHandle).length
      : 0;
    const incidentsResolved = incidents.filter((i) => i.ownerId === e.id).length;
    const standupCount = standups.filter((s) => s.engineerId === e.id).length;

    raw.push({
      engineer: e,
      values: {
        tickets_done: ticketsDone,
        prs_merged: prsMerged,
        incidents_resolved: incidentsResolved,
        standups: standupCount,
      },
    });
  }

  // 4. Score: z-score per column, weighted, then rescale to 0–100.
  const cols = ["tickets_done", "prs_merged", "incidents_resolved", "standups"] as const;
  const stats: Record<string, { mean: number; std: number }> = {};
  for (const c of cols) {
    const vs = raw.map((r) => r.values[c]);
    const mean = vs.reduce((a, b) => a + b, 0) / Math.max(vs.length, 1);
    const variance =
      vs.reduce((acc, v) => acc + (v - mean) ** 2, 0) / Math.max(vs.length, 1);
    stats[c] = { mean, std: Math.sqrt(variance) || 1 };
  }
  const rawScores = raw.map((r) => {
    let s = 0;
    for (const c of cols) {
      const z = (r.values[c] - stats[c].mean) / stats[c].std;
      s += z * WEIGHTS[c];
    }
    return s;
  });
  // Rescale to 0–100 across the cohort
  const minS = Math.min(...rawScores, 0);
  const maxS = Math.max(...rawScores, 1);
  const span = maxS - minS || 1;

  const rows: LeaderboardRow[] = raw
    .map((r, i) => {
      const score = Math.round(((rawScores[i] - minS) / span) * 100);
      return {
        engineer_id: r.engineer.id,
        engineer_name: r.engineer.name,
        values: { ...r.values, engineer_name: r.engineer.name, score },
        score,
      };
    })
    .sort((a, b) => b.score - a.score);

  const artifact: LeaderboardArtifact = {
    title: `Engineering leaderboard — last ${days}d`,
    window: window === "week" ? "week" : window === "quarter" ? "quarter" : "sprint",
    columns: COLUMNS,
    rows,
    sort_by: "score",
    formula: FORMULA,
  };

  const citations: Citation[] = [];

  // Compact summary — model gets top-3 by score.
  const top = rows.slice(0, 3).map((r) => ({
    name: r.engineer_name,
    score: r.score,
    tickets: r.values.tickets_done,
    prs: r.values.prs_merged,
  }));
  const summary = JSON.stringify({
    window,
    days,
    engineers: rows.length,
    top,
  });

  return { artifact, citations, summary };
}

async function safeCall<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.warn("[leaderboard] data source error:", (err as Error).message);
    return fallback;
  }
}
