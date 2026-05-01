/**
 * Adapter index — picks live or mock implementations based on env.
 *
 * Live adapters are gated behind their own env vars; if the credentials are
 * missing we transparently fall back to the corresponding mock so local dev
 * continues to work without setup. The active source is logged once at import
 * time so it's obvious from the dev server console which is which.
 */
import { jira as liveJira, isLiveJiraConfigured } from "./jira";
import { jira as mockJira } from "./mock-jira";
import { monitoring as liveMonitoring, isLiveSentryConfigured } from "./sentry";
import { monitoring as mockMonitoring } from "./mock-monitoring";
import { slack } from "./mock-slack";
import { standups } from "./mock-standups";
import type { IJiraAdapter, IMonitoringAdapter } from "./types";

const useLiveJira = isLiveJiraConfigured();
const useLiveSentry = isLiveSentryConfigured();

if (typeof process !== "undefined" && process.env.NODE_ENV !== "test") {
  // One-time visible log so developers know what's wired.

  console.log(
    `[adapters] jira=${useLiveJira ? "live" : "mock"}  sentry=${useLiveSentry ? "live" : "mock"}  slack=mock  standups=mock  github=live`,
  );
}

export const jira: IJiraAdapter = useLiveJira ? liveJira : mockJira;
export const monitoring: IMonitoringAdapter = useLiveSentry ? liveMonitoring : mockMonitoring;
export { slack, standups };
export { github } from "./github";
export type * from "./types";
