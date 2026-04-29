import { Card, Pill } from "@/components/Card";
import { getLatestBrief } from "@/lib/modules/daily-brief";
import { listOKRs } from "@/lib/modules/execution-tower";
import { listIncidents } from "@/lib/modules/interrupt-memory";
import { RegenerateButton } from "@/components/RegenerateButton";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const [brief, okrs, incidents] = await Promise.all([getLatestBrief(), listOKRs(), listIncidents()]);
  const openIncidents = incidents.filter((i) => i.status === "open");

  const overallProgress = okrs.length > 0 ? okrs.reduce((s, o) => s + o.progress, 0) / okrs.length : 0;
  const atRisk = okrs.filter((o) => o.status === "at_risk" || o.status === "behind");

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">CEO Dashboard</h1>
          <p className="text-sm text-muted mt-1">Cross-team engineering signal as of {new Date().toLocaleDateString()}.</p>
        </div>
        <RegenerateButton endpoint="/api/brief" label="Regenerate brief" body={{ date: new Date().toISOString().slice(0, 10) }} />
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Stat label="OKR delivery" value={`${Math.round(overallProgress * 100)}%`} tone={overallProgress > 0.6 ? "ok" : overallProgress > 0.4 ? "warn" : "bad"} />
        <Stat label="At-risk OKRs" value={atRisk.length.toString()} tone={atRisk.length === 0 ? "ok" : atRisk.length < 2 ? "warn" : "bad"} />
        <Stat label="Open incidents" value={openIncidents.length.toString()} tone={openIncidents.length === 0 ? "ok" : openIncidents.length < 3 ? "warn" : "bad"} />
        <Stat label="Teams" value={`${new Set(okrs.map((o) => o.teamId)).size}`} tone="muted" />
      </div>

      {!brief ? (
        <Card title="Daily Intelligence Brief" subtitle="No brief yet — click Regenerate to create one">
          <p className="text-muted text-sm">A brief aggregates standups, Jira, Slack, monitoring, and on-call signals into one narrative.</p>
        </Card>
      ) : (
        <Card title="Daily Intelligence Brief" subtitle={`Generated ${new Date(brief.asOfISO).toLocaleString()}`}>
          <p className="text-sm leading-relaxed text-white/90">{brief.narrative}</p>

          <div className="grid md:grid-cols-3 gap-4 mt-4">
            <SubSection title="Sprint risk">
              {brief.sprintRisk.length === 0 ? (
                <p className="text-xs text-muted">No risks flagged.</p>
              ) : (
                brief.sprintRisk.map((r, i) => (
                  <div key={i} className="text-xs mb-2">
                    <Pill tone={r.level === "high" ? "bad" : r.level === "medium" ? "warn" : "ok"}>{r.team}</Pill>
                    <span className="ml-2 text-muted">{r.reason}</span>
                  </div>
                ))
              )}
            </SubSection>
            <SubSection title="Top blockers">
              {brief.blockers.length === 0 ? (
                <p className="text-xs text-muted">None reported.</p>
              ) : (
                brief.blockers.slice(0, 5).map((b, i) => (
                  <div key={i} className="text-xs mb-2">
                    <span className="font-mono text-accent">{b.engineerId}</span>
                    <span className="text-muted ml-1">· {b.team}</span>
                    <div className="text-white/80 mt-0.5">{b.reason}</div>
                  </div>
                ))
              )}
            </SubSection>
            <SubSection title="Productivity anomalies">
              {brief.productivityAnomalies.length === 0 ? (
                <p className="text-xs text-muted">All steady.</p>
              ) : (
                brief.productivityAnomalies.slice(0, 5).map((a, i) => (
                  <div key={i} className="text-xs mb-2">
                    <Pill tone="warn">{a.kind}</Pill>
                    <span className="ml-2 text-muted">{a.detail}</span>
                  </div>
                ))
              )}
            </SubSection>
          </div>

          <SubSection title="Incident digest" className="mt-4">
            <p className="text-sm text-white/85">{brief.incidentDigest || "Nothing notable."}</p>
          </SubSection>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="OKR snapshot" subtitle="Q2-2026">
          <ul className="space-y-2 text-sm">
            {okrs.map((o) => (
              <li key={o.id} className="flex items-center justify-between">
                <div>
                  <Pill tone={o.status === "on_track" ? "ok" : o.status === "at_risk" ? "warn" : "bad"}>{o.teamName}</Pill>
                  <span className="ml-2 text-white/85">{o.objective}</span>
                </div>
                <span className="text-xs text-muted">{Math.round(o.progress * 100)}%</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Open incidents" subtitle="Live operational state">
          {openIncidents.length === 0 ? (
            <p className="text-xs text-muted">No open incidents.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {openIncidents.map((i) => (
                <li key={i.id} className="flex items-center justify-between">
                  <div>
                    <Pill tone={i.severity === "p1" ? "bad" : i.severity === "p2" ? "warn" : "muted"}>{i.severity.toUpperCase()}</Pill>
                    <span className="ml-2">{i.title}</span>
                  </div>
                  <span className="text-xs text-muted">{i.ownerId ?? "unassigned"}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "ok" | "warn" | "bad" | "muted" }) {
  const color: Record<string, string> = { ok: "text-ok", warn: "text-warn", bad: "text-bad", muted: "text-white" };
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${color[tone]}`}>{value}</div>
    </div>
  );
}

function SubSection({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <h3 className="text-xs uppercase tracking-wider text-muted mb-2">{title}</h3>
      {children}
    </div>
  );
}
