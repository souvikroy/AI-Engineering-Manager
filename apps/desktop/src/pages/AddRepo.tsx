import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, GitBranch } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Spinner } from "@/components/ui";

interface FormValues { url: string; pat: string }

export function AddRepoPage() {
  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>();
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const addAndStart = useMutation({
    mutationFn: async (values: FormValues) => {
      const repo = await api<{ id: string }>("/api/repos", { method: "POST", body: JSON.stringify(values) });
      const review = await api<{ job_id: string }>(`/api/repos/${repo.id}/reviews`, { method: "POST" });
      return { repo, review };
    },
    onSuccess: ({ review }) => {
      qc.invalidateQueries({ queryKey: ["repos"] });
      navigate(`/app/reviews/${review.job_id}`, { replace: true });
    },
    onError: (e: any) => setError(e.message || "Failed"),
  });

  return (
    <div className="px-8 py-6 max-w-2xl mx-auto">
      <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate(-1)}>
        <ArrowLeft className="w-4 h-4 mr-1" /> Back
      </Button>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 mb-1">
            <GitBranch className="w-5 h-5" />
            <CardTitle>Add a GitHub repository</CardTitle>
          </div>
          <CardDescription>
            Paste a repo URL and a personal access token. The token is encrypted at rest with AES (Fernet) and only decrypted in the worker for the duration of `git clone`.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit((v) => addAndStart.mutate(v))}>
            <div className="space-y-1.5">
              <Label htmlFor="url">Repo URL</Label>
              <Input id="url" placeholder="https://github.com/owner/repo" {...register("url", { required: true })} />
              {errors.url && <p className="text-xs text-destructive">Required</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pat">GitHub PAT</Label>
              <Input id="pat" type="password" placeholder="ghp_…" {...register("pat", { required: true, minLength: 20 })} />
              {errors.pat && <p className="text-xs text-destructive">Required (≥ 20 chars)</p>}
              <p className="text-xs text-muted-foreground">
                Needs <code>repo:read</code> scope on the target repo. Stored encrypted; UI shows only the last 4 chars.
              </p>
            </div>
            {error && <div className="text-sm text-red-400 border border-red-500/30 bg-red-500/10 rounded-md px-3 py-2">{error}</div>}
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={addAndStart.isPending}>
                {addAndStart.isPending ? <Spinner /> : "Add and start review"}
              </Button>
              <Button type="button" variant="outline" onClick={() => navigate(-1)}>Cancel</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
