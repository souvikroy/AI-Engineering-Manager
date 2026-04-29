import fs from "node:fs";
import path from "node:path";
import type { Alert, IMonitoringAdapter, ServiceHealth } from "./types";

type Raw = { services: ServiceHealth[]; alerts: Alert[] };

function load(): Raw {
  const file = path.resolve(process.cwd(), "data/monitoring.json");
  return JSON.parse(fs.readFileSync(file, "utf8")) as Raw;
}

export const monitoring: IMonitoringAdapter = {
  async services() {
    return load().services;
  },
  async alerts(opts) {
    const all = load().alerts;
    if (opts?.open) return all.filter((a) => a.status === "open");
    return all;
  },
};
