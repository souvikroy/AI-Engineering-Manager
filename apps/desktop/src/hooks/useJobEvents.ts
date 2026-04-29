import { useEffect, useState } from "react";
import { api, API_BASE } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";

export interface JobEvent {
  stage: string;
  workflow: number | null;
  message: string | null;
  data: Record<string, any>;
  ts: string | null;
}

export function useJobEvents(jobId: string | undefined) {
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let es: EventSource | null = null;

    (async () => {
      try {
        const tokenRes = await api<{ token: string }>(`/api/jobs/${jobId}/event-token`, { method: "POST" });
        if (cancelled) return;
        const url = `${API_BASE}/api/jobs/${jobId}/events?t=${encodeURIComponent(tokenRes.token)}`;
        es = new EventSource(url);
        es.onmessage = (msg) => {
          try {
            const evt: JobEvent = JSON.parse(msg.data);
            setEvents((prev) => [...prev, evt]);
            if (evt.stage === "finding") {
              qc.invalidateQueries({ queryKey: ["findings", jobId] });
            }
            if (evt.stage === "done" || evt.stage === "failed") {
              setDone(true);
              qc.invalidateQueries({ queryKey: ["job", jobId] });
              es?.close();
            }
          } catch {
            // ignore malformed
          }
        };
        es.addEventListener("end", () => {
          setDone(true);
          es?.close();
        });
        es.onerror = () => {
          setError("connection lost");
        };
      } catch (e: any) {
        setError(e.message);
      }
    })();

    return () => {
      cancelled = true;
      es?.close();
    };
  }, [jobId, qc]);

  return { events, done, error };
}
