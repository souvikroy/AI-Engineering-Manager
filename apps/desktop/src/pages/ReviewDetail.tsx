import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileText, GitBranch, CheckCircle2, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, SeverityBadge, Spinner, Separator, Badge } from "@/components/ui";
import { useJobEvents } from "@/hooks/useJobEvents";
import { cn } from "@/lib/cn";

interface Job {
  id: string;
  repo_url: string;
  status: string;
  target_ref: string;
  head_sha: string;
  created_at: string | null;
  finished_at: string | null;
  intent: any;
  plan: any;
}

interface Finding {
  id: string;
  rule_id: string;
  workflow: number;
  severity: string;
  file_path: string;
  start_line: number;
  end_line: number;
  snippet: string;
  rationale: string;
  fix_suggestion: string;
  confidence: number;
  branch: string;
  status: string;
  static_corroborated: boolean;
  critic_outcome: string;
}

const STAGE_ORDER = ["queued", "ingest", "index", "branch_start", "static", "intent", "plan", "wf", "wf_done", "verify", "done"];

export function ReviewDetailPage() {
  const { jobId } = useParams();
  const job = useQuery<Job>({
    queryKey: ["job", jobId],
    queryFn: () => api(`/api/jobs/${jobId}`),
    refetchInterval: (q) => (q.state.data?.status === "done" || q.state.data?.status === "failed" ? false : 5000),
    enabled: !!jobId,
  });
  const findings = useQuery<Finding[]>({
    queryKey: ["findings", jobId],
    queryFn: () => api(`/api/jobs/${jobId}/findings`),
    enabled: !!jobId,
  });
  const live = useJobEvents(jobId);

  const sevCount = (findings.data || []).reduce<Record<string, number>>((acc, f) => {
    acc[f.severity] = (acc[f.severity] || 0) + 1;
    return acc;
  }, {});

  const repoShort = job.data?.repo_url.replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");

  return (
    <div className="px-8 py-6 max-w-7xl mx-auto">
      <Button variant="ghost" size="sm" className="mb-4">
        <Link to="/app/repos" className="inline-flex items-center"><ArrowLeft className="w-4 h-4 mr-1" /> Back</Link>
      </Button>

      <div className="flex items-start gap-4 mb-6">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-muted-foreground" /> {repoShort || "Review"}
          </h1>
          <div className="flex items-center gap-2 mt-1.5 text-sm text-muted-foreground">
            <code className="text-xs">{job.data?.head_sha.slice(0, 12) || "—"}</code>
            <span>·</span>
            <span>{job.data?.status || "loading"}</span>
            {job.data?.intent?.goal && <><span>·</span><span className="truncate">{job.data.intent.goal}</span></>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4 mb-6">
        <SeverityCard label="P0" count={sevCount.P0 || 0} />
        <SeverityCard label="P1" count={sevCount.P1 || 0} />
        <SeverityCard label="P2" count={sevCount.P2 || 0} />
        <SeverityCard label="P3" count={sevCount.P3 || 0} />
      </div>

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Live progress</CardTitle>
              <CardDescription>{live.done ? "Complete" : "Streaming events…"}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 max-h-[60vh] overflow-y-auto">
              {live.events.length === 0 && !live.done && (
                <div className="text-sm text-muted-foreground flex items-center gap-2"><Spinner /> waiting for worker…</div>
              )}
              {live.events.map((e, i) => (
                <ProgressItem key={i} stage={e.stage} workflow={e.workflow} message={e.message} />
              ))}
              {live.error && <div className="text-xs text-red-400 mt-2">{live.error}</div>}
            </CardContent>
          </Card>
        </div>
        <div className="col-span-8">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Findings ({findings.data?.length ?? 0})</CardTitle>
              <CardDescription>Severity-grouped. Click a finding to see context.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 max-h-[60vh] overflow-y-auto">
              {findings.isLoading && <Spinner />}
              {findings.data && findings.data.length === 0 && (
                <div className="text-sm text-muted-foreground py-8 text-center">No findings yet.</div>
              )}
              {findings.data?.map((f) => <FindingCard key={f.id} f={f} />)}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function SeverityCard({ label, count }: { label: string; count: number }) {
  const cls = label === "P0" ? "severity-p0" : label === "P1" ? "severity-p1" : label === "P2" ? "severity-p2" : "severity-p3";
  return (
    <Card className="col-span-3">
      <CardContent className="py-4 flex items-center justify-between">
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-wider">{label}</div>
          <div className="text-2xl font-semibold mt-1">{count}</div>
        </div>
        <Badge className={cls}>{label}</Badge>
      </CardContent>
    </Card>
  );
}

function ProgressItem({ stage, workflow, message }: { stage: string; workflow: number | null; message: string | null }) {
  const isError = stage === "error" || stage === "failed";
  const isDone = stage === "done";
  return (
    <div className="flex items-start gap-2 text-sm">
      {isError ? (
        <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
      ) : isDone ? (
        <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
      ) : (
        <span className="w-2 h-2 rounded-full bg-zinc-500 mt-2 ml-1 flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="font-medium">
          <span className="text-foreground">{stage}</span>
          {workflow != null && <span className="ml-1 text-muted-foreground">WF{String(workflow).padStart(2, "0")}</span>}
        </div>
        {message && <div className="text-xs text-muted-foreground truncate">{message}</div>}
      </div>
    </div>
  );
}

function FindingCard({ f }: { f: Finding }) {
  return (
    <div className="rounded-md border border-border p-3 space-y-2 hover:border-zinc-600/60 transition-colors">
      <div className="flex items-center gap-2 flex-wrap">
        <SeverityBadge severity={f.severity} />
        <code className="text-xs font-mono px-1.5 py-0.5 rounded bg-zinc-800/60">{f.rule_id}</code>
        <span className="text-xs text-muted-foreground">WF{String(f.workflow).padStart(2, "0")}</span>
        <Separator orientation="vertical" className="h-4" />
        <span className="text-xs text-muted-foreground truncate">{f.file_path}:{f.start_line}</span>
        <span className="ml-auto text-xs text-muted-foreground">conf {f.confidence.toFixed(2)}</span>
      </div>
      <p className="text-sm">{f.rationale}</p>
      {f.snippet && (
        <pre className="rounded-md bg-zinc-950/60 border border-border p-2 text-xs font-mono overflow-x-auto">{f.snippet}</pre>
      )}
      {f.fix_suggestion && (
        <p className="text-xs text-emerald-300/80"><span className="font-medium text-emerald-300">Fix:</span> {f.fix_suggestion}</p>
      )}
      {(f.static_corroborated || f.critic_outcome !== "not_run") && (
        <div className="flex gap-1.5 text-[10px] text-muted-foreground">
          {f.static_corroborated && <span className="px-1.5 py-0.5 rounded bg-zinc-800/60">static</span>}
          {f.critic_outcome && f.critic_outcome !== "not_run" && (
            <span className={cn("px-1.5 py-0.5 rounded", f.critic_outcome === "survived" ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-800/60")}>
              critic: {f.critic_outcome}
            </span>
          )}
          <span className="px-1.5 py-0.5 rounded bg-zinc-800/60">branch: {f.branch}</span>
        </div>
      )}
    </div>
  );
}
