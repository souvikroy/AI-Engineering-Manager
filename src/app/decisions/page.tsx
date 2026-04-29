"use client";

import { useEffect, useState } from "react";
import { Card, Pill } from "@/components/Card";

type Doc = { slug: string; title: string };
type Analysis = {
  title: string;
  summary: string;
  scalabilityRisks: string[];
  flagged: string[];
  tradeoffs: { option: string; pros: string[]; cons: string[] }[];
  relatedDecisions: { id: string; title: string }[];
};

export default function DecisionsPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [optionA, setOptionA] = useState("");
  const [optionB, setOptionB] = useState("");
  const [context, setContext] = useState("");
  const [sim, setSim] = useState<{ table: { dimension: string; a: string; b: string }[]; recommendation: string } | null>(null);

  useEffect(() => {
    fetch("/api/decisions/list")
      .then((r) => r.json())
      .then((j) => setDocs(j.docs ?? []));
  }, []);

  async function analyze(slug: string) {
    setActive(slug);
    setAnalysis(null);
    setLoading(true);
    try {
      const res = await fetch("/api/decisions/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      const j = (await res.json()) as { analysis: Analysis };
      setAnalysis(j.analysis);
    } finally {
      setLoading(false);
    }
  }

  async function runSim() {
    setSim(null);
    setLoading(true);
    try {
      const res = await fetch("/api/decisions/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionA, optionB, context }),
      });
      const j = (await res.json()) as { table: { dimension: string; a: string; b: string }[]; recommendation: string };
      setSim(j);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Decision Engine</h1>
        <p className="text-sm text-muted mt-1">Design-doc analysis, trade-off comparisons, and decision memory.</p>
      </header>

      <Card title="Design docs" subtitle="Click to analyze">
        {docs.length === 0 ? (
          <p className="text-xs text-muted">No design docs in /data/design_docs.</p>
        ) : (
          <ul className="space-y-2">
            {docs.map((d) => (
              <li key={d.slug} className="flex items-center justify-between">
                <span className="text-sm">{d.title}</span>
                <button
                  onClick={() => analyze(d.slug)}
                  className="text-xs bg-accent hover:bg-accent/80 text-white px-3 py-1 rounded"
                >
                  Analyze
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {active && (
        <Card title={`Analysis: ${active}`} subtitle={loading ? "Working…" : analysis?.summary}>
          {!analysis ? (
            <p className="text-sm text-muted">Analyzing…</p>
          ) : (
            <div className="space-y-4 text-sm">
              {analysis.scalabilityRisks.length > 0 && (
                <div>
                  <h3 className="text-xs uppercase text-muted mb-1">Scalability risks</h3>
                  <ul className="list-disc pl-5 text-white/90">
                    {analysis.scalabilityRisks.map((r, i) => (<li key={i}>{r}</li>))}
                  </ul>
                </div>
              )}
              {analysis.flagged.length > 0 && (
                <div>
                  <h3 className="text-xs uppercase text-muted mb-1">Flagged</h3>
                  <ul className="list-disc pl-5 text-white/90">
                    {analysis.flagged.map((r, i) => (<li key={i}>{r}</li>))}
                  </ul>
                </div>
              )}
              {analysis.tradeoffs.length > 0 && (
                <div>
                  <h3 className="text-xs uppercase text-muted mb-1">Trade-offs</h3>
                  <div className="grid md:grid-cols-2 gap-3">
                    {analysis.tradeoffs.map((t, i) => (
                      <div key={i} className="border border-border rounded p-3">
                        <div className="font-semibold mb-2">{t.option}</div>
                        <div className="text-xs text-muted mb-1">Pros</div>
                        <ul className="list-disc pl-4 text-xs text-white/85 mb-2">
                          {t.pros.map((p, j) => (<li key={j}>{p}</li>))}
                        </ul>
                        <div className="text-xs text-muted mb-1">Cons</div>
                        <ul className="list-disc pl-4 text-xs text-white/85">
                          {t.cons.map((p, j) => (<li key={j}>{p}</li>))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {analysis.relatedDecisions.length > 0 && (
                <div>
                  <h3 className="text-xs uppercase text-muted mb-1">Related decisions</h3>
                  <ul className="text-xs text-white/85">
                    {analysis.relatedDecisions.map((d) => (
                      <li key={d.id}><span className="font-mono text-accent">{d.id}</span> — {d.title}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      <Card title="Simulator" subtitle="Compare two options across cost, latency, dev effort, blast radius">
        <div className="grid md:grid-cols-2 gap-3">
          <textarea
            value={optionA}
            onChange={(e) => setOptionA(e.target.value)}
            placeholder="Option A description…"
            rows={4}
            className="bg-bg border border-border rounded p-2 text-sm"
          />
          <textarea
            value={optionB}
            onChange={(e) => setOptionB(e.target.value)}
            placeholder="Option B description…"
            rows={4}
            className="bg-bg border border-border rounded p-2 text-sm"
          />
        </div>
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder="Context (system, scale, team…)"
          rows={2}
          className="bg-bg border border-border rounded p-2 text-sm w-full mt-2"
        />
        <button onClick={runSim} disabled={loading || !optionA || !optionB} className="mt-2 bg-accent hover:bg-accent/80 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50">
          {loading ? "Running…" : "Simulate"}
        </button>
        {sim && (
          <div className="mt-4 space-y-2 text-sm">
            <table className="w-full border border-border text-xs">
              <thead className="bg-border/50">
                <tr><th className="p-2 text-left">Dimension</th><th className="p-2 text-left">A</th><th className="p-2 text-left">B</th></tr>
              </thead>
              <tbody>
                {sim.table.map((r, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="p-2 text-muted">{r.dimension}</td>
                    <td className="p-2">{r.a}</td>
                    <td className="p-2">{r.b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="bg-accent/10 border border-accent/30 rounded p-3">
              <Pill tone="accent">Recommendation</Pill>
              <p className="mt-2 text-sm">{sim.recommendation}</p>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
