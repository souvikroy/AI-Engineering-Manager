export type SlackMessage = {
  ts: string;
  user: string;
  channel: string;
  text: string;
};

export type HesitationSignal = {
  engineerId: string;
  signal: string;
  detail: string;
};

export interface ISlackAdapter {
  recentMessages(channels?: string[]): Promise<SlackMessage[]>;
  hesitationSignals(): Promise<HesitationSignal[]>;
}

export type JiraTicket = {
  key: string;
  team: string;
  sprintId: string;
  assigneeId: string;
  title: string;
  status: string;
  type: string;
  priority: string;
  openedDays: number;
  lastMovedDays: number;
};

export type JiraSprint = {
  id: string;
  team: string;
  name: string;
  startsAt: string;
  endsAt: string;
  goal: string;
};

export interface IJiraAdapter {
  sprints(): Promise<JiraSprint[]>;
  tickets(opts?: { team?: string; assigneeId?: string }): Promise<JiraTicket[]>;
}

export type ServiceHealth = {
  name: string;
  team: string;
  sli_latency_p99_ms?: number | null;
  sli_latency_p99_target_ms?: number | null;
  sli_error_rate_pct?: number | null;
  sli_error_target_pct?: number | null;
  sli_crash_free_pct?: number | null;
  sli_crash_free_target_pct?: number | null;
  uptime_30d_pct?: number | null;
};

export type Alert = {
  id: string;
  service: string;
  severity: string;
  status: string;
  openedAt: string;
  resolvedAt?: string;
  title: string;
  ownerId: string;
  thread: string;
};

export interface IMonitoringAdapter {
  services(): Promise<ServiceHealth[]>;
  alerts(opts?: { open?: boolean }): Promise<Alert[]>;
}

export type Standup = {
  engineerId: string;
  date: string;
  yesterday: string;
  today: string;
  blockers: string;
};

export interface IStandupAdapter {
  forDate(date: string): Promise<Standup[]>;
}

export type GitHubPR = {
  number: number;
  title: string;
  body: string;
  author: string;
  draft: boolean;
  baseRef: string;
  headRef: string;
  labels: string[];
  changedFiles: string[];
  diff: string;
  ciStatus: "success" | "failure" | "pending" | "unknown";
  url: string;
  createdAt: string;
  commits: { sha: string; message: string }[];
};

export type GitHubMergedPR = {
  number: number;
  title: string;
  url: string;
  author: string;
  mergedAt: string;
};

export interface IGitHubAdapter {
  listOpenPRs(repo: string): Promise<{ number: number; title: string; url: string }[]>;
  listMergedPRs(repo: string, since: string): Promise<GitHubMergedPR[]>;
  getPR(repo: string, number: number): Promise<GitHubPR>;
  postReviewComment(repo: string, number: number, body: string): Promise<{ url: string }>;
}
