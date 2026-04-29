import fs from "node:fs";
import path from "node:path";

export type Enforcement = "MUST_NOT" | "MUST" | "SHOULD_NOT" | "SHOULD" | "MAY" | "INFO";

export type Rule = {
  id: string;
  workflowId: number;
  index: number;
  enforcement: Enforcement;
  text: string;
};

export type Workflow = {
  id: number;
  title: string;
  rules: Rule[];
};

export type Ruleset = {
  workflows: Workflow[];
  byId: Map<string, Rule>;
  byWorkflow: Map<number, Rule[]>;
  totalRules: number;
};

const RULESET_PATH = path.resolve(process.cwd(), "CODE_REVIEW_RULESET.md");

let cached: Ruleset | null = null;

export function loadRuleset(force = false): Ruleset {
  if (cached && !force) return cached;
  const md = fs.readFileSync(RULESET_PATH, "utf8");
  cached = parseRuleset(md);
  return cached;
}

export function parseRuleset(md: string): Ruleset {
  const lines = md.split("\n");
  const workflows: Workflow[] = [];
  let current: Workflow | null = null;
  let currentRule: Rule | null = null;

  const wfHeading = /^## Workflow (\d+)\s*[—-]\s*(.+?)\s*$/;
  const ruleStart = /^- \*\*R(\d+)\.(\d+)\*\*\s*(.*)$/;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const wf = wfHeading.exec(line);
    if (wf) {
      currentRule = null;
      current = { id: parseInt(wf[1], 10), title: wf[2], rules: [] };
      workflows.push(current);
      continue;
    }
    const r = ruleStart.exec(line);
    if (r) {
      if (!current) throw new Error(`Rule ${r[1]}.${r[2]} appeared before any workflow heading`);
      const workflowId = parseInt(r[1], 10);
      const index = parseInt(r[2], 10);
      if (workflowId !== current.id) {
        throw new Error(`Rule R${workflowId}.${index} found under Workflow ${current.id} — workflow numbering mismatch`);
      }
      currentRule = {
        id: `R${workflowId}.${index}`,
        workflowId,
        index,
        enforcement: detectEnforcement(r[3]),
        text: r[3].trim(),
      };
      current.rules.push(currentRule);
      continue;
    }
    if (currentRule && /^\s+\S/.test(line)) {
      const trimmed = line.replace(/^\s+/, "");
      currentRule.text += "\n" + trimmed;
      const upgraded = detectEnforcement(currentRule.text);
      if (rank(upgraded) > rank(currentRule.enforcement)) currentRule.enforcement = upgraded;
      continue;
    }
    if (currentRule && (/^---/.test(line) || /^##/.test(line) || line === "")) {
      currentRule = null;
    }
  }

  const byId = new Map<string, Rule>();
  const byWorkflow = new Map<number, Rule[]>();
  for (const w of workflows) {
    byWorkflow.set(w.id, w.rules);
    for (const r of w.rules) byId.set(r.id, r);
  }

  return { workflows, byId, byWorkflow, totalRules: byId.size };
}

function detectEnforcement(text: string): Enforcement {
  if (/\bMUST NOT\b/.test(text)) return "MUST_NOT";
  if (/\bMUST\b/.test(text)) return "MUST";
  if (/\bSHOULD NOT\b/.test(text)) return "SHOULD_NOT";
  if (/\bSHOULD\b/.test(text)) return "SHOULD";
  if (/\bMAY\b/.test(text)) return "MAY";
  return "INFO";
}

function rank(e: Enforcement): number {
  return { INFO: 0, MAY: 1, SHOULD_NOT: 2, SHOULD: 2, MUST_NOT: 3, MUST: 3 }[e];
}

export function isBlocking(e: Enforcement): boolean {
  return e === "MUST" || e === "MUST_NOT";
}
