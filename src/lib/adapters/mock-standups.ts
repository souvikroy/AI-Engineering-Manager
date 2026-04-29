import fs from "node:fs";
import path from "node:path";
import type { IStandupAdapter, Standup } from "./types";

type Raw = { asOf: string; updates: Standup[] };

function load(): Raw {
  const file = path.resolve(process.cwd(), "data/standups.json");
  return JSON.parse(fs.readFileSync(file, "utf8")) as Raw;
}

export const standups: IStandupAdapter = {
  async forDate(date: string) {
    const raw = load();
    return raw.updates.filter((u) => u.date === date || raw.asOf === date);
  },
};
