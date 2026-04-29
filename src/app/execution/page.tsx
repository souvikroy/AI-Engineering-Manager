"use client";

import { useEffect, useState } from "react";
import { Card, Pill, SectionHeader } from "@/components/Card";
import { Button } from "@/components/Button";
import { Target, FileBarChart, ListChecks, Loader2, AlertTriangle, Zap, TimerReset, Sparkles } from "lucide-react";

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
    <div className="space-y-8 animate-fade-in">
      <header className="space-y-2">
        <SectionHeader kicker="Execution control tower">OKR delivery · status reports · priority rebalancing</SectionHeader>
        <h1 className="text-[28px] font-semibold tracking-tight">Strategy meets ground truth.</h1>
      </header>

      <Card title="Team OKRs" subtitle={`${okrs.length} objectives · ${new Set(okrs.map((o) => o.teamName)).size} teams · Q2-2026`} icon={<Target className="w-4 h-4" strokeWidth={1.75} />}>
        <ul className="space-y-3">
          {okrs.map((o) => (
            <li key={o.id} className="rounded-lg border border-border bg-bg/40 p-4">
              <div className="flex items-start justify-between gap-4 mb-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Pill tone={o.status === "on_track" ? "ok" : o.status === "at_risk" ? "warn" : "bad"} size="xs">{o.teamName}</Pill>
                    <span className="text-[11px] text-ink-faint font-mono">{o.id}</span>
                  </div>
                  <p className="text-[14px] font-medium text-ink leading-snug">{o.objective}</p>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[20px] font-semibold tabular-nums">{Math.round(o.progress * 100)}%</div>
                  <div className="text-[10.5px] uppercase tracking-wider text-ink-faint">{o.status.replace("_", " ")}</div>
                </div>
              </div>
              <div className="h-[3px] rounded-full bg-white/[0.05] overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    o.status === "on_track" ? "bg-ok" : o.status === "at_risk" ? "bg-warn" : "bg-bad"
                  }`}
                  style={{ width: `${o.progress * 100}%` }}
                />
              </div>
              <ul className="mt-3 grid md:grid-cols-3 gap-2">
                {o.keyResults.map((kr, i) => (
                  <li key={i} className="text-[11.5px] text-ink-dim flex gap-1.5 items-start leading-snug">
                    <span className="text-ink-ghost shrink-0">▸</span>
                    <span>{kr}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        {uncovered.length > 0 && (
          <div className="mt-5 pt-4 border-t border-border">
            <div className="text-[10.5px] uppercase tracking-[0.18em] text-warn font-medium mb-2 flex items-center gap-1.5">
              <AlertTriangle className="w-3 h-3" /> Work not tied to any OKR — candidates to stop
            </div>
            <ul className="space-y-1">
              {uncovered.map((u) => (
                <li key={u.ticket} className="text-[12.5px] flex gap-2">
                  <span className="font-mono text-warn shrink-0">{u.ticket}</span>
                  <span className="text-ink-dim">{u.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card
          title="Auto status report"
          subtitle="Leadership-ready, generated from live data"
          icon={<FileBarChart className="w-4 h-4" strokeWidth={1.75} />}
          action={
            <Button onClick={() => run("/api/execution/status-report", "report")} disabled={loading !== null} variant="primary">
              {loading === "report" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {loading === "report" ? "Working" : "Generate"}
            </Button>
          }
        >
          {!report ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center">
              <FileBarChart className="w-5 h-5 text-ink-ghost mx-auto mb-2" strokeWidth={1.5} />
              <p className="text-[12.5px] text-ink-faint">Click Generate for a leadership update.</p>
            </div>
          ) : (
            <div className="space-y-3 text-[13px]">
              <p className="text-[14px] font-semibold text-balance leading-snug">{report.headline}</p>
              <Section icon={<Zap className="w-3 h-3 text-ok" />} title="Progress" items={report.progress} />
              <Section icon={<AlertTriangle className="w-3 h-3 text-warn" />} title="Risks" items={report.risks} />
              <Section icon={<ListChecks className="w-3 h-3 text-bad" />} title="Decisions needed" items={report.decisionsNeeded} />
            </div>
          )}
        </Card>

        <Card
          title="Priority rebalancer"
          subtitle="What to delay, what to accelerate"
          icon={<TimerReset className="w-4 h-4" strokeWidth={1.75} />}
          action={
            <Button onClick={() => run("/api/execution/rebalance", "reb")} disabled={loading !== null} variant="primary">
              {loading === "reb" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {loading === "reb" ? "Working" : "Generate"}
            </Button>
          }
        >
          {!reb ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center">
              <TimerReset className="w-5 h-5 text-ink-ghost mx-auto mb-2" strokeWidth={1.5} />
              <p className="text-[12.5px] text-ink-faint">Click Generate for prioritization advice.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <RebList kind="delay" items={reb.delay} />
              <RebList kind="accelerate" items={reb.accelerate} />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Section({ icon, title, items }: { icon: React.ReactNode; title: string; items: string[] }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-[0.18em] text-ink-faint font-medium mb-1.5 flex items-center gap-1.5">
        {icon} {title}
      </div>
      <ul className="space-y-1">
        {items.length === 0 ? <li className="text-[12px] text-ink-ghost">(none)</li> : items.map((s, i) => (
          <li key={i} className="text-[12.5px] text-ink/90 flex gap-2"><span className="text-ink-ghost shrink-0">▸</span>{s}</li>
        ))}
      </ul>
    </div>
  );
}

function RebList({ kind, items }: { kind: "delay" | "accelerate"; items: { item: string; reason: string }[] }) {
  const tone = kind === "delay" ? "warn" : "ok";
  return (
    <div>
      <div className={`text-[10.5px] uppercase tracking-[0.18em] mb-2 font-medium ${tone === "warn" ? "text-warn" : "text-ok"}`}>
        {kind === "delay" ? "Delay" : "Accelerate"}
      </div>
      <ul className="space-y-1.5">
        {items.length === 0 ? <li className="text-[12px] text-ink-ghost">(none)</li> : items.map((d, i) => (
          <li key={i} className="text-[12.5px]">
            <div className="flex items-center gap-1.5 mb-0.5">
              <Pill tone={tone} size="xs">{kind}</Pill>
              <b className="text-ink">{d.item}</b>
            </div>
            <p className="text-ink-dim ml-1 leading-snug">{d.reason}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
