import fs from "node:fs";
import path from "node:path";
import type { IJiraAdapter, JiraSprint, JiraTicket } from "./types";

type Raw = { sprints: JiraSprint[]; tickets: JiraTicket[] };

function load(): Raw {
  const file = path.resolve(process.cwd(), "data/jira.json");
  return JSON.parse(fs.readFileSync(file, "utf8")) as Raw;
}

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
};
