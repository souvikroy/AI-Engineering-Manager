import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Spinner } from "@/components/ui";

interface Me { id: string; email: string; display_name: string | null; email_verified: boolean }

export function SettingsPage() {
  const me = useQuery<Me>({ queryKey: ["me"], queryFn: () => api("/api/me") });

  return (
    <div className="px-8 py-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold tracking-tight mb-6">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Account details associated with your workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          {me.isLoading && <Spinner />}
          {me.data && (
            <dl className="grid grid-cols-3 gap-y-3">
              <dt className="text-sm text-muted-foreground">Display name</dt>
              <dd className="col-span-2 text-sm">{me.data.display_name || "—"}</dd>
              <dt className="text-sm text-muted-foreground">Email</dt>
              <dd className="col-span-2 text-sm">{me.data.email}</dd>
              <dt className="text-sm text-muted-foreground">Email verified</dt>
              <dd className="col-span-2 text-sm">{me.data.email_verified ? "Yes" : "No"}</dd>
              <dt className="text-sm text-muted-foreground">User ID</dt>
              <dd className="col-span-2 text-sm font-mono text-xs">{me.data.id}</dd>
            </dl>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
