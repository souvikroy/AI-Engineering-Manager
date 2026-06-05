"use client";

import { ShieldCheck, ShieldAlert, ShieldX, Shield } from "lucide-react";
import type { Verdict } from "@/lib/chat/store";

const VERDICTS: Record<
  Verdict,
  { label: string; icon: React.ElementType; tone: string; tooltip: string }
> = {
  ok: {
    label: "Verified",
    icon: ShieldCheck,
    tone: "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-300",
    tooltip:
      "Every concrete claim references a tool source. The verifier accepted the response.",
  },
  weak: {
    label: "Partial",
    icon: ShieldAlert,
    tone: "border-amber-500/30 bg-amber-500/[0.06] text-amber-300",
    tooltip:
      "Some specific claims (numbers, dates, names) lack a clear source pointer. Treat with care.",
  },
  unsupported: {
    label: "Unverified",
    icon: ShieldX,
    tone: "border-red-500/30 bg-red-500/[0.06] text-red-300",
    tooltip:
      "At least one major claim has no source backing. Consider re-running with different tools.",
  },
  skip: {
    label: "Conversational",
    icon: Shield,
    tone: "border-border bg-bg-elevated/60 text-ink-faint",
    tooltip:
      "No tool sources were consulted (greeting, opinion, or guidance). Verifier skipped.",
  },
};

export function VerdictBadge({
  verdict,
  unsupportedClaims,
}: {
  verdict?: Verdict;
  unsupportedClaims?: string[];
}) {
  if (!verdict) return null;
  const meta = VERDICTS[verdict];
  const Icon = meta.icon;
  const tooltip =
    verdict === "unsupported" && unsupportedClaims?.length
      ? `${meta.tooltip} Unsupported: ${unsupportedClaims.slice(0, 3).join(" · ")}`
      : meta.tooltip;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-caption ${meta.tone} ${
        verdict === "ok" ? "shadow-verified-glow" : ""
      }`}
      title={tooltip}
    >
      <Icon className="h-3 w-3" />
      <span className="font-display italic">{meta.label}</span>
    </span>
  );
}
