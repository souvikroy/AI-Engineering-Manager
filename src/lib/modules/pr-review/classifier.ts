import { complete } from "@/lib/anthropic";
import type { GitHubPR } from "@/lib/adapters/types";
import { PRClassificationSchema, type PRClassification } from "./types";

const SYSTEM = `You are a senior code reviewer applying rule R1.7 from the production code-review ruleset.
Classify the PR as exactly one of: bug, feature, refactor, migration, security, experiment, infra, docs, test, chore, perf, revert.
Return only the single lowercase word, nothing else.`;

export async function classify(pr: GitHubPR): Promise<PRClassification> {
  const userPrompt =
    `PR Title: ${pr.title}\n` +
    `PR Body:\n${pr.body || "(none)"}\n\n` +
    `Branch: ${pr.headRef} → ${pr.baseRef}\n` +
    `Labels: ${pr.labels.join(", ") || "(none)"}\n` +
    `Changed files (first 30):\n${pr.changedFiles.slice(0, 30).map((f) => `- ${f}`).join("\n")}\n\n` +
    `Classification:`;

  const out = await complete({
    model: "fast",
    system: SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
    maxTokens: 8,
    temperature: 0,
  });

  const word = out.toLowerCase().trim().replace(/[^a-z]/g, "");
  const parsed = PRClassificationSchema.safeParse(word);
  if (parsed.success) return parsed.data;

  for (const k of PRClassificationSchema.options) {
    if (out.toLowerCase().includes(k)) return k;
  }
  return inferFromHeuristics(pr);
}

function inferFromHeuristics(pr: GitHubPR): PRClassification {
  const t = pr.title.toLowerCase();
  if (/^revert\b/.test(t)) return "revert";
  if (/\b(fix|bug)\b/.test(t)) return "bug";
  if (/\b(perf|performance|speedup)\b/.test(t)) return "perf";
  if (/\b(refactor)\b/.test(t)) return "refactor";
  if (/\b(migrat|schema)\b/.test(t)) return "migration";
  if (/\b(sec|security|cve|vuln)\b/.test(t)) return "security";
  if (/\b(test|spec)\b/.test(t)) return "test";
  if (/\b(doc|readme)\b/.test(t)) return "docs";
  if (/\b(infra|deploy|ci|terraform|k8s|docker)\b/.test(t)) return "infra";
  if (/\b(experiment|exp|ab\s*test)\b/.test(t)) return "experiment";
  if (/\b(chore)\b/.test(t)) return "chore";
  return "feature";
}
