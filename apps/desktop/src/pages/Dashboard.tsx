import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { GitBranch, ListChecks, Plus, ChevronRight, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, SeverityBadge, Spinner } from "@/components/ui";

interface Repo { id: string; url: string; last_review: { id: string; status: string } | null }
interface Job { id: string; repo_url: string; status: string; created_at: string | null }
interface Me { id: string; email: string; display_name: string | null }

export function DashboardPage() {
  const me = useQuery<Me>({ queryKey: ["me"], queryFn: () => api("/api/me") });
  const repos = useQuery<Repo[]>({ queryKey: ["repos"], queryFn: () => api("/api/repos") });
  const jobs = useQuery<Job[]>({ queryKey: ["jobs"], queryFn: () => api("/api/jobs?limit=10") });

  return (
    <div className="px-8 py-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          {me.isLoading ? "…" : `Welcome${me.data?.display_name ? `, ${me.data.display_name}` : ""}`}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Add a GitHub repo and your PAT — the engine will run all 21 review workflows against every branch.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <StatCard icon={<GitBranch className="w-5 h-5" />} label="Repos" value={repos.data?.length ?? "—"} to="/app/repos" />
        <StatCard icon={<ListChecks className="w-5 h-5" />} label="Recent reviews" value={jobs.data?.length ?? "—"} to="/app/jobs" />
        <StatCard icon={<Sparkles className="w-5 h-5" />} label="Rules covered" value="224" />
      </div>

      <div className="grid grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Repos</CardTitle>
              <Button variant="ghost" size="sm">
                <Link to="/app/repos/new" className="inline-flex items-center"><Plus className="w-4 h-4 mr-1" /> Add</Link>
              </Button>
            </div>
            <CardDescription>Your connected GitHub repositories.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {repos.isLoading && <Spinner />}
            {repos.data && repos.data.length === 0 && (
              <div className="text-sm text-muted-foreground py-4 text-center">No repos. <Link to="/app/repos/new" className="underline">Add one</Link>.</div>
            )}
            {repos.data?.slice(0, 5).map((r) => (
              <Link key={r.id} to={`/app/repos/${r.id}`} className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-zinc-900/40 transition-colors">
                <div className="flex items-center gap-2 min-w-0">
                  <GitBranch className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm truncate">{r.url.replace(/^https?:\/\/github\.com\//, "")}</span>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent reviews</CardTitle>
            <CardDescription>Latest jobs across your repos.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {jobs.isLoading && <Spinner />}
            {jobs.data && jobs.data.length === 0 && (
              <div className="text-sm text-muted-foreground py-4 text-center">No reviews yet.</div>
            )}
            {jobs.data?.slice(0, 8).map((j) => (
              <Link key={j.id} to={`/app/reviews/${j.id}`} className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-zinc-900/40 transition-colors">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-1.5 h-1.5 rounded-full ${j.status === "done" ? "bg-emerald-400" : j.status === "running" ? "bg-blue-400 animate-pulse" : j.status === "failed" ? "bg-red-400" : "bg-zinc-500"}`} />
                  <span className="text-sm truncate">{j.repo_url.replace(/^https?:\/\/github\.com\//, "")}</span>
                </div>
                <span className="text-xs text-muted-foreground">{j.status}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, to }: { icon: React.ReactNode; label: string; value: any; to?: string }) {
  const inner = (
    <Card className={to ? "hover:border-zinc-600/60 transition-colors cursor-pointer" : ""}>
      <CardContent className="py-4 flex items-center gap-4">
        <div className="w-10 h-10 rounded-md bg-zinc-900 grid place-items-center text-muted-foreground">{icon}</div>
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-wider">{label}</div>
          <div className="text-2xl font-semibold mt-0.5">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}
