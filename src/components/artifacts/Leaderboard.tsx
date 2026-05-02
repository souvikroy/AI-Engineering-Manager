"use client";

import { useMemo, useState } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import type { LeaderboardArtifact } from "@/lib/chat/events";

type SortDir = "asc" | "desc";

export function Leaderboard({ artifact }: { artifact: LeaderboardArtifact }) {
  const [sortKey, setSortKey] = useState<string>(artifact.sort_by);
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sortedRows = useMemo(() => {
    const out = [...artifact.rows];
    out.sort((a, b) => {
      const av = a.values[sortKey];
      const bv = b.values[sortKey];
      const an = typeof av === "number" ? av : Number(av) || 0;
      const bn = typeof bv === "number" ? bv : Number(bv) || 0;
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === "asc" ? an - bn : bn - an;
    });
    return out;
  }, [artifact.rows, sortKey, sortDir]);

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  // Top three medal tints — applied to the rank cell only.
  const rankTint = (i: number): string => {
    if (i === 0) return "text-amber-300"; // gold
    if (i === 1) return "text-zinc-300"; // silver
    if (i === 2) return "text-orange-400/80"; // bronze
    return "text-ink-ghost";
  };

  return (
    <div className="flex h-full flex-col">
      <div className="px-8 pt-8 pb-5">
        <div className="flex items-center gap-2 text-kicker">
          <span>✦ Leaderboard</span>
          <span className="text-ink-ghost">·</span>
          <span>{artifact.window}</span>
        </div>
        <h2 className="mt-2 font-display text-h1 text-ink-cream tracking-tight2 leading-tight">
          {artifact.title}
        </h2>
        {artifact.formula ? (
          <p className="mt-2 font-display italic text-caption text-ink-faint max-w-xl">
            {artifact.formula}
          </p>
        ) : null}
      </div>
      <div className="flex-1 overflow-auto px-2 pb-6">
        <table className="w-full border-collapse text-body-md">
          <thead className="sticky top-0 bg-bg-elevated/95 backdrop-blur z-10">
            <tr>
              <th className="px-4 py-2.5 text-left text-kicker w-12">#</th>
              {artifact.columns.map((col) => {
                const active = col.key === sortKey;
                return (
                  <th
                    key={col.key}
                    className={`px-4 py-2.5 cursor-pointer select-none transition-colors ${
                      col.type === "text" ? "text-left" : "text-right"
                    } ${active ? "text-ink-cream" : "text-ink-faint hover:text-ink-dim"}`}
                    onClick={() => toggleSort(col.key)}
                  >
                    <span className="inline-flex items-center gap-1 font-display italic text-[12px] tracking-tight2">
                      {col.label}
                      {active ? (
                        sortDir === "desc" ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronUp className="h-3 w-3" />
                        )
                      ) : null}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, i) => (
              <tr
                key={row.engineer_id}
                className={`transition-colors hover:bg-bg-elevated/40 ${
                  i % 2 === 0 ? "bg-transparent" : "bg-white/[0.012]"
                }`}
              >
                <td
                  className={`px-4 py-3 tabular-nums font-display italic text-[14px] ${rankTint(i)}`}
                >
                  {i + 1}
                </td>
                {artifact.columns.map((col) => {
                  const v = row.values[col.key];
                  const isScore = col.key === "score";
                  const isName = col.key === "engineer_name";
                  return (
                    <td
                      key={col.key}
                      className={`px-4 py-3 ${
                        col.type === "text" ? "text-left" : "text-right tabular-nums"
                      } ${
                        isScore
                          ? "font-display text-[18px] text-ink-cream"
                          : isName
                            ? "text-ink"
                            : "text-ink-dim"
                      }`}
                    >
                      {col.type === "percent" && typeof v === "number"
                        ? `${(v * 100).toFixed(0)}%`
                        : v ?? "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
