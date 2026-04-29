"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "./Button";

export function RegenerateButton({ endpoint, label = "Regenerate", body }: { endpoint: string; label?: string; body?: unknown }) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="flex items-center gap-2">
      {err && <span className="text-[11px] text-bad">{err}</span>}
      <Button
        disabled={pending}
        size="sm"
        variant="primary"
        onClick={() => {
          setErr(null);
          startTransition(async () => {
            try {
              const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : "{}" });
              if (!res.ok) {
                const j = (await res.json().catch(() => ({}))) as { error?: string };
                throw new Error(j.error ?? `HTTP ${res.status}`);
              }
              router.refresh();
            } catch (e) {
              setErr((e as Error).message);
            }
          });
        }}
      >
        {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        {pending ? "Working" : label}
      </Button>
    </div>
  );
}
