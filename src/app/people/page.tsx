"use client";

import { useEffect, useState } from "react";
import { Card, Pill } from "@/components/Card";

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
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">People Intelligence</h1>
        <p className="text-sm text-muted mt-1">Click an engineer to see profile and prep a 1:1.</p>
      </header>

      <div className="grid md:grid-cols-3 gap-4">
        {Object.entries(grouped).map(([team, eng]) => (
          <Card key={team} title={team}>
            <ul className="space-y-1.5">
              {eng.map((e) => (
                <li key={e.id}>
                  <button onClick={() => open(e.id)} className={`w-full text-left text-sm flex items-center justify-between p-2 rounded ${active === e.id ? "bg-accent/15" : "hover:bg-border"}`}>
                    <span>{e.name}</span>
                    {e.flags > 0 && <Pill tone="warn">{e.flags} flag</Pill>}
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      {active && profile && (
        <Card title={profile.name} subtitle={`${profile.team} · ${profile.level}`} action={
          <button onClick={buildAgenda} disabled={loading} className="bg-accent hover:bg-accent/80 text-white text-xs px-3 py-1.5 rounded disabled:opacity-50">
            {loading ? "Working…" : "Generate 1:1 agenda"}
          </button>
        }>
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <div>
              <h3 className="text-xs uppercase text-muted mb-2">Recent 1:1s</h3>
              {profile.oneOnOnes.length === 0 ? (
                <p className="text-xs text-muted">None.</p>
              ) : (
                <ul className="space-y-2">
                  {profile.oneOnOnes.slice(0, 3).map((o, i) => (
                    <li key={i} className="text-xs border border-border rounded p-2">
                      <div className="text-muted mb-1">{o.date} · <span className="text-accent">{o.sentiment}</span></div>
                      <div><b>Topics:</b> {o.topics}</div>
                      <div><b>Commitments:</b> {o.commitments}</div>
                      <div className="italic text-muted mt-1">{o.notes}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="text-xs uppercase text-muted mb-2">Open work</h3>
              {profile.recentTickets.length === 0 ? (
                <p className="text-xs text-muted">No tickets assigned.</p>
              ) : (
                <ul className="space-y-1 text-xs">
                  {profile.recentTickets.map((t) => (
                    <li key={t.key}>
                      <span className="font-mono text-accent">{t.key}</span> · {t.title}{" "}
                      <Pill tone={t.lastMovedDays > 4 ? "warn" : "muted"}>{t.status}</Pill>
                      <span className="text-muted ml-2">moved {t.lastMovedDays}d ago</span>
                    </li>
                  ))}
                </ul>
              )}
              {profile.flags.length > 0 && (
                <div className="mt-3">
                  <h3 className="text-xs uppercase text-muted mb-1">Flags</h3>
                  <ul className="text-xs space-y-1">
                    {profile.flags.map((f, i) => (
                      <li key={i}><Pill tone="warn">{f.kind}</Pill> <span className="ml-1 text-white/80">{f.detail}</span></li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          {agenda && (
            <div className="mt-5 grid md:grid-cols-2 gap-3 text-sm">
              <ListSection title="Agenda" items={agenda.agenda} />
              <ListSection title="Tailored questions" items={agenda.questions} />
              <ListSection title="Growth opportunities" items={agenda.growthOpportunities} />
              <ListSection title="Concerns to surface" items={agenda.concerns} tone="warn" />
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function ListSection({ title, items, tone = "muted" }: { title: string; items: string[]; tone?: "muted" | "warn" }) {
  return (
    <div className="border border-border rounded p-3">
      <div className={`text-xs uppercase mb-2 ${tone === "warn" ? "text-warn" : "text-muted"}`}>{title}</div>
      <ul className="list-disc pl-4 text-xs text-white/85 space-y-1">
        {items.length === 0 ? <li className="text-muted">(none)</li> : items.map((s, i) => <li key={i}>{s}</li>)}
      </ul>
    </div>
  );
}
