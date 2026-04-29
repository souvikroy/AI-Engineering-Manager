"use client";

import { useEffect, useState } from "react";
import { Card, Pill, SectionHeader } from "@/components/Card";
import { Button } from "@/components/Button";
import { Siren, Clock, Loader2, Sparkles, Activity } from "lucide-react";

type Incident = { id: string; title: string; severity: string; status: string; openedAt: string; resolvedAt: string | null; ownerId: string | null; summary: string };
type Summary = { situation: string; suggestedActions: string[]; suggestedOwner: string | null };
type Postmortem = { id: string; timeline: string; rootCause: string; actionItems: string[] };

export default function IncidentsPage() {
  const [list, setList] = useState<Incident[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [postmortem, setPostmortem] = useState<Postmortem | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/incidents").then((r) => r.json()).then((j) => setList(j.incidents ?? []));
  }, []);

  async function summarize(id: string) {
    setActive(id);
    setSummary(null);
    setPostmortem(null);
    setLoading("summary");
    try {
      const j = (await (await fetch(`/api/incidents/${id}/summary`, { method: "POST" })).json()) as { summary: Summary };
      setSummary(j.summary);
    } finally {
      setLoading(null);
    }
  }

  async function buildPostmortem() {
    if (!active) return;
    setLoading("postmortem");
    try {
      const j = (await (await fetch(`/api/incidents/${active}/postmortem`, { method: "POST" })).json()) as { postmortem: Postmortem };
      setPostmortem(j.postmortem);
    } finally {
      setLoading(null);
    }
  }

  const open = list.filter((i) => i.status === "open");
  const resolved = list.filter((i) => i.status !== "open");

  return (
    <div className="space-y-8 animate-fade-in">
      <header className="space-y-2">
        <SectionHeader kicker="Interrupt + memory">incident copilot · context restore · auto post-mortem</SectionHeader>
        <h1 className="text-[28px] font-semibold tracking-tight">Stay coherent under interrupt.</h1>
      </header>

      <Card title={`Active alerts (${open.length})`} subtitle="Live operational state" icon={<Activity className="w-4 h-4" strokeWidth={1.75} />}>
        {open.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <Clock className="w-5 h-5 text-ok mx-auto mb-2" strokeWidth={1.5} />
            <p className="text-[12.5px] text-ink-dim">All systems steady — no open incidents.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {open.map((i) => (
              <IncidentRow key={i.id} incident={i} active={active === i.id} onClick={() => summarize(i.id)} />
            ))}
          </ul>
        )}
      </Card>

      {resolved.length > 0 && (
        <Card title="Recent (resolved)" subtitle={`${resolved.length} closed`} icon={<Clock className="w-4 h-4" strokeWidth={1.75} />}>
          <ul className="space-y-2">
            {resolved.map((i) => (
              <IncidentRow key={i.id} incident={i} active={active === i.id} onClick={() => summarize(i.id)} />
            ))}
          </ul>
        </Card>
      )}

      {active && (
        <Card
          title={`Incident · ${active}`}
          subtitle={loading === "summary" ? "Summarizing…" : summary?.situation}
          icon={<Siren className="w-4 h-4 text-accent" strokeWidth={1.75} />}
          action={
            <Button onClick={buildPostmortem} disabled={loading !== null} variant="primary">
              {loading === "postmortem" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {loading === "postmortem" ? "Working" : "Generate post-mortem"}
            </Button>
          }
        >
          {!summary ? (
            <div className="flex items-center gap-2 text-[12.5px] text-ink-dim py-2">
              {loading === "summary" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {loading === "summary" ? "Working through telemetry…" : ""}
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="text-[10.5px] uppercase tracking-[0.18em] text-ink-faint font-medium mb-1.5">Suggested actions</div>
                <ul className="space-y-1.5">
                  {summary.suggestedActions.map((a, i) => (
                    <li key={i} className="text-[13px] text-ink/90 flex gap-2">
                      <span className="text-accent shrink-0 font-mono text-[11px] tabular-nums mt-0.5">{String(i + 1).padStart(2, "0")}</span>
                      {a}
                    </li>
                  ))}
                </ul>
              </div>
              {summary.suggestedOwner && (
                <p className="text-[12px] text-ink-dim">
                  Suggested owner: <span className="font-mono text-accent">{summary.suggestedOwner}</span>
                </p>
              )}
            </div>
          )}

          {postmortem && (
            <div className="mt-6 pt-5 border-t border-border space-y-4 animate-slide-up">
              <Block kicker="Timeline">
                <pre className="whitespace-pre-wrap text-[12px] bg-bg-elevated/60 border border-border rounded-lg p-3 font-mono text-ink/90">{postmortem.timeline}</pre>
              </Block>
              <Block kicker="Root cause">
                <p className="text-[13px] text-ink/90 leading-relaxed">{postmortem.rootCause}</p>
              </Block>
              <Block kicker="Action items">
                <ul className="space-y-1.5">
                  {postmortem.actionItems.map((a, i) => (
                    <li key={i} className="text-[12.5px] text-ink/90 flex gap-2">
                      <span className="text-accent shrink-0">▸</span>
                      {a}
                    </li>
                  ))}
                </ul>
              </Block>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function IncidentRow({ incident, active, onClick }: { incident: Incident; active: boolean; onClick: () => void }) {
  return (
    <li>
      <button
        onClick={onClick}
        className={`w-full text-left p-3 rounded-lg border transition-all ${
          active
            ? "border-accent/40 bg-accent/[0.06]"
            : "border-border bg-surface hover:bg-surface-hover hover:border-border-strong"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <span
              className={`mt-1 w-2 h-2 rounded-full shrink-0 ${
                incident.status === "open"
                  ? incident.severity === "p1"
                    ? "bg-bad animate-pulse-soft"
                    : incident.severity === "p2"
                    ? "bg-warn animate-pulse-soft"
                    : "bg-ink-faint animate-pulse-soft"
                  : "bg-ok"
              }`}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <Pill tone={incident.severity === "p1" ? "bad" : incident.severity === "p2" ? "warn" : "muted"} size="xs">
                  {incident.severity.toUpperCase()}
                </Pill>
                <span className="text-[11px] text-ink-faint font-mono">{incident.id}</span>
              </div>
              <p className="text-[13px] font-medium text-ink leading-snug">{incident.title}</p>
              <p className="text-[11.5px] text-ink-faint mt-0.5">{incident.summary}</p>
            </div>
          </div>
          <span className="text-[11px] text-ink-faint shrink-0">{incident.ownerId ?? "unassigned"}</span>
        </div>
      </button>
    </li>
  );
}

function Block({ kicker, children }: { kicker: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-[0.18em] text-ink-faint font-medium mb-1.5">{kicker}</div>
      {children}
    </div>
  );
}
