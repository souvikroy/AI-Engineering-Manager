import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Plus, GitBranch, Play, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Card, CardContent, Spinner, Badge } from "@/components/ui";

interface Repo {
  id: string;
  url: string;
  default_branch: string | null;
  pat_hint: string | null;
  has_pat: boolean;
  pinecone_namespace: string;
  created_at: string;
  last_review: { id: string; status: string; created_at: string | null } | null;
}

export function ReposPage() {
  const q = useQuery<Repo[]>({ queryKey: ["repos"], queryFn: () => api("/api/repos") });

  return (
    <div className="px-8 py-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Repositories</h1>
          <p className="text-sm text-muted-foreground mt-1">Connected GitHub repos. Reviews run against every branch.</p>
        </div>
        <Button>
          <Link to="/app/repos/new" className="inline-flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Add repo
          </Link>
        </Button>
      </div>

      {q.isLoading && (
        <div className="text-muted-foreground flex items-center gap-2"><Spinner /> Loading…</div>
      )}
      {q.error && <div className="text-red-400 text-sm">{(q.error as Error).message}</div>}
      {q.data && q.data.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <GitBranch className="w-8 h-8 mx-auto mb-3 opacity-50" />
            <p className="mb-4">No repos yet.</p>
            <Button>
              <Link to="/app/repos/new" className="inline-flex items-center gap-1.5">
                <Plus className="w-4 h-4" /> Add your first repo
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}
      {q.data && q.data.length > 0 && (
        <div className="space-y-3">
          {q.data.map((r) => <RepoRow key={r.id} repo={r} />)}
        </div>
      )}
    </div>
  );
}

function RepoRow({ repo }: { repo: Repo }) {
  const short = repo.url.replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");
  return (
    <Link to={`/app/repos/${repo.id}`} className="block">
      <Card className="hover:border-zinc-600/60 transition-colors">
        <CardContent className="py-4 flex items-center gap-4">
          <GitBranch className="w-5 h-5 text-muted-foreground flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">{short}</span>
              {repo.has_pat && <Badge className="bg-zinc-800 text-zinc-300">PAT •••{repo.pat_hint}</Badge>}
              {repo.last_review && <StatusBadge status={repo.last_review.status} />}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Namespace: <code>{repo.pinecone_namespace}</code></div>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </CardContent>
      </Card>
    </Link>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    queued: "bg-zinc-700/40 text-zinc-300",
    running: "bg-blue-500/15 text-blue-300",
    done: "bg-emerald-500/15 text-emerald-300",
    failed: "bg-red-500/15 text-red-400",
  };
  return <Badge className={map[status] || "bg-zinc-800 text-zinc-300"}>{status}</Badge>;
}
