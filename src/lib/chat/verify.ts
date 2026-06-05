/**
 * Post-generation provenance verifier.
 *
 * Given the model's final answer + the citations collected from tool results,
 * Haiku reads the answer one claim at a time and decides whether each claim is
 * supported. Returns the worst-case verdict so the chat layer can decide
 * whether to retry, append a warning footer, or pass through.
 *
 * Cheap (Haiku, low max_tokens) and surface-level only — it's a "did the model
 * cite something for this claim?" check, not deep entailment.
 */
import Anthropic from "@anthropic-ai/sdk";
import { resolveModel } from "@/lib/anthropic";
import type { Citation } from "@/lib/python";

export type VerifyVerdict = "ok" | "weak" | "unsupported" | "skip";

export type VerifyResult = {
  verdict: VerifyVerdict;
  unsupported_claims: string[];
  notes: string;
};

const VERIFIER_SYSTEM = `You verify whether claims in an engineering-management copilot's answer are supported by the cited sources.

You will receive:
1. The final answer text.
2. A list of source IDs the agent had access to (from tool results).

Output STRICT JSON of shape:
{
  "verdict": "ok" | "weak" | "unsupported",
  "unsupported_claims": ["..."],
  "notes": "<one sentence>"
}

Rules:
- "ok"           — every concrete factual claim references at least one source ID, and the claim is the kind of thing those sources could plausibly support.
- "weak"         — the answer references sources but at least one specific claim (number, date, name) lacks a clear source pointer.
- "unsupported"  — at least one major claim cites no source, or the only sources are generic/non-relevant.
- Generic guidance, opinions, recommendations are NOT claims requiring citations. Concrete facts (counts, names, IDs, dates, percentages) ARE.
- Be conservative. When in doubt, "weak", not "unsupported".`;

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (_client === null) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

export async function verifyAnswer(
  answer: string,
  citations: Citation[],
): Promise<VerifyResult> {
  // No live Claude key (or no answer worth checking) — skip silently.
  if (!process.env.ANTHROPIC_API_KEY || !answer.trim()) {
    return { verdict: "skip", unsupported_claims: [], notes: "verifier_skipped" };
  }
  // No tool calls happened — answer is pure persona / refusal / guidance.
  if (citations.length === 0) {
    return { verdict: "skip", unsupported_claims: [], notes: "no_tool_results" };
  }

  const sourceList = citations
    .map((c) => `- ${c.kind}/${c.id}${c.url ? ` (${c.url})` : ""}`)
    .join("\n");

  const user = [
    "## Final answer",
    answer.slice(0, 6000),
    "",
    "## Sources available to the agent",
    sourceList,
    "",
    "Return the verdict JSON.",
  ].join("\n");

  try {
    const res = await client().messages.create({
      model: resolveModel("fast"),
      max_tokens: 400,
      temperature: 0,
      system: VERIFIER_SYSTEM,
      messages: [{ role: "user", content: user }],
    });
    const text = res.content
      .filter((c): c is Anthropic.TextBlock => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { verdict: "weak", unsupported_claims: [], notes: "no_json" };
    const parsed = JSON.parse(match[0]) as VerifyResult;
    return {
      verdict: parsed.verdict ?? "weak",
      unsupported_claims: parsed.unsupported_claims ?? [],
      notes: parsed.notes ?? "",
    };
  } catch (err) {
    return {
      verdict: "skip",
      unsupported_claims: [],
      notes: `verifier_error: ${(err as Error).message}`,
    };
  }
}

export function verdictFooter(result: VerifyResult): string {
  if (result.verdict === "ok" || result.verdict === "skip") return "";
  if (result.verdict === "weak") {
    return "_Note: not every fact in this answer maps cleanly to a source. Treat numbers/dates/names with extra care._";
  }
  // unsupported
  const list =
    result.unsupported_claims.length > 0
      ? ` Specifically: ${result.unsupported_claims.slice(0, 3).join(" · ")}`
      : "";
  return `_⚠️ At least one claim above is not supported by the sources I checked.${list}_`;
}
