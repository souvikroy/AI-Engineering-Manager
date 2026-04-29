"use client";

import { useEffect, useState } from "react";
import { Card, Pill } from "@/components/Card";

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

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Incidents & Interrupts</h1>
        <p className="text-sm text-muted mt-1">Active alerts, copilot summaries, post-mortems.</p>
      </header>

      <Card title="Active and recent incidents">
        <ul className="space-y-2">
          {list.map((i) => (
            <li key={i.id}>
              <button onClick={() => summarize(i.id)} className={`w-full text-left p-3 border rounded text-sm ${active === i.id ? "border-accent bg-accent/10" : "border-border hover:bg-border"}`}>
                <div className="flex items-center justify-between">
                  <span><Pill tone={i.severity === "p1" ? "bad" : i.severity === "p2" ? "warn" : "muted"}>{i.severity.toUpperCase()}</Pill> <b className="ml-2">{i.title}</b></span>
                  <span className="text-xs text-muted">{i.status} · {i.ownerId ?? "unassigned"}</span>
                </div>
                <p className="text-xs text-muted mt-1">{i.summary}</p>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {active && (
        <Card title={`Incident ${active}`} action={
          <button onClick={buildPostmortem} disabled={loading !== null} className="bg-accent hover:bg-accent/80 text-white text-xs px-3 py-1.5 rounded disabled:opacity-50">
            {loading === "postmortem" ? "Working…" : "Generate post-mortem"}
          </button>
        }>
          {!summary ? <p className="text-sm text-muted">{loading === "summary" ? "Summarizing…" : ""}</p> : (
            <div className="text-sm space-y-3">
              <div>
                <h3 className="text-xs uppercase text-muted mb-1">Situation</h3>
                <p>{summary.situation}</p>
              </div>
              <div>
                <h3 className="text-xs uppercase text-muted mb-1">Suggested actions</h3>
                <ul className="list-disc pl-5">
                  {summary.suggestedActions.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              </div>
              {summary.suggestedOwner && (<p className="text-xs text-muted">Suggested owner: <span className="font-mono text-accent">{summary.suggestedOwner}</span></p>)}
            </div>
          )}

          {postmortem && (
            <div className="mt-5 border-t border-border pt-4 text-sm space-y-3">
              <div>
                <h3 className="text-xs uppercase text-muted mb-1">Timeline</h3>
                <pre className="whitespace-pre-wrap text-xs bg-bg border border-border rounded p-3">{postmortem.timeline}</pre>
              </div>
              <div>
                <h3 className="text-xs uppercase text-muted mb-1">Root cause</h3>
                <p>{postmortem.rootCause}</p>
              </div>
              <div>
                <h3 className="text-xs uppercase text-muted mb-1">Action items</h3>
                <ul className="list-disc pl-5">
                  {postmortem.actionItems.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
