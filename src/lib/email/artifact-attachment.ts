/**
 * Render a chat artifact into a downloadable file payload for an email
 * attachment. One renderer per artifact kind:
 *
 *   doc          → <slug>.md  (markdown body, with title as H1)
 *   leaderboard  → <slug>.csv (header row + per-engineer rows)
 *   code_review  → <repo>-pr<N>.json  (full payload)
 */
import type { ArtifactPayload, CodeReviewArtifact, DocArtifact, LeaderboardArtifact } from "@/lib/chat/events";
import type { EmailAttachment } from "./resend";

export function artifactToAttachment(
  artifact: ArtifactPayload,
): EmailAttachment | null {
  switch (artifact.kind) {
    case "doc":
      return docAttachment(artifact.payload);
    case "leaderboard":
      return leaderboardAttachment(artifact.payload);
    case "code_review":
      return codeReviewAttachment(artifact.payload);
    default:
      return null;
  }
}

function docAttachment(doc: DocArtifact): EmailAttachment {
  const slug = slugify(doc.title) || "report";
  const body = doc.markdown.startsWith("# ")
    ? doc.markdown
    : `# ${doc.title}\n\n${doc.markdown}`;
  return {
    filename: `${slug}.md`,
    content: body,
    contentType: "text/markdown",
  };
}

function leaderboardAttachment(lb: LeaderboardArtifact): EmailAttachment {
  const slug = slugify(lb.title) || "leaderboard";
  const lines: string[] = [];
  // Header: rank + every column key
  const cols = lb.columns;
  lines.push(["rank", ...cols.map((c) => c.key)].map(csvCell).join(","));
  // Rows are already sorted by score desc when the artifact is built;
  // reapply sort_by here just in case.
  const rows = [...lb.rows].sort((a, b) => b.score - a.score);
  rows.forEach((r, i) => {
    const cells: (string | number | null)[] = [i + 1];
    for (const c of cols) {
      const v = r.values[c.key];
      cells.push(v ?? "");
    }
    lines.push(cells.map(csvCell).join(","));
  });
  return {
    filename: `${slug}.csv`,
    content: lines.join("\n"),
    contentType: "text/csv",
  };
}

function codeReviewAttachment(cr: CodeReviewArtifact): EmailAttachment {
  // Repo names contain `/` which isn't filename-safe.
  const repoSlug = cr.repo.replace(/[^a-z0-9-]+/gi, "-").replace(/-+/g, "-");
  return {
    filename: `${repoSlug}-pr${cr.pr_number}-review.json`,
    content: JSON.stringify(cr, null, 2),
    contentType: "application/json",
  };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
