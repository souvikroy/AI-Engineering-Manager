"use client";

/**
 * Live per-source data freshness pill.
 *
 * Polls /api/freshness every 60s (cheap, cached at the Python layer). Renders
 * a compact strip "slack 30s · jira 4m · sentry 90s" or, when the Python
 * context engine is offline, an unobtrusive "context engine offline" line.
 *
 * Uses a small dot indicator (live-dot from globals.css) so the user gets a
 * passive freshness signal without screen real estate.
 */
import { useEffect, useState } from "react";

type FreshnessResp =
  | {
      ok: true;
      sources: Record<string, number | null>;
      as_of: string;
    }
  | { ok: false; reason: string; sources: Record<string, number | null>; as_of: string };

const ORDER = [
  "slack",
  "jira",
  "linear",
  "sentry",
  "github",
  "confluence",
  "notion",
  "gsheet",
] as const;

function fmt(ageSec: number): string {
  if (ageSec < 60) return `${ageSec}s`;
  if (ageSec < 3600) return `${Math.round(ageSec / 60)}m`;
  if (ageSec < 86400) return `${Math.round(ageSec / 3600)}h`;
  return `${Math.round(ageSec / 86400)}d`;
}

function tone(ageSec: number): string {
  if (ageSec < 300) return "bg-ok";
  if (ageSec < 3600) return "bg-warn";
  return "bg-bad";
}

export function FreshnessPill({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<FreshnessResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch("/api/freshness", { cache: "no-store" });
        const j = (await r.json()) as FreshnessResp;
        if (!cancelled) {
          setData(j);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }
    load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (error) {
    return (
      <div className="text-[10.5px] text-ink-faint">freshness: {error}</div>
    );
  }
  if (!data) {
    return <div className="text-[10.5px] text-ink-ghost">freshness…</div>;
  }
  if (data.ok === false) {
    return (
      <div className="text-[10.5px] text-ink-faint flex items-center gap-1.5">
        <span className="block w-1.5 h-1.5 rounded-full bg-ink-ghost" />
        context engine offline
      </div>
    );
  }
  const entries = ORDER.map((k) => [k, data.sources[k] ?? null] as const).filter(
    ([, age]) => age != null,
  ) as Array<readonly [string, number]>;

  if (entries.length === 0) {
    return (
      <div className="text-[10.5px] text-ink-faint flex items-center gap-1.5">
        <span className="block w-1.5 h-1.5 rounded-full bg-ink-ghost" />
        no source synced yet
      </div>
    );
  }

  if (compact) {
    const total = entries.length;
    const stale = entries.filter(([, a]) => a > 3600).length;
    const live = entries.filter(([, a]) => a < 300).length;
    return (
      <div className="text-[10.5px] text-ink-faint flex items-center gap-1.5">
        <span
          className={`block w-1.5 h-1.5 rounded-full ${
            stale > 0 ? "bg-warn" : live > 0 ? "bg-ok" : "bg-ink-ghost"
          }`}
        />
        {total} source{total === 1 ? "" : "s"} live
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-ink-faint">
      {entries.map(([k, age]) => (
        <span key={k} className="inline-flex items-center gap-1">
          <span className={`block w-1.5 h-1.5 rounded-full ${tone(age)}`} />
          <span className="font-mono text-ink-dim">{k}</span>
          <span className="tabular-nums">{fmt(age)}</span>
        </span>
      ))}
    </div>
  );
}
