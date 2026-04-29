import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Spinner } from "@/components/ui";
import { BrandMark } from "@/components/BrandLogo";
import { authStore } from "@/lib/auth-store";
import { API_BASE } from "@/lib/api";

interface FormValues { email: string; password: string }

export function LoginPage() {
  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") || "/app";

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Login failed");
      }
      const data = await res.json();
      await authStore.setSession({ access: data.access_token, refresh: data.refresh_token });
      navigate(next, { replace: true });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center px-4 bg-gradient-to-b from-background to-zinc-950">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="flex items-center gap-2 mb-1">
            <BrandMark size={28} tile />
            <CardTitle>Sign in to OpenGraphXEM</CardTitle>
          </div>
          <CardDescription>Welcome back. Sign in to your workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" {...register("email", { required: true })} />
              {errors.email && <p className="text-xs text-destructive">Required</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="current-password" {...register("password", { required: true })} />
              {errors.password && <p className="text-xs text-destructive">Required</p>}
            </div>
            {error && <div className="text-sm text-red-400 border border-red-500/30 bg-red-500/10 rounded-md px-3 py-2">{error}</div>}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? <Spinner /> : "Sign in"}
            </Button>
            <div className="text-xs text-muted-foreground text-center">
              Demo login: <span className="font-mono">demo@test.com</span> / <span className="font-mono">123456</span>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
