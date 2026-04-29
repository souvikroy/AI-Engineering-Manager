import { useParams, Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, GitBranch, ExternalLink, Sparkles } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, SeverityBadge, Separator, Spinner } from "@/components/ui";
import { Markdown } from "@/components/Markdown";
import { StatusBadge } from "./Tickets";
import { cn } from "@/lib/cn";

interface TicketDetail {
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
  rationale: string;
  fix_suggestion: string;
  snippet: string;
  branch: string;
  confidence: number;
  repo_url: string;
  body: string;
  body_format: string;
  body_source: string;
}

const TRANSITIONS: { value: string; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "done", label: "Done" },
  { value: "wont_fix", label: "Won't Fix" },
];

export function TicketDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const ticket = useQuery<TicketDetail>({
    queryKey: ["ticket", id],
    queryFn: () => api(`/api/tickets/${id}`),
    enabled: !!id,
    // Server upgrades a `template` body to `llm` in the background on first GET. Poll every
    // 4s while the upgrade is pending so the user actually sees it land — once the body is
    // either user-edited or LLM-generated, polling stops.
    refetchInterval: (q) => (q.state.data?.body_source === "template" ? 4000 : false),
  });

  const transition = useMutation({
    mutationFn: (status: string) =>
      api<TicketDetail>(`/api/tickets/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ticket", id] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
      qc.invalidateQueries({ queryKey: ["repo-tickets"] });
    },
  });

  const regenerate = useMutation({
    mutationFn: () =>
      api<TicketDetail>(`/api/tickets/${id}/regenerate-body`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ticket", id] });
    },
  });

  if (ticket.isLoading) {
    return <div className="px-8 py-6 max-w-5xl mx-auto text-muted-foreground flex items-center gap-2"><Spinner /> Loading…</div>;
  }
  if (ticket.error) {
    const err = ticket.error as ApiError;
    return (
      <div className="px-8 py-6 max-w-5xl mx-auto">
        <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate("/app/tickets")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to tickets
        </Button>
        <div className="text-sm text-red-400">{err.message || "Ticket not found"}</div>
      </div>
    );
  }
  const t = ticket.data!;
  const repoShort = t.repo_url.replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");

  return (
    <div className="px-8 py-6 max-w-5xl mx-auto">
      <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate(-1)}>
        <ArrowLeft className="w-4 h-4 mr-1" /> Back
      </Button>

      <div className="flex items-start gap-4 mb-6 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm text-muted-foreground">{t.key}</span>
            <SeverityBadge severity={t.severity} />
            <StatusBadge status={t.status} />
          </div>
          <h1 className="text-xl font-semibold tracking-tight mt-2 break-words">{t.title}</h1>
          {repoShort && (
            <Link to={`/app/repos/${t.repo_id}`} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mt-1">
              <GitBranch className="w-3.5 h-3.5" /> {repoShort}
            </Link>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {TRANSITIONS.map((opt) => (
          <Button
            key={opt.value}
            variant={t.status === opt.value ? "default" : "outline"}
            size="sm"
            disabled={transition.isPending || t.status === opt.value}
            onClick={() => transition.mutate(opt.value)}
          >
            {transition.isPending ? <Spinner className="w-3 h-3" /> : opt.label}
          </Button>
        ))}
      </div>
      {transition.error && (
        <div className="text-sm text-red-400 mb-4">{(transition.error as Error).message}</div>
      )}

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 md:col-span-8 space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
              <div className="flex items-center gap-2 min-w-0">
                <CardTitle className="text-base flex items-center gap-2 min-w-0">
                  <code className="text-xs font-mono px-1.5 py-0.5 rounded bg-zinc-800/60">{t.rule_id}</code>
                  <Separator orientation="vertical" className="h-4" />
                  <span className="text-sm text-muted-foreground truncate">{t.file_path}{t.start_line ? `:${t.start_line}` : ""}</span>
                </CardTitle>
                <BodySourceBadge source={t.body_source} />
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={regenerate.isPending}
                onClick={() => regenerate.mutate()}
                title="Regenerate the ticket body using the configured LLM"
              >
                {regenerate.isPending ? <Spinner className="w-3 h-3" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}
                Regenerate
              </Button>
            </CardHeader>
            <CardContent>
              {t.body ? (
                <Markdown source={t.body} />
              ) : (
                <div className="space-y-3">
                  {t.rationale ? <p className="text-sm">{t.rationale}</p> : (
                    <p className="text-sm text-muted-foreground italic">No body recorded.</p>
                  )}
                  {t.snippet && (
                    <pre className="rounded-md bg-zinc-950/60 border border-border p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap">{t.snippet}</pre>
                  )}
                  {t.fix_suggestion && (
                    <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm">
                      <span className="font-medium text-emerald-300">Suggested fix: </span>
                      <span className="text-emerald-200/90">{t.fix_suggestion}</span>
                    </div>
                  )}
                </div>
              )}
              {regenerate.error && (
                <div className="text-sm text-red-400 mt-3">{(regenerate.error as Error).message}</div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="col-span-12 md:col-span-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <DetailRow label="Severity"><SeverityBadge severity={t.severity} /></DetailRow>
              <DetailRow label="Status"><StatusBadge status={t.status} /></DetailRow>
              <DetailRow label="Branch">{t.branch || "—"}</DetailRow>
              <DetailRow label="Confidence">{t.confidence ? t.confidence.toFixed(2) : "—"}</DetailRow>
              <DetailRow label="Created">{fmtDate(t.created_at)}</DetailRow>
              <DetailRow label="Updated">{fmtDate(t.updated_at)}</DetailRow>
              {t.closed_at && <DetailRow label="Closed">{fmtDate(t.closed_at)}</DetailRow>}
              {t.job_id && (
                <DetailRow label="Source review">
                  <Link to={`/app/reviews/${t.job_id}`} className="text-primary hover:underline inline-flex items-center gap-1">
                    Open <ExternalLink className="w-3 h-3" />
                  </Link>
                </DetailRow>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function BodySourceBadge({ source }: { source: string }) {
  if (!source) return null;
  if (source === "llm") return <Badge className="bg-violet-500/15 text-violet-300 border border-violet-500/30">LLM</Badge>;
  if (source === "template") return <Badge className="bg-zinc-700/40 text-zinc-300 border border-zinc-600/40">template</Badge>;
  return null;
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground uppercase tracking-wider">{label}</span>
      <span className={cn("text-right")}>{children}</span>
    </div>
  );
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return s.slice(0, 19).replace("T", " ");
}
