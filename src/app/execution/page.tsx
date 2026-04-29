"use client";

import { useEffect, useState } from "react";
import { Card, Pill } from "@/components/Card";

type OKR = { id: string; teamName: string; objective: string; keyResults: string[]; progress: number; status: string };
type Status = { headline: string; progress: string[]; risks: string[]; decisionsNeeded: string[] };
type Rebalance = { delay: { item: string; reason: string }[]; accelerate: { item: string; reason: string }[] };

export default function ExecutionPage() {
  const [okrs, setOkrs] = useState<OKR[]>([]);
  const [uncovered, setUncovered] = useState<{ ticket: string; reason: string }[]>([]);
  const [report, setReport] = useState<Status | null>(null);
  const [reb, setReb] = useState<Rebalance | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/execution/okrs").then((r) => r.json()).then((j) => {
      setOkrs(j.okrs ?? []);
      setUncovered(j.uncovered ?? []);
    });
  }, []);

  async function run(endpoint: string, kind: "report" | "reb") {
    setLoading(kind);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const j = await res.json();
      if (kind === "report") setReport(j.report);
      if (kind === "reb") setReb(j);
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Execution Control Tower</h1>
        <p className="text-sm text-muted mt-1">OKRs, status reports, priority rebalancing.</p>
      </header>

      <Card title="Team OKRs" subtitle={`${okrs.length} objectives across ${new Set(okrs.map((o) => o.teamName)).size} teams`}>
        <ul className="space-y-3">
          {okrs.map((o) => (
            <li key={o.id} className="border border-border rounded p-3 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <Pill tone={o.status === "on_track" ? "ok" : o.status === "at_risk" ? "warn" : "bad"}>{o.teamName}</Pill>
                  <span className="ml-2 font-medium">{o.objective}</span>
                </div>
                <span className="text-xs text-muted">{Math.round(o.progress * 100)}%</span>
              </div>
              <div className="w-full h-1.5 bg-border rounded mt-2">
                <div className={`h-full rounded ${o.status === "on_track" ? "bg-ok" : o.status === "at_risk" ? "bg-warn" : "bg-bad"}`} style={{ width: `${o.progress * 100}%` }} />
              </div>
              <ul className="mt-2 text-xs text-muted list-disc pl-4">
                {o.keyResults.map((kr, i) => <li key={i}>{kr}</li>)}
              </ul>
            </li>
          ))}
        </ul>
        {uncovered.length > 0 && (
          <div className="mt-4">
            <h3 className="text-xs uppercase text-muted mb-1">Work not tied to any OKR (candidates to stop)</h3>
            <ul className="text-xs text-white/85 list-disc pl-5">
              {uncovered.map((u) => (<li key={u.ticket}><span className="font-mono text-warn">{u.ticket}</span> — {u.reason}</li>))}
            </ul>
          </div>
        )}
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Auto status report" subtitle="Leadership-ready summary" action={
          <button onClick={() => run("/api/execution/status-report", "report")} disabled={loading !== null} className="bg-accent hover:bg-accent/80 text-white text-xs px-3 py-1.5 rounded disabled:opacity-50">
            {loading === "report" ? "Working…" : "Generate"}
          </button>
        }>
          {!report ? <p className="text-xs text-muted">Click Generate.</p> : (
            <div className="text-sm space-y-2">
              <p className="font-medium">{report.headline}</p>
              <Section title="Progress" items={report.progress} />
              <Section title="Risks" items={report.risks} tone="warn" />
              <Section title="Decisions needed" items={report.decisionsNeeded} tone="bad" />
            </div>
          )}
        </Card>

        <Card title="Priority rebalancer" subtitle="What to delay, what to accelerate" action={
          <button onClick={() => run("/api/execution/rebalance", "reb")} disabled={loading !== null} className="bg-accent hover:bg-accent/80 text-white text-xs px-3 py-1.5 rounded disabled:opacity-50">
            {loading === "reb" ? "Working…" : "Generate"}
          </button>
        }>
          {!reb ? <p className="text-xs text-muted">Click Generate.</p> : (
            <div className="text-sm space-y-3">
              <div>
                <h3 className="text-xs uppercase text-muted mb-1">Delay</h3>
                <ul className="space-y-1 text-xs">
                  {reb.delay.map((d, i) => (<li key={i}><Pill tone="warn">delay</Pill> <b>{d.item}</b> — {d.reason}</li>))}
                </ul>
              </div>
              <div>
                <h3 className="text-xs uppercase text-muted mb-1">Accelerate</h3>
                <ul className="space-y-1 text-xs">
                  {reb.accelerate.map((d, i) => (<li key={i}><Pill tone="ok">accelerate</Pill> <b>{d.item}</b> — {d.reason}</li>))}
                </ul>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Section({ title, items, tone = "muted" }: { title: string; items: string[]; tone?: "muted" | "warn" | "bad" }) {
  const colors: Record<string, string> = { muted: "text-muted", warn: "text-warn", bad: "text-bad" };
  return (
    <div>
      <div className={`text-xs uppercase ${colors[tone]} mb-1`}>{title}</div>
      <ul className="list-disc pl-5 text-xs text-white/85">
        {items.length === 0 ? <li className="text-muted">(none)</li> : items.map((s, i) => <li key={i}>{s}</li>)}
      </ul>
    </div>
  );
}
