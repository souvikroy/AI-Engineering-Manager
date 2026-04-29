"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function RegenerateButton({ endpoint, label = "Regenerate", body }: { endpoint: string; label?: string; body?: unknown }) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="flex items-center gap-2">
      <button
        disabled={pending}
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
        className="bg-accent hover:bg-accent/80 text-white text-xs px-3 py-1.5 rounded disabled:opacity-50"
      >
        {pending ? "Working…" : label}
      </button>
      {err && <span className="text-xs text-bad">{err}</span>}
    </div>
  );
}
