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
  Sparkles,
} from "lucide-react";

const items = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/chat", label: "Copilot", icon: MessageSquare },
  { href: "/decisions", label: "Decisions", icon: BookOpenCheck },
  { href: "/people", label: "People", icon: Users },
  { href: "/execution", label: "Execution", icon: Target },
  { href: "/incidents", label: "Incidents", icon: Siren },
  { href: "/reviews", label: "PR Reviews", icon: GitPullRequestArrow },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="fixed inset-y-0 left-0 w-[232px] flex flex-col border-r border-border bg-bg/60 backdrop-blur-xl z-20">
      <div className="px-5 pt-6 pb-8">
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-accent/40 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-bg" strokeWidth={2.5} />
            </div>
            <div className="absolute inset-0 rounded-lg bg-accent blur-lg opacity-40 -z-10" />
          </div>
          <div>
            <div className="text-[15px] font-semibold tracking-tight">AI EM</div>
            <div className="text-[10.5px] text-ink-faint uppercase tracking-[0.18em] font-medium -mt-0.5">Copilot</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3">
        <div className="text-[10.5px] uppercase tracking-[0.2em] text-ink-ghost font-medium px-3 mb-2">Workspace</div>
        <ul className="space-y-0.5">
          {items.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`group flex items-center gap-2.5 px-3 py-2 rounded-md text-[13.5px] transition-all relative
                    ${active
                      ? "bg-surface text-ink"
                      : "text-ink-dim hover:bg-surface hover:text-ink"
                    }`}
                >
                  {active && (
                    <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-accent" />
                  )}
                  <Icon className="w-4 h-4" strokeWidth={1.75} />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="p-4 mx-3 mb-4 rounded-lg border border-border bg-surface">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent/50 to-accent/20 flex items-center justify-center text-[11px] font-semibold">
            CEO
          </div>
          <div className="min-w-0">
            <div className="text-[12.5px] font-medium truncate">Souvik Roy</div>
            <div className="text-[10.5px] text-ink-faint truncate">Q2 2026 · 3 teams</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
