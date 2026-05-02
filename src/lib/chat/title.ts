/**
 * Auto-titling for chat sessions.
 *
 * Cheap fallback if Haiku is unreachable: first 6-8 words of the message,
 * trimmed and proper-cased. Otherwise asks Haiku for a 4-6 word title in
 * lowercase, no punctuation.
 */
import { complete } from "@/lib/anthropic";

const FALLBACK_LEN = 60;

export function fallbackTitle(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= FALLBACK_LEN) return cleaned;
  return cleaned.slice(0, FALLBACK_LEN - 1).trimEnd() + "…";
}

export async function autoTitle(firstUserMessage: string): Promise<string> {
  if (!firstUserMessage.trim()) return "New chat";
  if (!process.env.ANTHROPIC_API_KEY) return fallbackTitle(firstUserMessage);
  try {
    const text = await complete({
      model: "fast",
      system:
        "You write 4-6 word titles for engineering-management chat threads. " +
        "Be specific and noun-led. No punctuation. No quotes. Return only the title.",
      messages: [
        {
          role: "user",
          content: firstUserMessage.slice(0, 600),
        },
      ],
      maxTokens: 24,
      temperature: 0.2,
    });
    const t = text
      .replace(/^[\s"']+|[\s"'.!?]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!t || t.length > 80) return fallbackTitle(firstUserMessage);
    return t;
  } catch {
    return fallbackTitle(firstUserMessage);
  }
}
