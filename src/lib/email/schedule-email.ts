/**
 * Compose + send the email that follows a scheduled chat fire.
 *
 * Email shape (per the user's choice — "inline summary + file attachments"):
 *   - Subject: "<schedule name> — <short date>"
 *   - HTML body: small editorial header + the assistant's chat reply rendered
 *     with light markdown→HTML conversion + sources line + "View in CTO Brain"
 *     link.
 *   - Attachment: the artifact rendered to its native file format (md/csv/json).
 *     Skipped if the assistant didn't produce an artifact.
 *
 * Best-effort. Failures are logged and don't block the schedule fire.
 */
import type { Schedule } from "@prisma/client";
import { sendEmail } from "./resend";
import { artifactToAttachment } from "./artifact-attachment";
import type { ChatArtifact, StoredMsg } from "@/lib/chat/store";

export type ScheduleEmailInput = {
  schedule: Schedule;
  /** The just-appended assistant message (with citations, freshness etc.). */
  assistant: StoredMsg;
  /** Linked artifact, if the assistant produced one. */
  artifact: ChatArtifact | null;
  /** The session id, used for the back-link. */
  sessionId: string;
  /** Wall-clock fire time (formatted in local TZ). */
  firedAt: Date;
};

export type ScheduleEmailResult =
  | { ok: true; id: string; mocked: boolean }
  | { ok: false; reason: "no_recipient" | "send_failed"; error?: string };

export async function sendScheduleEmail(
  input: ScheduleEmailInput,
): Promise<ScheduleEmailResult> {
  const to = process.env.USER_EMAIL?.trim();
  if (!to) {
    return { ok: false, reason: "no_recipient" };
  }

  const subject = buildSubject(input.schedule.name, input.firedAt);
  const html = renderHtml(input);
  const text = renderPlainText(input);
  const attachments = input.artifact
    ? [artifactToAttachment(input.artifact)].filter(
        (a): a is NonNullable<typeof a> => a !== null,
      )
    : [];

  const res = await sendEmail({
    to,
    subject,
    html,
    text,
    attachments,
  });
  if (!res.ok) {
    return { ok: false, reason: "send_failed", error: res.error };
  }
  return { ok: true, id: res.id, mocked: res.mocked };
}

// ── Subject ─────────────────────────────────────────────────────────

function buildSubject(name: string, firedAt: Date): string {
  const date = firedAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  return `${name} — ${date}`;
}

// ── HTML body ───────────────────────────────────────────────────────

function renderHtml(input: ScheduleEmailInput): string {
  const { schedule, assistant, artifact, sessionId, firedAt } = input;
  const stamp = firedAt.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  // Light markdown → HTML for the assistant body. Rather than pull in a full
  // markdown lib here (and inflate the bundle), we do the small subset our
  // model output uses: paragraphs, **bold**, _italic_, `code`, lists, links.
  const bodyHtml = mdLite(assistant.content || "(no response generated)");

  const cite = (assistant.citations ?? []).slice(0, 6);
  const citationLine =
    cite.length > 0
      ? `<p style="margin:18px 0 0;font-size:12px;color:#888;">
           <em style="font-style:italic;">Sources:</em>
           ${cite
             .map((c) =>
               c.url
                 ? `<a href="${escapeHtml(c.url)}" style="color:#fb923c;text-decoration:none;border-bottom:1px solid #fb923c40;">${escapeHtml(c.kind)}/${escapeHtml(c.id)}</a>`
                 : `<span>${escapeHtml(c.kind)}/${escapeHtml(c.id)}</span>`,
             )
             .join(" &middot; ")}
         </p>`
      : "";

  const sourcesChecked =
    assistant.sources_checked && assistant.sources_checked.length > 0
      ? `<p style="margin:6px 0 0;font-size:11px;color:#999;letter-spacing:0.08em;text-transform:uppercase;">
           ✦ Checked: ${assistant.sources_checked.join(" · ")}
         </p>`
      : "";

  const verdictBadge = (() => {
    if (!assistant.verdict || assistant.verdict === "skip") return "";
    const map: Record<string, { label: string; bg: string; fg: string }> = {
      ok: { label: "Verified", bg: "#0c3d2c", fg: "#34d399" },
      weak: { label: "Partial", bg: "#3a2c0c", fg: "#fbbf24" },
      unsupported: { label: "Unverified", bg: "#3a0c0c", fg: "#f87171" },
    };
    const v = map[assistant.verdict];
    if (!v) return "";
    return `<span style="display:inline-block;padding:2px 10px;border-radius:999px;background:${v.bg};color:${v.fg};font-size:11px;font-style:italic;margin-left:8px;">${v.label}</span>`;
  })();

  const artifactRow = artifact
    ? `<p style="margin:18px 0 0;padding:10px 14px;background:#1a1612;border-radius:8px;font-size:12.5px;color:#aaa;">
         📎 Full ${escapeHtml(artifact.kind === "code_review" ? "code review" : artifact.kind)} artifact attached as
         <strong style="color:#f4ead9;">${escapeHtml(attachmentFilename(artifact))}</strong>
       </p>`
    : "";

  const localBase =
    process.env.PUBLIC_BASE_URL?.replace(/\/+$/, "") ??
    `http://localhost:${process.env.PORT ?? "3000"}`;
  const link = `${localBase}/chat`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(schedule.name)}</title>
  </head>
  <body style="margin:0;padding:0;background:#0c0a08;color:#e6e3df;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0c0a08;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#15110d;border-radius:12px;padding:32px;box-shadow:0 18px 40px -16px rgba(0,0,0,0.6);">
            <tr>
              <td>
                <p style="margin:0 0 6px;font-size:11px;color:#888;letter-spacing:0.16em;text-transform:uppercase;font-style:italic;">
                  ✦ Scheduled brief
                </p>
                <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:400;letter-spacing:-0.018em;color:#f4ead9;line-height:1.2;">
                  ${escapeHtml(schedule.name)}${verdictBadge}
                </h1>
                <p style="margin:6px 0 0;font-size:12.5px;color:#888;font-style:italic;">
                  Auto-fired ${escapeHtml(stamp)} local
                </p>
                ${sourcesChecked}
                <hr style="border:0;height:1px;background:#2a241e;margin:22px 0 18px;" />
                <div style="font-size:15px;line-height:1.6;color:#e0ddd8;">
                  ${bodyHtml}
                </div>
                ${citationLine}
                ${artifactRow}
                <hr style="border:0;height:1px;background:#2a241e;margin:24px 0 18px;" />
                <p style="margin:0;font-size:12px;color:#888;">
                  <a href="${escapeHtml(link)}" style="color:#fb923c;text-decoration:none;">View in CTO Brain →</a>
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:18px 0 0;font-size:11px;color:#555;">
            Sent because <em style="font-style:italic;">${escapeHtml(schedule.name)}</em> is scheduled.
            <br /> You can disable email for this schedule in the app.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

