"use client";

import { useEffect, useState } from "react";
import { Card, Pill, SectionHeader } from "@/components/Card";
import { Button } from "@/components/Button";
import { Users, AlertCircle, CalendarDays, Target as TargetIcon, Loader2, Sparkles } from "lucide-react";

type Engineer = { id: string; name: string; team: string; flags: number };

type Profile = {
  id: string;
  name: string;
  team: string;
  level: string;
  oneOnOnes: { date: string; topics: string; commitments: string; sentiment: string; notes: string }[];
  recentTickets: { key: string; title: string; status: string; lastMovedDays: number }[];
  slackTone: { engineerId: string; signal: string; detail: string }[];
  flags: { kind: string; detail: string }[];
};

type Agenda = { agenda: string[]; questions: string[]; growthOpportunities: string[]; concerns: string[] };

export default function PeoplePage() {
  const [list, setList] = useState<Engineer[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [agenda, setAgenda] = useState<Agenda | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/people").then((r) => r.json()).then((j) => setList(j.engineers ?? []));
  }, []);

  async function open(id: string) {
    setActive(id);
    setProfile(null);
    setAgenda(null);
    const j = (await (await fetch(`/api/people/${id}`)).json()) as { profile: Profile };
    setProfile(j.profile);
  }

  async function buildAgenda() {
    if (!active) return;
    setLoading(true);
    try {
      const j = (await (await fetch(`/api/people/${active}/agenda`, { method: "POST" })).json()) as { agenda: Agenda };
      setAgenda(j.agenda);
    } finally {
      setLoading(false);
    }
  }

  const grouped = list.reduce<Record<string, Engineer[]>>((acc, e) => {
    (acc[e.team] ||= []).push(e);
    return acc;
  }, {});

  return (
    <div className="space-y-8 animate-fade-in">
      <header className="space-y-2">
        <SectionHeader kicker="People intelligence">growth · sentiment · 1:1 prep</SectionHeader>
        <h1 className="text-[28px] font-semibold tracking-tight">Know your people.</h1>
      </header>

      <div className="grid md:grid-cols-3 gap-4">
        {Object.entries(grouped).map(([team, eng]) => (
          <Card key={team} title={team} subtitle={`${eng.length} engineers`} icon={<Users className="w-4 h-4" strokeWidth={1.75} />}>
            <ul className="space-y-1">
              {eng.map((e) => (
                <li key={e.id}>
                  <button
                    onClick={() => open(e.id)}
                    className={`w-full text-left flex items-center justify-between gap-2 px-2.5 py-2 rounded-md transition-all ${
                      active === e.id ? "bg-accent/[0.10]" : "hover:bg-surface"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold tracking-wide ${
                        e.flags > 0 ? "bg-warn/15 text-warn" : "bg-white/[0.06] text-ink-dim"
                      }`}>
                        {e.name.split(" ").map((s) => s[0]).join("").slice(0, 2)}
                      </div>
                      <span className="text-[13px] text-ink truncate">{e.name}</span>
                    </div>
                    {e.flags > 0 && <Pill tone="warn" size="xs">{e.flags}</Pill>}
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      {active && profile && (
        <Card
          title={profile.name}
          subtitle={`${profile.team} · ${profile.level} · ${profile.id}`}
          icon={<Users className="w-4 h-4 text-accent" strokeWidth={1.75} />}
          action={
            <Button onClick={buildAgenda} disabled={loading} variant="primary">
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {loading ? "Working" : "Generate 1:1 agenda"}
            </Button>
          }
        >
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <div className="text-[10.5px] uppercase tracking-[0.18em] text-ink-faint font-medium mb-2 flex items-center gap-1.5">
                <CalendarDays className="w-3 h-3" /> Recent 1:1s
              </div>
              {profile.oneOnOnes.length === 0 ? (
                <p className="text-[12px] text-ink-faint">None.</p>
              ) : (
                <ul className="space-y-2">
                  {profile.oneOnOnes.slice(0, 3).map((o, i) => (
                    <li key={i} className="rounded-lg border border-border bg-bg/40 p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11px] text-ink-faint font-mono">{o.date}</span>
                        <Pill tone={o.sentiment.includes("frustrat") || o.sentiment.includes("stuck") || o.sentiment.includes("burnout") ? "warn" : o.sentiment.includes("engaged") ? "ok" : "muted"} size="xs">
                          {o.sentiment}
                        </Pill>
                      </div>
                      <p className="text-[12.5px] text-ink/90"><span className="text-ink-faint">Topics:</span> {o.topics}</p>
                      <p className="text-[12.5px] text-ink/90 mt-1"><span className="text-ink-faint">Commitments:</span> {o.commitments}</p>
                      <p className="text-[12px] text-ink-dim italic mt-1.5">{o.notes}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <div className="text-[10.5px] uppercase tracking-[0.18em] text-ink-faint font-medium mb-2 flex items-center gap-1.5">
                  <TargetIcon className="w-3 h-3" /> Open work
                </div>
                {profile.recentTickets.length === 0 ? (
                  <p className="text-[12px] text-ink-faint">No tickets assigned.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {profile.recentTickets.map((t) => (
                      <li key={t.key} className="flex items-start justify-between gap-2 text-[12.5px]">
                        <div className="min-w-0">
                          <span className="font-mono text-[11.5px] text-accent">{t.key}</span>
                          <span className="ml-1.5 text-ink/90">{t.title}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Pill tone={t.lastMovedDays > 4 ? "warn" : "muted"} size="xs">{t.status}</Pill>
                          <span className="text-[10.5px] text-ink-ghost">{t.lastMovedDays}d</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {profile.flags.length > 0 && (
                <div>
                  <div className="text-[10.5px] uppercase tracking-[0.18em] text-ink-faint font-medium mb-2 flex items-center gap-1.5">
                    <AlertCircle className="w-3 h-3 text-warn" /> Flags
                  </div>
                  <ul className="space-y-1.5">
                    {profile.flags.map((f, i) => (
                      <li key={i} className="text-[12px] flex items-start gap-2">
                        <Pill tone="warn" size="xs">{f.kind}</Pill>
                        <span className="text-ink/90">{f.detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          {agenda && (
            <div className="mt-6 pt-5 border-t border-border grid md:grid-cols-2 gap-3 animate-slide-up">
              <ListSection title="Agenda" items={agenda.agenda} tone="accent" />
              <ListSection title="Tailored questions" items={agenda.questions} tone="muted" />
              <ListSection title="Growth opportunities" items={agenda.growthOpportunities} tone="ok" />
              <ListSection title="Concerns to surface" items={agenda.concerns} tone="warn" />
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function ListSection({ title, items, tone }: { title: string; items: string[]; tone: "muted" | "warn" | "ok" | "accent" }) {
  const colors: Record<string, string> = { muted: "text-ink-faint", warn: "text-warn", ok: "text-ok", accent: "text-accent" };
  return (
    <div className="rounded-lg border border-border bg-bg/40 p-3.5">
      <div className={`text-[10.5px] uppercase tracking-[0.18em] mb-2 font-medium ${colors[tone]}`}>{title}</div>
      <ul className="space-y-1.5">
        {items.length === 0 ? <li className="text-[12px] text-ink-ghost">(none)</li> : items.map((s, i) => (
          <li key={i} className="text-[12.5px] text-ink/90 flex gap-2 leading-snug">
            <span className={colors[tone]}>·</span><span>{s}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
