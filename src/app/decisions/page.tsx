"use client";

import { useEffect, useState } from "react";
import { Card, Pill, SectionHeader } from "@/components/Card";
import { Button } from "@/components/Button";
import { BookOpenCheck, FileText, GitCompareArrows, Loader2, Sparkles } from "lucide-react";

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
  const [simLoading, setSimLoading] = useState(false);

  useEffect(() => {
    fetch("/api/decisions/list").then((r) => r.json()).then((j) => setDocs(j.docs ?? []));
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
    setSimLoading(true);
    try {
      const res = await fetch("/api/decisions/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionA, optionB, context }),
      });
      const j = (await res.json()) as { table: { dimension: string; a: string; b: string }[]; recommendation: string };
      setSim(j);
    } finally {
      setSimLoading(false);
    }
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <header className="space-y-2">
        <SectionHeader kicker="Decision engine">design analysis · trade-off simulation · context memory</SectionHeader>
        <h1 className="text-[28px] font-semibold tracking-tight">Decisions worth keeping.</h1>
      </header>

      <Card title="Design docs" subtitle="Click to analyze with full memory of prior decisions" icon={<BookOpenCheck className="w-4 h-4" strokeWidth={1.75} />}>
        {docs.length === 0 ? (
          <p className="text-[12.5px] text-ink-faint">No design docs in /data/design_docs.</p>
        ) : (
          <ul className="grid md:grid-cols-2 gap-2">
            {docs.map((d) => (
              <li key={d.slug}>
                <button
                  onClick={() => analyze(d.slug)}
                  className={`w-full text-left p-3.5 rounded-lg border transition-all ${
                    active === d.slug
                      ? "border-accent/40 bg-accent/[0.06]"
                      : "border-border bg-surface hover:bg-surface-hover hover:border-border-strong"
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <FileText className="w-4 h-4 text-ink-faint mt-0.5" strokeWidth={1.75} />
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-ink leading-snug">{d.title}</p>
                      <p className="text-[11px] text-ink-faint font-mono mt-0.5">{d.slug}</p>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {active && (
        <Card title={`Analysis · ${active}`} subtitle={loading ? "Working through risks and trade-offs…" : analysis?.summary} icon={<Sparkles className="w-4 h-4 text-accent" strokeWidth={1.75} />}>
          {!analysis ? (
            <div className="flex items-center gap-2 text-[12.5px] text-ink-dim py-4">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Analyzing…
            </div>
          ) : (
            <div className="space-y-5 text-[13px]">
              {analysis.scalabilityRisks.length > 0 && (
                <Block kicker="Scalability risks">
                  <ul className="space-y-1.5 text-ink/90">
                    {analysis.scalabilityRisks.map((r, i) => (<li key={i} className="flex gap-2"><span className="text-warn shrink-0">▸</span><span>{r}</span></li>))}
                  </ul>
                </Block>
              )}
              {analysis.flagged.length > 0 && (
                <Block kicker="Flagged for review">
                  <ul className="space-y-1.5 text-ink/90">
                    {analysis.flagged.map((r, i) => (<li key={i} className="flex gap-2"><span className="text-bad shrink-0">▸</span><span>{r}</span></li>))}
                  </ul>
                </Block>
              )}
              {analysis.tradeoffs.length > 0 && (
                <Block kicker="Trade-offs">
                  <div className="grid md:grid-cols-2 gap-3">
                    {analysis.tradeoffs.map((t, i) => (
                      <div key={i} className="rounded-lg border border-border bg-bg/40 p-3.5">
                        <p className="text-[13px] font-semibold text-ink mb-2">{t.option}</p>
                        <div className="text-[11px] uppercase tracking-wider text-ok mb-1 font-medium">Pros</div>
                        <ul className="space-y-1 mb-3">
                          {t.pros.map((p, j) => (<li key={j} className="text-[12px] text-ink/85 flex gap-1.5"><span className="text-ok">+</span>{p}</li>))}
                        </ul>
                        <div className="text-[11px] uppercase tracking-wider text-bad mb-1 font-medium">Cons</div>
                        <ul className="space-y-1">
                          {t.cons.map((p, j) => (<li key={j} className="text-[12px] text-ink/85 flex gap-1.5"><span className="text-bad">−</span>{p}</li>))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </Block>
              )}
              {analysis.relatedDecisions.length > 0 && (
                <Block kicker="Related decisions">
                  <ul className="space-y-1 text-[12px]">
                    {analysis.relatedDecisions.map((d) => (
                      <li key={d.id} className="flex gap-2">
                        <span className="font-mono text-accent">{d.id}</span>
                        <span className="text-ink-dim">{d.title}</span>
                      </li>
                    ))}
                  </ul>
                </Block>
              )}
            </div>
          )}
        </Card>
      )}

      <Card title="Decision simulator" subtitle="Compare options across cost, latency, dev effort, blast radius" icon={<GitCompareArrows className="w-4 h-4" strokeWidth={1.75} />}>
        <div className="grid md:grid-cols-2 gap-3">
          <textarea
            value={optionA}
            onChange={(e) => setOptionA(e.target.value)}
            placeholder="Option A — describe the approach"
            rows={4}
            className="bg-bg-elevated border border-border rounded-lg p-3 text-[13px] resize-none focus:outline-none focus:border-accent/40 transition placeholder:text-ink-ghost"
          />
          <textarea
            value={optionB}
            onChange={(e) => setOptionB(e.target.value)}
            placeholder="Option B — describe the approach"
            rows={4}
            className="bg-bg-elevated border border-border rounded-lg p-3 text-[13px] resize-none focus:outline-none focus:border-accent/40 transition placeholder:text-ink-ghost"
          />
        </div>
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder="Context — system, scale, team, constraints"
          rows={2}
          className="mt-3 w-full bg-bg-elevated border border-border rounded-lg p-3 text-[13px] resize-none focus:outline-none focus:border-accent/40 transition placeholder:text-ink-ghost"
        />
        <div className="mt-3">
          <Button onClick={runSim} disabled={simLoading || !optionA || !optionB} variant="primary">
            {simLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {simLoading ? "Running" : "Simulate"}
          </Button>
        </div>
        {sim && (
          <div className="mt-5 space-y-3 animate-slide-up">
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-bg/40">
                    <th className="text-left text-[11px] uppercase tracking-wider text-ink-faint font-medium px-3 py-2">Dimension</th>
                    <th className="text-left text-[11px] uppercase tracking-wider text-ink-faint font-medium px-3 py-2">Option A</th>
                    <th className="text-left text-[11px] uppercase tracking-wider text-ink-faint font-medium px-3 py-2">Option B</th>
                  </tr>
                </thead>
                <tbody>
                  {sim.table.map((r, i) => (
                    <tr key={i} className="border-b border-border last:border-0 text-[12.5px]">
                      <td className="px-3 py-2 text-ink-dim font-medium">{r.dimension}</td>
                      <td className="px-3 py-2 text-ink/90">{r.a}</td>
                      <td className="px-3 py-2 text-ink/90">{r.b}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rounded-lg bg-gradient-to-br from-accent/[0.10] to-accent/[0.02] border border-accent/[0.20] p-4">
              <Pill tone="accent">Recommendation</Pill>
              <p className="mt-2 text-[13px] text-ink leading-relaxed">{sim.recommendation}</p>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function Block({ kicker, children }: { kicker: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-[0.18em] text-ink-faint font-medium mb-2">{kicker}</div>
      {children}
    </div>
  );
}
