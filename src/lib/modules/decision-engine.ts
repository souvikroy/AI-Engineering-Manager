import fs from "node:fs";
import path from "node:path";
import { complete } from "@/lib/anthropic";
import { prisma } from "@/lib/prisma";

export type DocAnalysis = {
  title: string;
  summary: string;
  scalabilityRisks: string[];
  flagged: string[];
  tradeoffs: { option: string; pros: string[]; cons: string[] }[];
  relatedDecisions: { id: string; title: string }[];
};

export async function listDesignDocs(): Promise<{ slug: string; title: string }[]> {
  const dir = path.resolve(process.cwd(), "data/design_docs");
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  return files.map((f) => {
    const md = fs.readFileSync(path.join(dir, f), "utf8");
    const titleMatch = md.match(/^#\s*(.+?)$/m);
    return { slug: f.replace(/\.md$/, ""), title: titleMatch?.[1] ?? f };
  });
}

export async function readDesignDoc(slug: string): Promise<{ slug: string; title: string; content: string } | null> {
  const file = path.resolve(process.cwd(), "data/design_docs", `${slug}.md`);
  if (!fs.existsSync(file)) return null;
  const content = fs.readFileSync(file, "utf8");
  const titleMatch = content.match(/^#\s*(.+?)$/m);
  return { slug, title: titleMatch?.[1] ?? slug, content };
}

export async function analyzeDesignDoc(content: string, title: string): Promise<DocAnalysis> {
  const recent = await prisma.decision.findMany({ orderBy: { createdAt: "desc" }, take: 8 });
  const relatedSummary = recent.map((d) => `- ${d.id} "${d.title}": ${d.summary.slice(0, 200)}`).join("\n");

  const system = `You are a principal engineer reviewing a design document.
Extract: a 2-3 sentence summary, scalability risks specific to the proposal, items to flag for re-examination, and an enumerated trade-off list.
Reference any of the prior decisions (provided below) that conflict or compose with this proposal.
Be specific; cite the exact text from the doc when noting a risk. Output STRICT JSON only.`;

  const user = [
    `# Title\n${title}`,
    `\n# Document\n${content}`,
    `\n# Recent Decisions (last 8)\n${relatedSummary || "(none)"}`,
    `\n# Output JSON shape\n{ "summary": "...", "scalabilityRisks": ["..."], "flagged": ["..."], "tradeoffs": [ { "option": "A — ...", "pros": ["..."], "cons": ["..."] } ], "relatedDecisions": [ { "id": "...", "title": "..." } ] }`,
  ].join("\n");

  const out = await complete({
    model: "reasoning",
    system,
    messages: [{ role: "user", content: user }],
    maxTokens: 2000,
    temperature: 0.2,
  });

  const json = parseJSON(out);
  return {
    title,
    summary: json.summary ?? "",
    scalabilityRisks: json.scalabilityRisks ?? [],
    flagged: json.flagged ?? [],
    tradeoffs: json.tradeoffs ?? [],
    relatedDecisions: json.relatedDecisions ?? [],
  };
}

export async function recordDecision(input: { title: string; summary: string; options: string[]; chosen: string; rationale: string; tradeoffs: string; tags: string[] }): Promise<{ id: string }> {
  const created = await prisma.decision.create({
    data: {
      title: input.title,
      summary: input.summary,
      options: JSON.stringify(input.options),
      chosen: input.chosen,
      rationale: input.rationale,
      tradeoffs: input.tradeoffs,
      tags: JSON.stringify(input.tags),
    },
  });
  return { id: created.id };
}

export async function simulate(optionA: string, optionB: string, context: string): Promise<{ table: { dimension: string; a: string; b: string }[]; recommendation: string }> {
  const system = `You compare two engineering options across the dimensions: scalability, latency, dev effort, ops cost, blast radius, reversibility.
Output STRICT JSON only:
{ "table": [ { "dimension": "...", "a": "...", "b": "..." } ], "recommendation": "..." }`;
  const user = `# Context\n${context}\n\n# Option A\n${optionA}\n\n# Option B\n${optionB}`;
  const out = await complete({
    model: "reasoning",
    system,
    messages: [{ role: "user", content: user }],
    maxTokens: 1500,
    temperature: 0.2,
  });
  const j = parseJSON(out);
  return { table: j.table ?? [], recommendation: j.recommendation ?? "" };
}

function parseJSON(text: string): {
  summary?: string;
  scalabilityRisks?: string[];
  flagged?: string[];
  tradeoffs?: { option: string; pros: string[]; cons: string[] }[];
  relatedDecisions?: { id: string; title: string }[];
  table?: { dimension: string; a: string; b: string }[];
  recommendation?: string;
} {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return {};
  try {
    return JSON.parse(m[0]);
  } catch {
    return {};
  }
}
