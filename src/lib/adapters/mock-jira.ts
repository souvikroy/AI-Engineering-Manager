import fs from "node:fs";
import path from "node:path";
import type {
  IJiraAdapter,
  JiraSprint,
  JiraTicket,
  JiraIssueCreatedResult,
  JiraIssueCreateInput,
} from "./types";

type Raw = { sprints: JiraSprint[]; tickets: JiraTicket[] };

function load(): Raw {
  const file = path.resolve(process.cwd(), "data/jira.json");
  return JSON.parse(fs.readFileSync(file, "utf8")) as Raw;
}

// Counter shared across the process — gives mock keys a stable look during a session.
let mockSeq = 1000 + Math.floor(Math.random() * 9000);

export const jira: IJiraAdapter = {
  async sprints() {
    return load().sprints;
  },
  async tickets(opts) {
    let t = load().tickets;
    if (opts?.team) t = t.filter((x) => x.team === opts.team);
    if (opts?.assigneeId) t = t.filter((x) => x.assigneeId === opts.assigneeId);
    return t;
  },
  async createIssue(_input: JiraIssueCreateInput): Promise<JiraIssueCreatedResult> {
    // Real Jira not configured — return a faux key. Caller can surface this in
    // the UI as `mocked: true` so the user knows nothing left the laptop.
    mockSeq += 1;
    return {
      key: `MOCK-${mockSeq}`,
      url: null,
      mocked: true,
    };
  },
};
