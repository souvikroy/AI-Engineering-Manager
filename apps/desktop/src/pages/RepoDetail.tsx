import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, GitBranch, Play, Trash2, Ticket as TicketIcon, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Card, CardContent, CardHeader, CardTitle, CardDescription, Spinner, Badge, SeverityBadge } from "@/components/ui";
import { StatusBadge } from "./Tickets";

interface Repo { id: string; url: string; pat_hint: string | null; has_pat: boolean; pinecone_namespace: string; created_at: string }
interface Job { id: string; status: string; created_at: string | null; head_sha: string }
interface Ticket {
  id: string; key: string; title: string; severity: string; status: string;
  file_path: string; start_line: number; rule_id: string;
}
interface TicketList { items: Ticket[]; open_count: number }

export function RepoDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const repo = useQuery<Repo>({ queryKey: ["repo", id], queryFn: () => api(`/api/repos/${id}`), enabled: !!id });
  const jobs = useQuery<Job[]>({ queryKey: ["jobs", id], queryFn: () => api(`/api/jobs?limit=20`), enabled: !!id });
  const tickets = useQuery<TicketList>({
    queryKey: ["repo-tickets", id],
    queryFn: () => api(`/api/repos/${id}/tickets?status=open`),
    enabled: !!id,
  });

  const trigger = useMutation({
    mutationFn: () => api<{ job_id: string }>(`/api/repos/${id}/reviews`, { method: "POST" }),
    onSuccess: ({ job_id }) => { navigate(`/app/reviews/${job_id}`); }
  });

  const archive = useMutation({
    mutationFn: () => api(`/api/repos/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["repos"] }); navigate("/app/repos"); }
  });

  const repoJobs = (jobs.data || []).filter((j) => true);  // server already scopes by user

  // Render the page shell immediately; per-section loaders cover individual API delays.
  // (Going hard "spinner-on-the-whole-page" used to mean a single slow fetch hid the whole UI.)
  const repoUrl = repo.data?.url ?? "";
  const short = repoUrl.replace(/^https?:\/\/github\.com\//, "") || (id ?? "");
  const repoMissing = !repo.isLoading && !repo.data && !!repo.error;

  if (repoMissing) {
    return (
      <div className="px-8 py-6 max-w-5xl mx-auto">
        <Button variant="ghost" size="sm" className="mb-4">
          <Link to="/app/repos" className="inline-flex items-center"><ArrowLeft className="w-4 h-4 mr-1" /> Repos</Link>
        </Button>
        <div className="text-sm text-muted-foreground">
          Couldn't load this repo: {(repo.error as Error)?.message || "not found"}.
        </div>
      </div>
    );
  }

  return (
    <div className="px-8 py-6 max-w-5xl mx-auto">
      <Button variant="ghost" size="sm" className="mb-4">
        <Link to="/app/repos" className="inline-flex items-center"><ArrowLeft className="w-4 h-4 mr-1" /> Repos</Link>
      </Button>

      <div className="flex items-start gap-4 mb-6">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-muted-foreground" />
            {repo.isLoading ? <span className="text-muted-foreground">Loading repo…</span> : short}
          </h1>
          <div className="text-sm text-muted-foreground mt-1.5 inline-flex items-center gap-2 flex-wrap">
            {repo.data?.has_pat && <Badge className="bg-zinc-800 text-zinc-300">PAT •••{repo.data.pat_hint}</Badge>}
            {repo.data?.pinecone_namespace && <code className="text-xs">{repo.data.pinecone_namespace}</code>}
            {repo.isLoading && <Spinner className="w-3 h-3" />}
          </div>
        </div>
        <Button onClick={() => trigger.mutate()} disabled={trigger.isPending || repo.isLoading || !repo.data}>
          {trigger.isPending ? <Spinner /> : <><Play className="w-4 h-4 mr-1" /> Run review</>}
        </Button>
        <Button variant="outline" onClick={() => archive.mutate()} disabled={archive.isPending || repo.isLoading || !repo.data}>
          <Trash2 className="w-4 h-4 mr-1" /> Archive
        </Button>
      </div>

      <Card className="mb-6">
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <TicketIcon className="w-4 h-4 text-muted-foreground" />
              Open Tickets ({tickets.data?.open_count ?? 0})
            </CardTitle>
            <CardDescription>Auto-created from review findings (P0/P1/P2).</CardDescription>
          </div>
          {(tickets.data?.items.length ?? 0) > 0 && (
            <Link to={`/app/tickets?repo_id=${id}`} className="text-sm text-primary hover:underline inline-flex items-center gap-1">
              View all <ChevronRight className="w-4 h-4" />
            </Link>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {tickets.isLoading && <div className="text-sm text-muted-foreground inline-flex items-center gap-2"><Spinner /> Loading tickets…</div>}
          {tickets.error && !tickets.data && (
            <div className="text-xs text-red-400">Couldn't load tickets: {(tickets.error as Error).message}</div>
          )}
          {tickets.data && tickets.data.items.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-6">
              No open tickets — run a review to surface issues.
            </div>
          )}
          {tickets.data?.items.slice(0, 5).map((t) => (
            <Link key={t.id} to={`/app/tickets/${t.id}`} className="flex items-center gap-3 py-2 px-3 rounded-md hover:bg-zinc-900/40">
              <span className="font-mono text-xs text-muted-foreground w-14 flex-shrink-0">{t.key}</span>
              <SeverityBadge severity={t.severity} />
              <StatusBadge status={t.status} />
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{t.title}</div>
                <div className="text-xs text-muted-foreground truncate">{t.file_path}{t.start_line ? `:${t.start_line}` : ""}</div>
              </div>
            </Link>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reviews</CardTitle>
          <CardDescription>Most recent runs.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {jobs.isLoading && <div className="text-sm text-muted-foreground inline-flex items-center gap-2"><Spinner /> Loading reviews…</div>}
          {jobs.error && !jobs.data && (
            <div className="text-xs text-red-400">Couldn't load reviews: {(jobs.error as Error).message}</div>
          )}
          {!jobs.isLoading && !jobs.error && repoJobs.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-6">No runs yet.</div>
          )}
          {repoJobs.map((j) => (
            <Link key={j.id} to={`/app/reviews/${j.id}`} className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-zinc-900/40">
              <div className="text-sm">
                <code className="text-xs">{j.head_sha?.slice(0, 12) || "—"}</code>
                <span className="ml-2 text-muted-foreground">{j.created_at?.slice(0, 19).replace("T", " ")}</span>
              </div>
              <Badge className="bg-zinc-800 text-zinc-300">{j.status}</Badge>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
