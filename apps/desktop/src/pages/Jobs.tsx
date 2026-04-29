import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ChevronRight, ListChecks } from "lucide-react";
import { api } from "@/lib/api";
import { Card, CardContent, Spinner } from "@/components/ui";

interface Job { id: string; repo_url: string; status: string; head_sha: string; created_at: string | null; finished_at: string | null }

export function JobsPage() {
  const q = useQuery<Job[]>({ queryKey: ["jobs"], queryFn: () => api("/api/jobs?limit=50") });

  return (
    <div className="px-8 py-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Reviews</h1>
        <p className="text-sm text-muted-foreground mt-1">Recent review jobs across your repos.</p>
      </div>
      {q.isLoading && <Spinner />}
      {q.data && q.data.length === 0 && (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <ListChecks className="w-8 h-8 mx-auto mb-3 opacity-50" />
          <p>No reviews yet.</p>
        </CardContent></Card>
      )}
      <div className="space-y-2">
        {q.data?.map((j) => {
          const dot = j.status === "done" ? "bg-emerald-400" : j.status === "running" ? "bg-blue-400 animate-pulse" : j.status === "failed" ? "bg-red-400" : "bg-zinc-500";
          return (
            <Link key={j.id} to={`/app/reviews/${j.id}`} className="block">
              <Card className="hover:border-zinc-600/60 transition-colors">
                <CardContent className="py-4 flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full ${dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{j.repo_url.replace(/^https?:\/\/github\.com\//, "")}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {j.head_sha?.slice(0, 12) || "—"} · {j.status} · {j.created_at?.slice(0, 19).replace("T", " ") || ""}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
