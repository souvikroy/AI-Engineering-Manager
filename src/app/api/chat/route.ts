import { stream } from "@/lib/anthropic";
import { getLatestBrief } from "@/lib/modules/daily-brief";
import { listOKRs } from "@/lib/modules/execution-tower";
import { listIncidents } from "@/lib/modules/interrupt-memory";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { messages } = (await req.json()) as { messages: { role: "user" | "assistant"; content: string }[] };

  const [brief, okrs, incidents] = await Promise.all([getLatestBrief(), listOKRs(), listIncidents()]);

  const system = `You are an AI Engineering Manager copilot for a CEO. You have read access to:
- The latest daily intelligence brief (below)
- All team OKRs and progress (below)
- Open incidents (below)

Be direct, specific, and quantitative. Cite engineer names, ticket keys, OKR IDs, and incident IDs from the context.
If the user asks something that requires data not in context, say "I don't have that in the current brief — would you like me to refresh?" rather than hallucinating.

# Latest Brief
${brief ? JSON.stringify(brief, null, 2) : "(no brief yet — user should generate one)"}

# OKRs
${JSON.stringify(okrs, null, 2)}

# Open Incidents
${JSON.stringify(incidents.filter((i) => i.status === "open"), null, 2)}`;

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream({ system, messages, maxTokens: 1500, temperature: 0.4 })) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      } catch (err) {
        controller.enqueue(encoder.encode(`\n\n[error: ${(err as Error).message}]`));
        controller.close();
      }
    },
  });

  return new Response(readable, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
