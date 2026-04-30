import { Card, Pill, Stat, SectionHeader } from "@/components/Card";
import { getLatestBrief } from "@/lib/modules/daily-brief";
import { listOKRs } from "@/lib/modules/execution-tower";
import { listIncidents } from "@/lib/modules/interrupt-memory";
import { RegenerateButton } from "@/components/RegenerateButton";
import {
  Activity,
  AlertTriangle,
  Target,
  Users,
  Clock,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const [brief, okrs, incidents] = await Promise.all([
    getLatestBrief(),
    listOKRs(),
    listIncidents(),
  ]);
  const openIncidents = incidents.filter((i) => i.status === "open");
  const overallProgress =
    okrs.length > 0 ? okrs.reduce((s, o) => s + o.progress, 0) / okrs.length : 0;
  const atRisk = okrs.filter(
    (o) => o.status === "at_risk" || o.status === "behind",
  );
  const teamCount = new Set(okrs.map((o) => o.teamId)).size;
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="space-y-10 animate-fade-in">
      {/* Hero */}
      <header className="relative">
        <div className="flex items-end justify-between gap-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[11px] text-ink-faint">
              <span className="live-dot text-ok">
                <span className="block w-2 h-2 rounded-full bg-ok" />
              </span>
              <span className="uppercase tracking-kicker font-medium">Live</span>
              <span className="text-ink-ghost">·</span>
              <span>{today}</span>
            </div>
            <h1 className="text-[44px] font-semibold tracking-display leading-[1.04] text-balance">
              <span className="text-gradient-ink">Engineering pulse,</span>
              <br />
              <span className="text-gradient-accent">at a glance.</span>
            </h1>
            <p className="text-[14px] text-ink-dim max-w-xl text-pretty">
              One synthesis from standups, Jira, Slack, monitoring, and on-call —
              so you walk into every leadership sync already aligned.
            </p>
          </div>
          <RegenerateButton
            endpoint="/api/brief"
            label="Regenerate brief"
            body={{ date: new Date().toISOString().slice(0, 10) }}
          />
        </div>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat
          label="OKR delivery"
          value={`${Math.round(overallProgress * 100)}%`}
          hint={`${okrs.length} objectives · Q2`}
          tone={
            overallProgress > 0.6
              ? "ok"
              : overallProgress > 0.4
              ? "warn"
              : "bad"
          }
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
          tone={
            openIncidents.length === 0
              ? "ok"
              : openIncidents.length < 3
              ? "warn"
              : "bad"
          }
          icon={<Activity className="w-4 h-4" strokeWidth={1.75} />}
        />
        <Stat
          label="Active teams"
          value={teamCount.toString()}
          hint="3 EMs, 14 ICs"
          icon={<Users className="w-4 h-4" strokeWidth={1.75} />}
        />
      </div>

      {/* Daily brief */}
      {!brief ? (
        <Card
          variant="feature"
          title="Daily Intelligence Brief"
          subtitle="No brief yet — generate one to see today's narrative"
          icon={<Sparkles className="w-3.5 h-3.5 text-accent" strokeWidth={1.75} />}
        >
          <div className="rounded-xl border border-dashed border-border p-12 text-center shine">
            <Sparkles
              className="w-7 h-7 text-accent/60 mx-auto mb-4"
              strokeWidth={1.5}
            />
            <p className="text-[14px] text-ink-dim text-balance max-w-md mx-auto leading-relaxed">
              Aggregates standups, Jira, Slack, monitoring and on-call signals into
              a single narrative.
            </p>
            <p className="text-[12px] text-ink-faint mt-2">
              Click <span className="text-accent">Regenerate brief</span> above to
              start.
            </p>
          </div>
        </Card>
      ) : (
        <Card
          variant="feature"
          title="Daily Intelligence Brief"
          subtitle={`Generated ${new Date(brief.asOfISO).toLocaleString()}`}
          icon={<Sparkles className="w-3.5 h-3.5 text-accent" strokeWidth={1.75} />}
        >
          <div className="relative rounded-xl bg-gradient-to-br from-accent/[0.06] via-accent/[0.02] to-transparent border border-accent/[0.14] p-5 mb-5">
            <div className="absolute top-3 left-3 text-accent/30 font-serif text-[42px] leading-none select-none">
              &ldquo;
            </div>
            <p className="text-[15.5px] leading-relaxed text-ink/95 text-balance pl-6">
              {brief.narrative}
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-3">
            <SubBlock kicker="Sprint risk" empty="No risks flagged.">
              {brief.sprintRisk.map((r, i) => (
                <Row key={i}>
                  <Pill
                    tone={
                      r.level === "high"
                        ? "bad"
                        : r.level === "medium"
                        ? "warn"
                        : "ok"
                    }
                    size="xs"
                  >
                    {r.team}
                  </Pill>
                  <span className="text-ink-dim leading-snug">{r.reason}</span>
                </Row>
              ))}
            </SubBlock>
            <SubBlock kicker="Top blockers" empty="None reported.">
              {brief.blockers.slice(0, 5).map((b, i) => (
                <div key={i} className="text-[12px] py-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[11px] text-accent">
                      {b.engineerId}
                    </span>
                    <span className="text-ink-ghost">·</span>
                    <span className="text-ink-faint text-[11px]">{b.team}</span>
                  </div>
                  <p className="text-ink mt-0.5 leading-snug">{b.reason}</p>
                </div>
              ))}
            </SubBlock>
            <SubBlock kicker="Anomalies" empty="All steady.">
              {brief.productivityAnomalies.slice(0, 5).map((a, i) => (
                <Row key={i}>
                  <Pill tone="warn" size="xs">
                    {a.kind.replace(/_/g, " ")}
                  </Pill>
                  <span className="text-ink-dim leading-snug">{a.detail}</span>
                </Row>
              ))}
            </SubBlock>
          </div>

          {brief.incidentDigest && (
            <div className="mt-5 pt-5 border-t border-border">
              <SectionHeader kicker="Incident digest">
                live operational view
              </SectionHeader>
              <p className="text-[13px] text-ink/90 leading-relaxed mt-2">
                {brief.incidentDigest}
              </p>
            </div>
          )}
        </Card>
      )}

      {/* Two-up */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card
          title="OKR snapshot"
          subtitle="Q2 — 2026"
          icon={<Target className="w-3.5 h-3.5" strokeWidth={1.75} />}
          action={
            <Link
              href="/execution"
              className="inline-flex items-center gap-1 text-[11.5px] text-ink-faint hover:text-accent transition-colors"
            >
              All OKRs <ArrowRight className="w-3 h-3" />
            </Link>
          }
        >
          <ul className="space-y-3.5">
            {okrs.map((o) => (
              <li key={o.id} className="group">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Pill
                      tone={
                        o.status === "on_track"
                          ? "ok"
                          : o.status === "at_risk"
                          ? "warn"
                          : "bad"
                      }
                      size="xs"
                    >
                      {o.teamName}
                    </Pill>
                    <p className="text-[13px] text-ink mt-1.5 leading-snug">
                      {o.objective}
                    </p>
                  </div>
                  <span className="text-[12.5px] tabular-nums text-ink-dim shrink-0 mt-1 font-medium">
                    {Math.round(o.progress * 100)}%
                  </span>
                </div>
                <div className="mt-2 h-[3px] rounded-full bg-white/[0.04] overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      o.status === "on_track"
                        ? "bg-ok"
                        : o.status === "at_risk"
                        ? "bg-warn"
                        : "bg-bad"
                    }`}
                    style={{ width: `${o.progress * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card
          title="Live operations"
          subtitle="On-call and incidents"
          icon={<Activity className="w-3.5 h-3.5" strokeWidth={1.75} />}
          action={
            <Link
              href="/incidents"
              className="inline-flex items-center gap-1 text-[11.5px] text-ink-faint hover:text-accent transition-colors"
            >
              All incidents <ArrowRight className="w-3 h-3" />
            </Link>
          }
        >
          {openIncidents.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center">
              <Clock className="w-5 h-5 text-ok mx-auto mb-2" strokeWidth={1.5} />
              <p className="text-[12.5px] text-ink-dim">All systems steady.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {openIncidents.map((i) => (
                <li
                  key={i.id}
                  className="flex items-start justify-between gap-3 py-2 border-b border-border last:border-0"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <span
                      className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 animate-pulse-soft ${
                        i.severity === "p1"
                          ? "bg-bad"
                          : i.severity === "p2"
                          ? "bg-warn"
                          : "bg-ink-ghost"
                      }`}
                    />
                    <div className="min-w-0">
                      <p className="text-[13px] text-ink leading-snug">
                        {i.title}
                      </p>
                      <p className="text-[11px] text-ink-faint mt-0.5">
                        <span className="uppercase tracking-wider">
                          {i.severity}
                        </span>{" "}
                        · {i.ownerId ?? "unassigned"}
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

function SubBlock({
  kicker,
  children,
  empty,
}: {
  kicker: string;
  children: React.ReactNode;
  empty?: string;
}) {
  const arr = Array.isArray(children) ? children : [children];
  const hasContent = arr.some((c) => c);
  return (
    <div className="rounded-xl border border-border bg-bg-elevated/40 p-3.5">
      <div className="text-[10px] uppercase tracking-kicker text-ink-faint font-semibold mb-2.5">
        {kicker}
      </div>
      {hasContent ? (
        <div className="space-y-1.5">{children}</div>
      ) : (
        <p className="text-[12px] text-ink-ghost">{empty}</p>
      )}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-start gap-2 text-[12px]">{children}</div>;
}
