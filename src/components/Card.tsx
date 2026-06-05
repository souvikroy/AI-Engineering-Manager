import { ReactNode } from "react";

export function Card({
  title,
  subtitle,
  children,
  action,
  icon,
  variant = "default",
  className = "",
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  variant?: "default" | "feature" | "flat";
  className?: string;
}) {
  const surfaces: Record<string, string> = {
    default:
      "rounded-2xl border border-border bg-surface hairline shadow-soft-lift hover:border-border-strong transition-colors",
    feature:
      "rounded-2xl gradient-border bg-gradient-to-br from-accent/[0.05] via-surface to-bg-elevated shadow-soft-lift",
    flat:
      "rounded-xl border border-border bg-bg-elevated/60",
  };
  return (
    <section className={`relative overflow-hidden ${surfaces[variant]} ${className}`}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 px-6 pt-5 pb-3">
          <div className="flex items-center gap-3 min-w-0">
            {icon && (
              <div className="shrink-0 w-7 h-7 rounded-lg bg-surface flex items-center justify-center text-ink-dim">
                {icon}
              </div>
            )}
            <div className="min-w-0">
              {title && (
                <h2 className="text-[15px] font-semibold tracking-tight2 text-ink leading-tight">
                  {title}
                </h2>
              )}
              {subtitle && (
                <p className="text-[12px] text-ink-faint mt-0.5 leading-snug">
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className="px-6 pb-5">{children}</div>
    </section>
  );
}

export function Pill({
  children,
  tone = "muted",
  size = "sm",
  live = false,
}: {
  children: ReactNode;
  tone?: "ok" | "warn" | "bad" | "muted" | "accent" | "ink";
  size?: "xs" | "sm";
  live?: boolean;
}) {
  const tones: Record<string, string> = {
    ok: "bg-ok/[0.10] text-ok ring-1 ring-inset ring-ok/20",
    warn: "bg-warn/[0.10] text-warn ring-1 ring-inset ring-warn/20",
    bad: "bg-bad/[0.10] text-bad ring-1 ring-inset ring-bad/20",
    accent:
      "bg-accent/[0.12] text-accent-hot ring-1 ring-inset ring-accent/30",
    muted:
      "bg-white/[0.04] text-ink-dim ring-1 ring-inset ring-white/[0.06]",
    ink:
      "bg-white/[0.10] text-ink ring-1 ring-inset ring-white/[0.14]",
  };
  const sizes: Record<string, string> = {
    xs: "px-1.5 py-0.5 text-[10px]",
    sm: "px-2 py-0.5 text-[11px]",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md font-medium tabular-nums ${tones[tone]} ${sizes[size]}`}
    >
      {live && (
        <span
          className="live-dot"
          style={{
            color:
              tone === "bad"
                ? "#f87171"
                : tone === "warn"
                ? "#fbbf24"
                : tone === "ok"
                ? "#34d399"
                : "#fb923c",
          }}
        >
          <span
            className="block w-2 h-2 rounded-full"
            style={{ background: "currentColor" }}
          />
        </span>
      )}
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
  delta,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "ok" | "warn" | "bad";
  icon?: ReactNode;
  delta?: { direction: "up" | "down" | "flat"; text: string };
}) {
  const valueColor: Record<string, string> = {
    default: "text-ink",
    ok: "text-ok",
    warn: "text-warn",
    bad: "text-bad",
  };
  const accentBar: Record<string, string> = {
    default: "bg-accent/40",
    ok: "bg-ok/60",
    warn: "bg-warn/60",
    bad: "bg-bad/60",
  };
  const deltaColor =
    delta?.direction === "up"
      ? "text-ok"
      : delta?.direction === "down"
      ? "text-bad"
      : "text-ink-faint";
  const deltaArrow =
    delta?.direction === "up" ? "↗" : delta?.direction === "down" ? "↘" : "→";
  return (
    <div className="group relative rounded-xl border border-border bg-surface p-5 overflow-hidden hairline transition-all hover:border-border-strong">
      <div className={`absolute left-0 top-0 bottom-0 w-[2px] ${accentBar[tone]} opacity-50 group-hover:opacity-100 transition-opacity`} />
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10.5px] uppercase tracking-kicker text-ink-faint font-medium">
          {label}
        </div>
        {icon && <div className="text-ink-ghost">{icon}</div>}
      </div>
      <div className="flex items-baseline gap-2">
        <div
          className={`text-[30px] font-semibold tracking-display tabular-nums leading-none ${valueColor[tone]}`}
        >
          {value}
        </div>
        {delta && (
          <span className={`text-[11px] font-medium ${deltaColor}`}>
            {deltaArrow} {delta.text}
          </span>
        )}
      </div>
      {hint && <div className="text-[11.5px] text-ink-faint mt-2">{hint}</div>}
    </div>
  );
}

export function SectionHeader({
  kicker,
  children,
}: {
  kicker?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3 mb-2">
      {kicker && (
        <span className="text-[10.5px] uppercase tracking-kicker text-ink-faint font-medium">
          {kicker}
        </span>
      )}
      <span className="text-[12.5px] text-ink-dim">{children}</span>
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>;
}
