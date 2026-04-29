import { NextResponse } from "next/server";
import { loadRuleset } from "@/lib/modules/pr-review/ruleset-loader";

export async function GET() {
  const rs = loadRuleset();
  return NextResponse.json({
    ok: true,
    ruleset: { workflows: rs.workflows.length, rules: rs.totalRules },
    env: {
      hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
      hasGithubPat: !!process.env.GITHUB_PAT,
      githubRepo: process.env.GITHUB_REPO ?? null,
    },
  });
}
