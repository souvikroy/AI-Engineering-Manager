import { ReactNode } from "react";

export function Card({
  title,
  subtitle,
  children,
  action,
  icon,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`relative rounded-xl border border-border bg-surface overflow-hidden ${className}`}>
      {(title || action) && (
        <header className="flex items-start justify-between px-5 pt-4 pb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {icon && <div className="text-ink-faint shrink-0">{icon}</div>}
            <div className="min-w-0">
              {title && <h2 className="text-[14.5px] font-semibold tracking-tight text-ink">{title}</h2>}
              {subtitle && <p className="text-[12px] text-ink-faint mt-0.5">{subtitle}</p>}
            </div>
          </div>
          {action}
        </header>
      )}
      <div className="px-5 pb-5">{children}</div>
    </section>
  );
}

export function Pill({
  children,
  tone = "muted",
  size = "sm",
}: {
  children: ReactNode;
  tone?: "ok" | "warn" | "bad" | "muted" | "accent";
  size?: "xs" | "sm";
}) {
  const tones: Record<string, string> = {
    ok: "bg-ok/12 text-ok ring-1 ring-inset ring-ok/20",
    warn: "bg-warn/12 text-warn ring-1 ring-inset ring-warn/20",
    bad: "bg-bad/12 text-bad ring-1 ring-inset ring-bad/20",
    accent: "bg-accent/15 text-accent ring-1 ring-inset ring-accent/30",
    muted: "bg-white/[0.06] text-ink-dim ring-1 ring-inset ring-white/[0.08]",
  };
  const sizes: Record<string, string> = {
    xs: "px-1.5 py-0.5 text-[10px]",
    sm: "px-2 py-0.5 text-[11px]",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-md font-medium ${tones[tone]} ${sizes[size]}`}>
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "ok" | "warn" | "bad";
  icon?: ReactNode;
}) {
  const valueColor: Record<string, string> = {
    default: "text-ink",
    ok: "text-ok",
    warn: "text-warn",
    bad: "text-bad",
  };
  return (
    <div className="relative rounded-xl border border-border bg-surface p-5 overflow-hidden">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10.5px] uppercase tracking-[0.18em] text-ink-faint font-medium">{label}</div>
        {icon && <div className="text-ink-ghost">{icon}</div>}
      </div>
      <div className={`text-[28px] font-semibold tracking-tight tabular-nums ${valueColor[tone]}`}>{value}</div>
      {hint && <div className="text-[11.5px] text-ink-faint mt-1">{hint}</div>}
    </div>
  );
}

export function SectionHeader({ kicker, children }: { kicker?: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 mb-2">
      {kicker && <span className="text-[10.5px] uppercase tracking-[0.2em] text-ink-faint font-medium">{kicker}</span>}
      <span className="text-[12.5px] text-ink-dim">{children}</span>
    </div>
  );
}
