/**
 * Live Jira Cloud adapter — uses the REST v3 search/sprint APIs via PAT.
 *
 * Activates when both `JIRA_BASE_URL` and `JIRA_PAT` (and optionally `JIRA_EMAIL`
 * for Atlassian basic auth) are present. Otherwise the index falls back to the
 * mock adapter so local dev keeps working.
 */
import type {
  IJiraAdapter,
  JiraSprint,
  JiraTicket,
  JiraIssueCreateInput,
  JiraIssueCreatedResult,
} from "./types";

type JiraIssue = {
  key: string;
  fields: {
    summary?: string;
    status?: { name?: string };
    priority?: { name?: string };
    issuetype?: { name?: string };
    assignee?: { accountId?: string; displayName?: string };
    project?: { key?: string };
    created?: string;
    updated?: string;
    customfield_10020?: { id: number; name: string }[]; // sprint custom field, varies by site
  };
};

type JiraSprintRaw = {
  id: number;
  name: string;
  state: string;
  startDate?: string;
  endDate?: string;
  goal?: string;
  originBoardId?: number;
};

const BASE = process.env.JIRA_BASE_URL?.replace(/\/+$/, "");
const PAT = process.env.JIRA_PAT;
const EMAIL = process.env.JIRA_EMAIL;

function authHeader(): string {
  if (!PAT) throw new Error("JIRA_PAT not set");
  if (EMAIL) {
    const tok = Buffer.from(`${EMAIL}:${PAT}`).toString("base64");
    return `Basic ${tok}`;
  }
  return `Bearer ${PAT}`;
}

async function jiraFetch<T>(path: string): Promise<T> {
  if (!BASE) throw new Error("JIRA_BASE_URL not set");
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Authorization: authHeader(),
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Jira ${res.status} ${path}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

async function jiraPost<T>(path: string, body: unknown): Promise<T> {
  if (!BASE) throw new Error("JIRA_BASE_URL not set");
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Jira ${res.status} ${path}: ${errBody.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/**
 * Wrap a plain-text description in Atlassian Document Format (ADF) v1.
 * Required for the Jira REST v3 issue-creation endpoint. Splits on blank
 * lines into paragraphs so basic line breaks survive.
 */
function toADF(text: string): {
  type: "doc";
  version: 1;
  content: { type: "paragraph"; content: { type: "text"; text: string }[] }[];
} {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) {
    return {
      type: "doc",
      version: 1,
      content: [
        { type: "paragraph", content: [{ type: "text", text: " " }] },
      ],
    };
  }
  return {
    type: "doc",
    version: 1,
    content: paragraphs.map((p) => ({
      type: "paragraph",
      content: [{ type: "text", text: p }],
    })),
  };
}

function daysBetween(a: string | undefined, b: Date): number {
  if (!a) return 0;
  const d1 = new Date(a);
  const ms = Math.max(0, b.getTime() - d1.getTime());
  return Math.floor(ms / 86_400_000);
}

export const jira: IJiraAdapter = {
  async sprints(): Promise<JiraSprint[]> {
    // Site-specific: pulls sprints across all boards the user can see (paginated).
    const boards = await jiraFetch<{ values: { id: number; name: string; type: string }[] }>(
      "/rest/agile/1.0/board?type=scrum&maxResults=20",
    );
    const all: JiraSprint[] = [];
    for (const b of boards.values) {
      const sps = await jiraFetch<{ values: JiraSprintRaw[] }>(
        `/rest/agile/1.0/board/${b.id}/sprint?state=active,future&maxResults=10`,
      ).catch(() => ({ values: [] as JiraSprintRaw[] }));
      for (const s of sps.values) {
        all.push({
          id: `S-${s.id}`,
          team: b.name,
          name: s.name,
          startsAt: s.startDate ?? "",
          endsAt: s.endDate ?? "",
          goal: s.goal ?? "",
        });
      }
    }
    return all;
  },

  async tickets(opts?: { team?: string; assigneeId?: string }): Promise<JiraTicket[]> {
    const jql: string[] = ["statusCategory != Done", "updated >= -30d"];
    if (opts?.team) jql.push(`project = "${opts.team}"`);
    if (opts?.assigneeId) jql.push(`assignee = "${opts.assigneeId}"`);
    const q = encodeURIComponent(jql.join(" AND "));
    const data = await jiraFetch<{ issues: JiraIssue[] }>(
      `/rest/api/3/search?jql=${q}&maxResults=200&fields=summary,status,priority,issuetype,assignee,project,created,updated,customfield_10020`,
    );
    const now = new Date();
    return data.issues.map((i) => {
      const sprintRaw = i.fields.customfield_10020?.[0];
      return {
        key: i.key,
        team: i.fields.project?.key ?? "",
        sprintId: sprintRaw ? `S-${sprintRaw.id}` : "",
        assigneeId: i.fields.assignee?.accountId ?? "unassigned",
        title: i.fields.summary ?? "",
        status: i.fields.status?.name ?? "Unknown",
        type: i.fields.issuetype?.name ?? "Task",
        priority: i.fields.priority?.name ?? "Medium",
        openedDays: daysBetween(i.fields.created, now),
        lastMovedDays: daysBetween(i.fields.updated, now),
      };
    });
  },

  async createIssue(input: JiraIssueCreateInput): Promise<JiraIssueCreatedResult> {
    const projectKey = input.projectKey ?? process.env.JIRA_PROJECT;
    if (!projectKey) {
      throw new Error(
        "JIRA_PROJECT not set (or projectKey not passed). Configure the env var or pass projectKey explicitly.",
      );
    }
    const summary = input.summary.slice(0, 254);
    const issueType = input.issueType ?? "Task";

    type CreateResp = { id: string; key: string; self: string };
    const resp = await jiraPost<CreateResp>("/rest/api/3/issue", {
      fields: {
        project: { key: projectKey },
        summary,
        issuetype: { name: issueType },
        ...(input.description
          ? { description: toADF(input.description) }
          : {}),
        ...(input.labels && input.labels.length > 0
          ? { labels: input.labels }
          : {}),
      },
    });

    return {
      key: resp.key,
      url: BASE ? `${BASE}/browse/${resp.key}` : null,
      mocked: false,
    };
  },
};

export const isLiveJiraConfigured = (): boolean => Boolean(BASE && PAT);
