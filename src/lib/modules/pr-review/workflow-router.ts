import type { GitHubPR } from "@/lib/adapters/types";
import type { PRClassification } from "./types";

const ALWAYS = [1, 2, 3, 6, 7, 14, 15, 16, 17, 19, 20, 21];

export function selectWorkflows(classification: PRClassification, pr: GitHubPR): number[] {
  const set = new Set<number>(ALWAYS);

  switch (classification) {
    case "feature":
    case "refactor":
      [4, 5, 6, 7].forEach((n) => set.add(n));
      break;
    case "bug":
      [6, 7].forEach((n) => set.add(n));
      break;
    case "migration":
      [9, 17].forEach((n) => set.add(n));
      break;
    case "security":
      [8, 6, 7].forEach((n) => set.add(n));
      break;
    case "perf":
      set.add(12);
      break;
    case "infra":
      [17, 18].forEach((n) => set.add(n));
      break;
    case "experiment":
      set.add(5);
      break;
    case "test":
      set.add(14);
      break;
    case "docs":
      set.add(19);
      break;
    case "chore":
    case "revert":
      break;
  }

  const files = pr.changedFiles;
  if (files.some((f) => /\.(tsx|jsx|css|scss|html|vue|svelte)$/i.test(f))) set.add(11);
  if (files.some((f) => /(api\/|routes\/|openapi|swagger|\.proto$|graphql)/i.test(f))) set.add(10);
  if (files.some((f) => /(Dockerfile|docker-compose|\.tf$|terraform|kustomization|deployment\.ya?ml|helm)/i.test(f))) set.add(17);
  if (files.some((f) => /(package\.json|package-lock\.json|yarn\.lock|pnpm-lock|requirements\.txt|go\.mod|go\.sum|Cargo\.toml|Cargo\.lock|pom\.xml|build\.gradle)/i.test(f))) set.add(18);
  if (files.some((f) => /\.(test|spec)\.(ts|tsx|js|jsx|py|go)$/i.test(f))) set.add(14);
  if (files.some((f) => /(migration|schema|\.sql$)/i.test(f))) {
    set.add(9);
    set.add(17);
  }
  if (files.some((f) => /(logging|tracing|metrics|otel|datadog|sentry)/i.test(f))) set.add(16);
  if (/\b(perf|benchmark|throughput|latency)\b/i.test(pr.title + " " + pr.body)) set.add(12);
  if (/\b(lock|mutex|atomic|channel|goroutine|asyncio|threadpool)\b/i.test(pr.diff)) set.add(13);
  if (files.some((f) => /(auth|password|secret|token|crypto|jwt|oauth)/i.test(f))) set.add(8);

  return [...set].sort((a, b) => a - b);
}
