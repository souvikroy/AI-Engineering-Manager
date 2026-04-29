import fs from "node:fs";
import path from "node:path";
import type { ISlackAdapter, SlackMessage, HesitationSignal } from "./types";

type Raw = {
  channels: { name: string; messages: { ts: string; user: string; text: string }[] }[];
  hesitation_signals: HesitationSignal[];
};

function load(): Raw {
  const file = path.resolve(process.cwd(), "data/slack.json");
  return JSON.parse(fs.readFileSync(file, "utf8")) as Raw;
}

export const slack: ISlackAdapter = {
  async recentMessages(channels?: string[]): Promise<SlackMessage[]> {
    const raw = load();
    const out: SlackMessage[] = [];
    for (const c of raw.channels) {
      if (channels && !channels.includes(c.name)) continue;
      for (const m of c.messages) out.push({ channel: c.name, ...m });
    }
    return out.sort((a, b) => a.ts.localeCompare(b.ts));
  },
  async hesitationSignals() {
    return load().hesitation_signals;
  },
};
