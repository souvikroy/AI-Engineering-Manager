/**
 * Resend wrapper. Falls back to a console-logging mock when RESEND_API_KEY
 * isn't set, so the rest of the system works during local dev without
 * shipping mail. The mock returns a faux id so callers can treat success
 * uniformly.
 *
 * Required env:
 *   RESEND_API_KEY — get from https://resend.com/api-keys
 *   RESEND_FROM    — verified sender (e.g. "CTO Brain <brain@yourdomain.com>")
 *                    Falls back to "CTO Brain <onboarding@resend.dev>", which
 *                    is Resend's test sender — works ONLY for self-sending
 *                    (recipient must be the account owner). Add a verified
 *                    domain in Resend to send to anyone else.
 *   USER_EMAIL     — single env-wide recipient for scheduled-task emails.
 */
import { Resend } from "resend";

export type EmailAttachment = {
  filename: string;
  /** Plain text content. The wrapper base64-encodes for the wire. */
  content: string;
  /** Mime type for clients that respect it; defaults to text/plain. */
  contentType?: string;
};

export type SendArgs = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
  replyTo?: string;
};

export type SendResult =
  | { ok: true; id: string; mocked: boolean }
  | { ok: false; error: string };

let client: Resend | null = null;

function getClient(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!client) client = new Resend(process.env.RESEND_API_KEY);
  return client;
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

const DEFAULT_FROM = "CTO Brain <onboarding@resend.dev>";

export async function sendEmail(args: SendArgs): Promise<SendResult> {
  const c = getClient();
  const from = process.env.RESEND_FROM ?? DEFAULT_FROM;
  const to = Array.isArray(args.to) ? args.to : [args.to];

  // ── Mock fallback ────────────────────────────────────────────────
  if (!c) {
    console.log(
      `[email:mock] would send to ${to.join(",")} from ${from} | subject="${args.subject}" | attachments=${args.attachments?.length ?? 0}`,
    );
    return {
      ok: true,
      id: `mock_${Date.now().toString(36)}`,
      mocked: true,
    };
  }

  // ── Real send ────────────────────────────────────────────────────
  try {
    const res = await c.emails.send({
      from,
      to,
      subject: args.subject,
      html: args.html,
      ...(args.text ? { text: args.text } : {}),
      ...(args.replyTo ? { replyTo: args.replyTo } : {}),
      ...(args.attachments && args.attachments.length > 0
        ? {
            attachments: args.attachments.map((a) => ({
              filename: a.filename,
              // Resend SDK accepts string content (base64-encoded) or a Buffer.
              // Buffer is the more reliable path for binary, but our renderers
              // emit text. Send as a Buffer to skip ambiguity.
              content: Buffer.from(a.content, "utf8"),
              ...(a.contentType ? { contentType: a.contentType } : {}),
            })),
          }
        : {}),
    });
    if (res.error) {
      return { ok: false, error: res.error.message ?? String(res.error) };
    }
    return {
      ok: true,
      id: res.data?.id ?? "unknown",
      mocked: false,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
