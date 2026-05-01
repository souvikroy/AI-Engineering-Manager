"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  MessageSquare,
  GitPullRequestArrow,
  Users,
  Target,
  Siren,
  BookOpenCheck,
  Search,
} from "lucide-react";
import { FreshnessPill } from "./FreshnessPill";
import { BrandWordmark } from "./BrandLogo";

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard; group: "primary" | "ops"; hint?: string };

const items: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, group: "primary", hint: "G D" },
  { href: "/chat", label: "Copilot", icon: MessageSquare, group: "primary", hint: "G C" },
  { href: "/decisions", label: "Decisions", icon: BookOpenCheck, group: "primary" },
  { href: "/people", label: "People", icon: Users, group: "primary" },
  { href: "/execution", label: "Execution", icon: Target, group: "ops" },
  { href: "/incidents", label: "Incidents", icon: Siren, group: "ops" },
  { href: "/reviews", label: "PR Reviews", icon: GitPullRequestArrow, group: "ops" },
];

export function Sidebar() {
  const pathname = usePathname();

  const renderItem = (item: NavItem) => {
    const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
    const Icon = item.icon;
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          className={`group relative flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] transition-colors
            ${active ? "bg-surface-strong text-ink" : "text-ink-dim hover:bg-surface hover:text-ink"}`}
        >
          {active && (
            <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-accent shadow-[0_0_8px_rgba(251,146,60,0.7)]" />
          )}
          <Icon className="w-[15px] h-[15px]" strokeWidth={1.75} />
          <span className="flex-1 tracking-tight2">{item.label}</span>
          {item.hint && (
            <span className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-mono text-ink-ghost">
              {item.hint}
            </span>
          )}
        </Link>
      </li>
    );
  };

  return (
    <aside className="fixed inset-y-0 left-0 w-[244px] flex flex-col border-r border-border bg-bg/70 backdrop-blur-xl z-20">
      {/* Brand */}
      <div className="px-5 pt-6 pb-5">
        <BrandWordmark size={30} />
      </div>

      {/* Search / Command */}
      <div className="px-3 pb-4">
        <button className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border bg-bg-elevated/60 hover:bg-surface hover:border-border-strong transition-colors text-left">
          <Search className="w-3.5 h-3.5 text-ink-ghost" strokeWidth={1.75} />
          <span className="flex-1 text-[12px] text-ink-faint">Search or ask…</span>
          <span className="kbd">⌘</span>
          <span className="kbd">K</span>
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 overflow-y-auto">
        <div className="text-[10px] uppercase tracking-kicker text-ink-ghost font-semibold px-3 mb-2">
          Workspace
        </div>
        <ul className="space-y-0.5 mb-5">
          {items.filter((i) => i.group === "primary").map(renderItem)}
        </ul>

        <div className="text-[10px] uppercase tracking-kicker text-ink-ghost font-semibold px-3 mb-2">
          Operations
        </div>
        <ul className="space-y-0.5">
          {items.filter((i) => i.group === "ops").map(renderItem)}
        </ul>
      </nav>

      {/* System status — live freshness across all integrated sources */}
      <div className="px-3 mb-3">
        <div className="px-3 py-2 rounded-md">
          <FreshnessPill compact />
        </div>
      </div>

      {/* Profile */}
      <div className="px-3 pb-4">
        <div className="flex items-center gap-2.5 p-2.5 rounded-lg border border-border bg-surface hover:bg-surface-hover transition-colors cursor-pointer">
          <div className="w-7 h-7 rounded-full bg-accent-gradient flex items-center justify-center text-[10px] font-semibold text-bg-deep">
            SR
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-medium tracking-tight2 truncate">Souvik Roy</div>
            <div className="text-[10px] text-ink-faint truncate">CEO · Q2 2026</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
