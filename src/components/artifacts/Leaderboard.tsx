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

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-kicker text-ink-faint font-semibold">
          <span>Leaderboard</span>
          <span className="text-ink-ghost">·</span>
          <span className="normal-case tracking-normal">{artifact.window}</span>
        </div>
        <h2 className="mt-1 text-[18px] font-semibold tracking-tight2 text-ink">
          {artifact.title}
        </h2>
        {artifact.formula ? (
          <p className="mt-1 text-[11px] text-ink-faint font-mono">{artifact.formula}</p>
        ) : null}
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-[12.5px]">
          <thead className="sticky top-0 bg-bg-elevated/95 backdrop-blur z-10">
            <tr className="border-b border-border">
              <th className="px-3 py-2.5 text-left text-[10px] uppercase tracking-kicker text-ink-faint font-semibold w-10">
                #
              </th>
              {artifact.columns.map((col) => {
                const active = col.key === sortKey;
                return (
                  <th
                    key={col.key}
                    className={`px-3 py-2.5 text-[10px] uppercase tracking-kicker font-semibold cursor-pointer select-none hover:text-ink ${
                      col.type === "text" ? "text-left" : "text-right"
                    } ${active ? "text-ink" : "text-ink-faint"}`}
                    onClick={() => toggleSort(col.key)}
                  >
                    <span className="inline-flex items-center gap-1">
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
                className="border-b border-border/40 hover:bg-bg-elevated/40 transition-colors"
              >
                <td className="px-3 py-2 text-ink-faint tabular-nums">{i + 1}</td>
                {artifact.columns.map((col) => {
                  const v = row.values[col.key];
                  return (
                    <td
                      key={col.key}
                      className={`px-3 py-2 ${
                        col.type === "text" ? "text-left" : "text-right tabular-nums"
                      } ${col.key === "score" ? "font-semibold text-ink" : "text-ink-dim"}`}
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
