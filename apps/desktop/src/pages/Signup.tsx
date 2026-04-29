import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Spinner } from "@/components/ui";
import { BrandMark } from "@/components/BrandLogo";
import { authStore } from "@/lib/auth-store";
import { API_BASE } from "@/lib/api";

interface FormValues { email: string; password: string; display_name: string }

export function SignupPage() {
  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Signup failed");
      }
      const data = await res.json();
      await authStore.setSession({ access: data.access_token, refresh: data.refresh_token });
      navigate("/app", { replace: true });
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
            <CardTitle>Create your OpenGraphXEM workspace</CardTitle>
          </div>
          <CardDescription>Sign up to start reviewing GitHub repos.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
            <div className="space-y-1.5">
              <Label htmlFor="display_name">Name</Label>
              <Input id="display_name" {...register("display_name", { required: true })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" {...register("email", { required: true })} />
              {errors.email && <p className="text-xs text-destructive">Required</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="new-password" {...register("password", { required: true, minLength: 12 })} />
              {errors.password && <p className="text-xs text-destructive">Min 12 characters</p>}
            </div>
            {error && <div className="text-sm text-red-400 border border-red-500/30 bg-red-500/10 rounded-md px-3 py-2">{error}</div>}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? <Spinner /> : "Create account"}
            </Button>
            <div className="text-sm text-muted-foreground text-center">
              Already have one? <Link to="/login" className="underline-offset-2 hover:underline text-foreground">Sign in</Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
