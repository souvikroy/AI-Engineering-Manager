import Anthropic from "@anthropic-ai/sdk";

export const MODELS = {
  reasoning: "claude-opus-4-5",
  fast: "claude-haiku-4-5",
} as const;


export function resolveModel(kind: keyof typeof MODELS): string {
  const override = kind === "reasoning" ? process.env.ANTHROPIC_MODEL_REASONING : process.env.ANTHROPIC_MODEL_FAST;
  return override ?? MODELS[kind];
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
    client = new Anthropic({ apiKey });
  }
  return client;
}

type Block = { type: "text"; text: string; cache_control?: { type: "ephemeral" } };

export type CompleteParams = {
  model?: keyof typeof MODELS;
  system?: string | Block[];
  messages: { role: "user" | "assistant"; content: string | Block[] }[];
  maxTokens?: number;
  temperature?: number;
};

export async function complete(params: CompleteParams): Promise<string> {
  const c = getClient();
  const res = await c.messages.create({
    model: resolveModel(params.model ?? "reasoning"),
    max_tokens: params.maxTokens ?? 2048,
    temperature: params.temperature ?? 0.2,
    system: params.system as never,
    messages: params.messages as never,
  });
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

export async function completeJSON<T>(params: CompleteParams & { schema?: string }): Promise<T> {
  const text = await complete({
    ...params,
    messages: [
      ...params.messages,
      { role: "assistant", content: "{" },
    ],
  });
  const json = "{" + text;
  const cleaned = stripCodeFence(json);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`Model did not return JSON: ${text.slice(0, 200)}`);
    return JSON.parse(match[0]) as T;
  }
}

function stripCodeFence(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

export async function* stream(params: CompleteParams): AsyncIterable<string> {
  const c = getClient();
  const res = await c.messages.stream({
    model: resolveModel(params.model ?? "reasoning"),
    max_tokens: params.maxTokens ?? 2048,
    temperature: params.temperature ?? 0.4,
    system: params.system as never,
    messages: params.messages as never,
  });
  for await (const event of res) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }
}

export function cached(text: string): Block[] {
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}
