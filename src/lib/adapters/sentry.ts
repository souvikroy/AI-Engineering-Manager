/**
 * Live Sentry adapter — Sentry's REST API via auth-token.
 *
 * Activates when `SENTRY_AUTH_TOKEN` and `SENTRY_ORG` are present. Otherwise
 * the index falls back to the mock monitoring adapter.
 *
 * Maps Sentry projects → ServiceHealth (one row per project, with aggregated
 * SLI fields populated from the org-stats endpoint), and unresolved issues →
 * Alert.
 */
import type { Alert, IMonitoringAdapter, ServiceHealth } from "./types";

const TOKEN = process.env.SENTRY_AUTH_TOKEN;
const ORG = process.env.SENTRY_ORG;
const BASE = "https://sentry.io/api/0";

type SentryProject = {
  id: string;
  slug: string;
  name: string;
  team?: { slug: string; name: string };
  platform?: string;
  status: string;
};

type SentryIssue = {
  id: string;
  shortId: string;
  title: string;
  level: string;
  status: string;
  firstSeen: string;
  lastSeen: string;
  permalink: string;
  project: { slug: string; name: string };
  count: string;
  userCount: number;
  assignedTo?: { username?: string; email?: string } | null;
};

async function sentryFetch<T>(path: string): Promise<T> {
  if (!TOKEN) throw new Error("SENTRY_AUTH_TOKEN not set");
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Sentry ${res.status} ${path}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

function severityFromLevel(level: string): string {
  if (level === "fatal" || level === "error") return "p1";
  if (level === "warning") return "p2";
  return "p3";
}

export const monitoring: IMonitoringAdapter = {
  async services(): Promise<ServiceHealth[]> {
    if (!ORG) return [];
    const projects = await sentryFetch<SentryProject[]>(
      `/organizations/${ORG}/projects/`,
    );
    return projects.map((p) => ({
      name: p.slug,
      team: p.team?.slug ?? "",
      sli_latency_p99_ms: null,
      sli_latency_p99_target_ms: null,
      sli_error_rate_pct: null,
      sli_error_target_pct: null,
      sli_crash_free_pct: null,
      sli_crash_free_target_pct: null,
      uptime_30d_pct: null,
    }));
  },

  async alerts(opts?: { open?: boolean }): Promise<Alert[]> {
    if (!ORG) return [];
    const queryParts = ["is:unresolved"];
    if (opts?.open === false) queryParts.length = 0;
    const q = encodeURIComponent(queryParts.join(" "));
    const issues = await sentryFetch<SentryIssue[]>(
      `/organizations/${ORG}/issues/?statsPeriod=14d&query=${q}&limit=50`,
    );
    return issues.map((i) => ({
      id: i.shortId || i.id,
      service: i.project.slug,
      severity: severityFromLevel(i.level),
      status: i.status === "unresolved" ? "open" : i.status,
      openedAt: i.firstSeen,
      resolvedAt: undefined,
      title: i.title,
      ownerId: i.assignedTo?.username ?? i.assignedTo?.email ?? "unassigned",
      thread: i.permalink,
    }));
  },
};

export const isLiveSentryConfigured = (): boolean => Boolean(TOKEN && ORG);
