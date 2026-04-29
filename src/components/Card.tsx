import { ReactNode } from "react";

export function Card({ title, subtitle, children, action }: { title?: string; subtitle?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-5">
      {(title || action) && (
        <div className="flex items-start justify-between mb-3">
          <div>
            {title && <h2 className="text-base font-semibold text-white">{title}</h2>}
            {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function Pill({ children, tone = "muted" }: { children: ReactNode; tone?: "ok" | "warn" | "bad" | "muted" | "accent" }) {
  const cls: Record<string, string> = {
    ok: "bg-ok/15 text-ok",
    warn: "bg-warn/15 text-warn",
    bad: "bg-bad/15 text-bad",
    accent: "bg-accent/15 text-accent",
    muted: "bg-border text-muted",
  };
  return <span className={`inline-block px-2 py-0.5 text-xs rounded ${cls[tone]}`}>{children}</span>;
}
