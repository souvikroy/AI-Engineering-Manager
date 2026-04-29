import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Ticket as TicketIcon, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { Badge, Card, CardContent, SeverityBadge, Spinner } from "@/components/ui";

interface Ticket {
  id: string;
  key: string;
  repo_id: string;
  job_id: string | null;
  finding_id: string | null;
  title: string;
  severity: string;
  status: string;
  rule_id: string;
  file_path: string;
  start_line: number;
  end_line: number;
  created_at: string | null;
  updated_at: string | null;
  closed_at: string | null;
}

interface TicketList {
  items: Ticket[];
  open_count: number;
}

interface Repo {
  id: string;
  url: string;
}

const STATUSES = ["open", "in_progress", "done", "wont_fix"] as const;
const SEVERITIES = ["P0", "P1", "P2"] as const;

export function TicketsPage() {
  const [params, setParams] = useSearchParams();
  const repoId = params.get("repo_id") ?? "";
  const status = params.get("status") ?? "";
  const severity = params.get("severity") ?? "";

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const qs = new URLSearchParams();
  if (repoId) qs.set("repo_id", repoId);
  if (status) qs.set("status", status);
  if (severity) qs.set("severity", severity);
  const qsStr = qs.toString();

  const tickets = useQuery<TicketList>({
    queryKey: ["tickets", { repoId, status, severity }],
    queryFn: () => api(`/api/tickets${qsStr ? `?${qsStr}` : ""}`),
  });
  const repos = useQuery<Repo[]>({ queryKey: ["repos"], queryFn: () => api("/api/repos") });
  const repoById = new Map((repos.data ?? []).map((r) => [r.id, r]));

  return (
    <div className="px-8 py-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tickets</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Auto-created from review findings (P0/P1/P2). {tickets.data && `${tickets.data.open_count} open.`}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4 text-sm">
        <FilterGroup label="Repo" value={repoId} onChange={(v) => setParam("repo_id", v)}
          options={[{ value: "", label: "All repos" }, ...(repos.data ?? []).map((r) => ({
            value: r.id,
            label: r.url.replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "") || r.url,
          }))]}
        />
        <FilterGroup label="Status" value={status} onChange={(v) => setParam("status", v)}
          options={[{ value: "", label: "All" }, ...STATUSES.map((s) => ({ value: s, label: s.replace("_", " ") }))]}
        />
        <FilterGroup label="Severity" value={severity} onChange={(v) => setParam("severity", v)}
          options={[{ value: "", label: "All" }, ...SEVERITIES.map((s) => ({ value: s, label: s }))]}
        />
      </div>

      {tickets.isLoading && (
        <div className="text-muted-foreground flex items-center gap-2"><Spinner /> Loading…</div>
      )}
      {tickets.error && <div className="text-red-400 text-sm">{(tickets.error as Error).message}</div>}
      {tickets.data && tickets.data.items.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <TicketIcon className="w-8 h-8 mx-auto mb-3 opacity-50" />
            <p>No tickets yet — kick off a review on a repo to generate tickets.</p>
          </CardContent>
        </Card>
      )}
      {tickets.data && tickets.data.items.length > 0 && (
        <div className="space-y-2">
          {tickets.data.items.map((t) => (
            <TicketRow key={t.id} t={t} repoLabel={
              repoById.get(t.repo_id)?.url.replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "")
            } />
          ))}
        </div>
      )}
    </div>
  );
}

function TicketRow({ t, repoLabel }: { t: Ticket; repoLabel?: string }) {
  return (
    <Link to={`/app/tickets/${t.id}`} className="block">
      <Card className="hover:border-zinc-600/60 transition-colors">
        <CardContent className="py-3 flex items-center gap-3">
          <span className="font-mono text-xs text-muted-foreground w-16 flex-shrink-0">{t.key}</span>
          <SeverityBadge severity={t.severity} />
          <StatusBadge status={t.status} />
          <div className="flex-1 min-w-0">
            <div className="text-sm truncate">{t.title}</div>
            <div className="text-xs text-muted-foreground mt-0.5 truncate">
              {repoLabel ? `${repoLabel} · ` : ""}{t.file_path}{t.start_line ? `:${t.start_line}` : ""}
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        </CardContent>
      </Card>
    </Link>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    open: "bg-blue-500/15 text-blue-300 border border-blue-500/30",
    in_progress: "bg-amber-500/15 text-amber-300 border border-amber-500/30",
    done: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
    wont_fix: "bg-zinc-700/40 text-zinc-300 border border-zinc-600/40",
  };
  const label = status.replace("_", " ");
  return <Badge className={map[status] ?? "bg-zinc-800 text-zinc-300"}>{label}</Badge>;
}

function FilterGroup({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="inline-flex items-center gap-2 text-muted-foreground">
      <span className="text-xs uppercase tracking-wider">{label}</span>
      <select
        className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