// ── Plain text fallback (some clients prefer it) ─────────────────────

function renderPlainText(input: ScheduleEmailInput): string {
  const { schedule, assistant, artifact, firedAt } = input;
  const lines: string[] = [];
  lines.push(schedule.name);
  lines.push("=".repeat(schedule.name.length));
  lines.push(`Auto-fired ${firedAt.toLocaleString()} local`);
  lines.push("");
  lines.push(assistant.content || "(no response)");
  if (assistant.citations && assistant.citations.length > 0) {
    lines.push("");
    lines.push(
      "Sources: " +
        assistant.citations.slice(0, 6).map((c) => `${c.kind}/${c.id}`).join(", "),
    );
  }
  if (artifact) {
    lines.push("");
    lines.push(`Full artifact attached as ${attachmentFilename(artifact)}`);
  }
  return lines.join("\n");
}

function attachmentFilename(artifact: ChatArtifact): string {
  if (artifact.kind === "doc") {
    const slug = (artifact.payload.title ?? "report")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
    return `${slug}.md`;
  }
  if (artifact.kind === "leaderboard") {
    const slug = (artifact.payload.title ?? "leaderboard")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
    return `${slug}.csv`;
  }
  return `${artifact.payload.repo.replace(/[^a-z0-9-]+/gi, "-")}-pr${artifact.payload.pr_number}-review.json`;
}

// ── Tiny markdown → HTML (no external dep) ───────────────────────────

function mdLite(md: string): string {
  // Escape first; we add HTML back in controlled places.
  let s = escapeHtml(md);
  // **bold**
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  // _italic_ (simple, no nested)
  s = s.replace(/(^|[^\w*])_([^_\n]+)_/g, "$1<em>$2</em>");
  // `code`
  s = s.replace(
    /`([^`\n]+)`/g,
    `<code style="background:#1a1612;padding:1px 6px;border-radius:4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:0.9em;">$1</code>`,
  );
  // [text](url) — links
  s = s.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    `<a href="$2" style="color:#fb923c;text-decoration:none;border-bottom:1px solid #fb923c40;">$1</a>`,
  );
  // Bullet lists: lines starting with `- ` get wrapped
  const lines = s.split(/\n/);
  const out: string[] = [];
  let inList = false;
  for (const l of lines) {
    const m = /^[-*]\s+(.*)$/.exec(l);
    if (m) {
      if (!inList) {
        out.push('<ul style="margin:8px 0;padding-left:20px;">');
        inList = true;
      }
      out.push(`<li style="margin:3px 0;">${m[1]}</li>`);
    } else {
      if (inList) {
        out.push("</ul>");
        inList = false;
      }
      out.push(l);
    }
  }
  if (inList) out.push("</ul>");
  // Paragraphs: split on double newlines outside of lists.
  const joined = out.join("\n");
  const parts = joined.split(/\n{2,}/);
  return parts
    .map((p) => {
      const trimmed = p.trim();
      if (!trimmed) return "";
      // If it already starts with a block tag, don't wrap.
      if (/^<(ul|ol|p|h\d|blockquote|hr|pre)/.test(trimmed)) return trimmed;
      return `<p style="margin:0 0 12px;">${trimmed.replace(/\n/g, "<br />")}</p>`;
    })
    .join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
