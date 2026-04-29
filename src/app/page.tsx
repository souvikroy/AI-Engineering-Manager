import { Card, Pill, Stat, SectionHeader } from "@/components/Card";
import { getLatestBrief } from "@/lib/modules/daily-brief";
import { listOKRs } from "@/lib/modules/execution-tower";
import { listIncidents } from "@/lib/modules/interrupt-memory";
import { RegenerateButton } from "@/components/RegenerateButton";
import { Activity, AlertTriangle, Target, Users, Clock, Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const [brief, okrs, incidents] = await Promise.all([getLatestBrief(), listOKRs(), listIncidents()]);
  const openIncidents = incidents.filter((i) => i.status === "open");
  const overallProgress = okrs.length > 0 ? okrs.reduce((s, o) => s + o.progress, 0) / okrs.length : 0;
  const atRisk = okrs.filter((o) => o.status === "at_risk" || o.status === "behind");
  const teamCount = new Set(okrs.map((o) => o.teamId)).size;

  return (
    <div className="space-y-8 animate-fade-in">
      <header className="flex items-end justify-between gap-6">
        <div className="space-y-2">
          <SectionHeader kicker="Overview">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</SectionHeader>
          <h1 className="text-[32px] font-semibold tracking-tight text-balance leading-tight">
            Engineering pulse,
            <span className="text-ink-faint"> at a glance.</span>
          </h1>
        </div>
        <RegenerateButton endpoint="/api/brief" label="Regenerate brief" body={{ date: new Date().toISOString().slice(0, 10) }} />
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat
          label="OKR delivery"
          value={`${Math.round(overallProgress * 100)}%`}
          hint={`${okrs.length} objectives`}
          tone={overallProgress > 0.6 ? "ok" : overallProgress > 0.4 ? "warn" : "bad"}
          icon={<Target className="w-4 h-4" strokeWidth={1.75} />}
        />
        <Stat
          label="At-risk OKRs"
          value={atRisk.length.toString()}
          hint={atRisk.length === 0 ? "all on track" : "needs attention"}
          tone={atRisk.length === 0 ? "ok" : atRisk.length < 2 ? "warn" : "bad"}
          icon={<AlertTriangle className="w-4 h-4" strokeWidth={1.75} />}
        />
        <Stat
          label="Open incidents"
          value={openIncidents.length.toString()}
          hint={openIncidents.length === 0 ? "no live alerts" : "active"}
          tone={openIncidents.length === 0 ? "ok" : openIncidents.length < 3 ? "warn" : "bad"}
          icon={<Activity className="w-4 h-4" strokeWidth={1.75} />}
        />
        <Stat
          label="Active teams"
          value={teamCount.toString()}
          hint="Q2-2026"
          icon={<Users className="w-4 h-4" strokeWidth={1.75} />}
        />
      </div>

      {!brief ? (
        <Card title="Daily Intelligence Brief" subtitle="No brief yet — click Regenerate to build one" icon={<Sparkles className="w-4 h-4" strokeWidth={1.75} />}>
          <div className="rounded-lg border border-dashed border-border p-10 text-center">
            <Sparkles className="w-6 h-6 text-ink-ghost mx-auto mb-3" strokeWidth={1.5} />
            <p className="text-[13px] text-ink-dim">A brief aggregates standups, Jira, Slack, monitoring, and on-call signals into one narrative.</p>
            <p className="text-[12px] text-ink-faint mt-1">Click <span className="text-accent">Regenerate brief</span> above to start.</p>
          </div>
        </Card>
      ) : (
        <Card
          title="Daily Intelligence Brief"
          subtitle={`Generated ${new Date(brief.asOfISO).toLocaleString()}`}
          icon={<Sparkles className="w-4 h-4 text-accent" strokeWidth={1.75} />}
        >
          <div className="rounded-lg bg-gradient-to-br from-accent/[0.04] to-transparent border border-accent/[0.10] p-4 mb-5">
            <p className="text-[14px] leading-relaxed text-ink/95 text-balance">{brief.narrative}</p>
          </div>

          <div className="grid md:grid-cols-3 gap-3">
            <SubBlock kicker="Sprint risk" empty="No risks flagged.">
              {brief.sprintRisk.map((r, i) => (
                <Row key={i}>
                  <Pill tone={r.level === "high" ? "bad" : r.level === "medium" ? "warn" : "ok"}>{r.team}</Pill>
                  <span className="text-ink-dim leading-snug">{r.reason}</span>
                </Row>
              ))}
            </SubBlock>
            <SubBlock kicker="Top blockers" empty="None reported.">
              {brief.blockers.slice(0, 5).map((b, i) => (
                <div key={i} className="text-[12px] py-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[11px] text-accent">{b.engineerId}</span>
                    <span className="text-ink-faint">·</span>
                    <span className="text-ink-faint text-[11px]">{b.team}</span>
                  </div>
                  <p className="text-ink mt-0.5 leading-snug">{b.reason}</p>
                </div>
              ))}
            </SubBlock>
            <SubBlock kicker="Anomalies" empty="All steady.">
              {brief.productivityAnomalies.slice(0, 5).map((a, i) => (
                <Row key={i}>
                  <Pill tone="warn" size="xs">{a.kind.replace(/_/g, " ")}</Pill>
                  <span className="text-ink-dim leading-snug">{a.detail}</span>
                </Row>
              ))}
            </SubBlock>
          </div>

          {brief.incidentDigest && (
            <div className="mt-5 pt-5 border-t border-border">
              <SectionHeader kicker="Incident digest">live operational view</SectionHeader>
              <p className="text-[13px] text-ink/90 leading-relaxed mt-2">{brief.incidentDigest}</p>
            </div>
          )}
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="OKR snapshot" subtitle="Q2 — 2026" icon={<Target className="w-4 h-4" strokeWidth={1.75} />}>
          <ul className="space-y-3">
            {okrs.map((o) => (
              <li key={o.id} className="group">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Pill tone={o.status === "on_track" ? "ok" : o.status === "at_risk" ? "warn" : "bad"} size="xs">
                      {o.teamName}
                    </Pill>
                    <p className="text-[13px] text-ink mt-1.5 leading-snug">{o.objective}</p>
                  </div>
                  <span className="text-[12px] tabular-nums text-ink-dim shrink-0 mt-1">{Math.round(o.progress * 100)}%</span>
                </div>
                <div className="mt-2 h-[3px] rounded-full bg-white/[0.05] overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      o.status === "on_track" ? "bg-ok" : o.status === "at_risk" ? "bg-warn" : "bg-bad"
                    }`}
                    style={{ width: `${o.progress * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Live operations" subtitle="On-call and incidents" icon={<Activity className="w-4 h-4" strokeWidth={1.75} />}>
          {openIncidents.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center">
              <Clock className="w-5 h-5 text-ok mx-auto mb-2" strokeWidth={1.5} />
              <p className="text-[12.5px] text-ink-dim">All systems steady.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {openIncidents.map((i) => (
                <li key={i.id} className="flex items-start justify-between gap-3 py-1.5 border-b border-border last:border-0">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 animate-pulse-soft ${
                      i.severity === "p1" ? "bg-bad" : i.severity === "p2" ? "bg-warn" : "bg-ink-ghost"
                    }`} />
                    <div className="min-w-0">
                      <p className="text-[13px] text-ink leading-snug">{i.title}</p>
                      <p className="text-[11px] text-ink-faint mt-0.5">
                        <span className="uppercase tracking-wider">{i.severity}</span> · {i.ownerId ?? "unassigned"}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function SubBlock({ kicker, children, empty }: { kicker: string; children: React.ReactNode; empty?: string }) {
  const arr = Array.isArray(children) ? children : [children];
  const hasContent = arr.some((c) => c);
  return (
    <div className="rounded-lg border border-border bg-bg/40 p-3">
      <div className="text-[10.5px] uppercase tracking-[0.18em] text-ink-faint font-medium mb-2">{kicker}</div>
      {hasContent ? <div className="space-y-1.5">{children}</div> : <p className="text-[12px] text-ink-ghost">{empty}</p>}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-start gap-2 text-[12px]">{children}</div>;
}
